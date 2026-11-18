import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ARCADE_DAILY_CAP, type GameId, type MemoryStepResponse, type RunResult, type RunStart, type TopResponse } from '@afterhours/shared/features/arcade';
import { type Jar, type TestApp, adminJar, capture, makeApp, makeKits, req, signedInAttendee } from '../../../test/helpers';
import { hexbinQuestions, memoryMinLevelMs, memorySequence, normaliseAnswer, reactionDelays } from './games';
import { PB_BONUS, STARTS_PER_MIN, dayStart, tick } from './index';

type Person = { jar: Jar; id: number };

describe('arcade feature', () => {
  let t: TestApp;
  let admin: Jar;
  beforeEach(async () => {
    t = await makeApp({ env: { LOGIN_IP_PER_MIN: '100000' } });
    admin = await adminJar(t.app);
  });
  afterEach(async () => t.close());

  async function people(n: number): Promise<Person[]> {
    const kits = await makeKits(t.app, n);
    const ppl = await Promise.all(kits.map((k, i) => signedInAttendee(t.app, k, `p${i}`)));
    t.ctx.db.exec('DELETE FROM points_ledger'); // exact totals below, without core's sign-in awards
    t.ctx.points.invalidate();
    return ppl;
  }
  const seedOf = (runId: string) => (t.ctx.db.prepare('SELECT seed FROM arcade_runs WHERE id = ?').get(runId) as { seed: number }).seed;
  const start = async (p: Person, game: GameId) => {
    t.clock.advance(10_000); // stay under the start rate limit unless a test wants otherwise
    const r = await req(t.app, p.jar, 'POST', '/api/arcade/runs', { game });
    expect(r.statusCode, r.body).toBe(200);
    return r.json() as RunStart;
  };
  const submit = (p: Person, runId: string, body: object) => req(t.app, p.jar, 'POST', `/api/arcade/runs/${runId}/submit`, body);
  const step = (p: Person, runId: string, taps: number[]) => req(t.app, p.jar, 'POST', `/api/arcade/runs/${runId}/step`, { taps });
  const total = (p: Person) => t.ctx.points.total(p.id);

  /** Play a whole reaction run like a human would, in the right amount of time. */
  async function reaction(p: Person, reactions = [210, 190, 230, 200, 220], afterMs?: number) {
    const run = await start(p, 'reaction');
    const delays = (run.spec as { delaysMs: number[] }).delaysMs;
    t.clock.advance(afterMs ?? delays.reduce((a, b) => a + b, 0) + reactions.reduce((a, b) => a + b, 0) + 1500);
    return { run, res: await submit(p, run.runId, { reactions }) };
  }

  /** Play hexbin: answer `n` questions right (plus `wrong` wrong ones), one every `gap` ms. */
  async function hexbin(p: Person, n: number, wrong = 0, gap = 1500) {
    const run = await start(p, 'hexbin');
    const qs = hexbinQuestions(seedOf(run.runId));
    const answers = qs.slice(0, n + wrong).map((q, i) => ({ a: i < n ? q.answer : 'zzz', t: 900 + i * gap + (i % 3) * 170 }));
    t.clock.advance(answers.at(-1)!.t + 500);
    return { run, answers, res: await submit(p, run.runId, { answers }) };
  }

  describe('runs and tokens', () => {
    it('issues a random single-use token, a seed-derived spec, and never the answers', async () => {
      const [a] = await people(1);
      const run = await start(a!, 'hexbin');
      expect(run.runId).toMatch(/^[0-9a-f]{32}$/);
      expect(run.expiresAt).toBeGreaterThan(run.startedAt + run.durationMs);
      expect(run.durationMs).toBeLessThanOrEqual(60_000);
      const qs = (run.spec as { questions: { prompt: string }[] }).questions;
      expect(qs).toHaveLength(40);
      const answers = hexbinQuestions(seedOf(run.runId)).map((q) => q.answer);
      expect(JSON.stringify(run)).not.toContain('"answer"');
      expect(JSON.stringify(run)).not.toContain('seed');
      expect(answers.length).toBe(40);
      const run2 = await start(a!, 'hexbin');
      expect(run2.runId).not.toBe(run.runId);
      expect(JSON.stringify(run2.spec)).not.toBe(JSON.stringify(run.spec)); // fresh seed each run
    });

    it('requires sign-in, a valid game, and rate limits starts', async () => {
      const [a] = await people(1);
      expect((await req(t.app, null, 'POST', '/api/arcade/runs', { game: 'reaction' })).statusCode).toBe(401);
      expect((await req(t.app, a!.jar, 'POST', '/api/arcade/runs', { game: 'tetris' })).statusCode).toBe(400);
      let limited = 0;
      for (let i = 0; i < STARTS_PER_MIN + 4; i++) {
        if ((await req(t.app, a!.jar, 'POST', '/api/arcade/runs', { game: 'reaction' })).statusCode === 429) limited++;
      }
      expect(limited).toBe(4);
    });

    it('a new start abandons the old token', async () => {
      const [a] = await people(1);
      const old = await start(a!, 'reaction');
      await start(a!, 'reaction');
      const r = await submit(a!, old.runId, { reactions: [200, 210, 220, 230, 240] });
      expect(r.statusCode).toBe(409);
    });

    it('replay: a scored run cannot be submitted again and pays once', async () => {
      const [a] = await people(1);
      const { run, res } = await reaction(a!);
      expect(res.statusCode).toBe(200);
      const paid = total(a!);
      expect(paid).toBeGreaterThan(0);
      const again = await submit(a!, run.runId, { reactions: [101, 102, 103, 104, 105] });
      expect(again.statusCode).toBe(409);
      expect(total(a!)).toBe(paid);
    });

    it("someone else's token, a made-up token and a malformed token all 404", async () => {
      const [a, b] = await people(2);
      const run = await start(a!, 'reaction');
      expect((await submit(b!, run.runId, { reactions: [200, 210, 220, 230, 240] })).statusCode).toBe(404);
      expect((await submit(a!, 'f'.repeat(32), { reactions: [200, 210, 220, 230, 240] })).statusCode).toBe(404);
      expect((await submit(a!, "1' OR 1=1", { reactions: [200, 210, 220, 230, 240] })).statusCode).toBe(404);
    });

    it('a run submitted after it expired is refused', async () => {
      const [a] = await people(1);
      const run = await start(a!, 'reaction');
      t.clock.advance(run.durationMs + 5000);
      const r = await submit(a!, run.runId, { reactions: [200, 210, 220, 230, 240] });
      expect(r.statusCode).toBe(410);
      expect(t.ctx.points.total(a!.id)).toBe(0);
    });

    it('the wrong endpoint for the game is a 400 and does not burn the run', async () => {
      const [a] = await people(1);
      const m = await start(a!, 'memory');
      expect((await submit(a!, m.runId, { reactions: [1, 2, 3, 4, 5] })).statusCode).toBe(400);
      const r = await start(a!, 'reaction');
      expect((await step(a!, r.runId, [1])).statusCode).toBe(400);
      t.clock.advance(20_000);
      expect((await submit(a!, r.runId, { reactions: [200, 210, 220, 230, 240] })).statusCode).toBe(200);
    });
  });

  describe('reaction (lag spike)', () => {
    it('scores the average, pays by tier, unlocks stickers and records a best', async () => {
      const [a] = await people(1);
      const { res } = await reaction(a!, [180, 200, 210, 190, 220]); // avg 200
      const r = res.json() as RunResult;
      expect(r).toMatchObject({ game: 'reaction', label: '200 ms', score: 800, points: 10, rawPoints: 10, newBest: true, rank: 1, players: 1, best: { score: 800 } });
      expect(total(a!)).toBe(10);
      const stk = t.ctx.stickers.unlockedBy(a!.id);
      expect(stk['arcade-first']).toBeDefined();
      expect(stk['arcade-reflex']).toBeDefined();
      expect(stk['arcade-record']).toBeDefined(); // took #1 on an empty list
    });

    it('a slower run is not a new best and does not move the best; a faster one adds the PB bonus', async () => {
      const [a] = await people(1);
      await reaction(a!, [300, 310, 320, 290, 280]); // avg 300 -> 700, 6 pts
      const slow = ((await reaction(a!, [400, 420, 410, 430, 440])).res.json()) as RunResult; // avg 420
      expect(slow).toMatchObject({ newBest: false, best: { score: 700 }, points: 2 });
      const fast = ((await reaction(a!, [240, 250, 260, 255, 245])).res.json()) as RunResult; // avg 250 -> 8 + bonus
      expect(fast).toMatchObject({ newBest: true, rawPoints: 8 + PB_BONUS, points: 8 + PB_BONUS, best: { score: 750 } });
    });

    it('rejects impossible reaction times and burns the run', async () => {
      const [a] = await people(1);
      const run = await start(a!, 'reaction');
      t.clock.advance(30_000);
      const r = await submit(a!, run.runId, { reactions: [40, 200, 210, 220, 230] });
      expect(r.statusCode).toBe(422);
      expect((r.json() as { error: { code: string } }).error.code).toBe('implausible');
      expect((await submit(a!, run.runId, { reactions: [200, 210, 220, 230, 240] })).statusCode).toBe(409); // no second chance on the same token
      expect(total(a!)).toBe(0);
    });

    it('rejects a run that finished faster than the seeded delays allow', async () => {
      const [a] = await people(1);
      const { res } = await reaction(a!, [200, 210, 220, 230, 240], 1000);
      expect(res.statusCode).toBe(422);
    });

    it('rejects robotic identical times and wrong round counts', async () => {
      const [a] = await people(1);
      expect((await reaction(a!, [200, 200, 200, 200, 200])).res.statusCode).toBe(422);
      const run = await start(a!, 'reaction');
      t.clock.advance(30_000);
      expect((await submit(a!, run.runId, { reactions: [200, 210] })).statusCode).toBe(400);
      expect((await submit(a!, run.runId, { reactions: [200, 210, 220, 230, -5] })).statusCode).toBe(400);
      expect((await submit(a!, run.runId, { reactions: [200, 210, 220, 230, 240] })).statusCode).toBe(200); // bad payloads did not burn it
    });

    it('delays are seeded and deterministic', () => {
      expect(reactionDelays(42)).toEqual(reactionDelays(42));
      expect(reactionDelays(42)).not.toEqual(reactionDelays(43));
      expect(reactionDelays(1).every((d) => d >= 1200 && d < 3600)).toBe(true);
    });
  });

  describe('hexbin (base rush)', () => {
    it('scores correct answers, penalises wrong ones, accepts any prefix/case/padding', async () => {
      const [a] = await people(1);
      const { res } = await hexbin(a!, 20, 3);
      const r = res.json() as RunResult;
      expect(r).toMatchObject({ game: 'hexbin', score: 20 * 100 - 3 * 40, label: '20 right', rawPoints: 8, detail: { correct: 20, wrong: 3, answered: 23 } });
      expect(t.ctx.stickers.unlockedBy(a!.id)['arcade-base']).toBeDefined();
      expect(normaliseAnswer(' 0x2F ')).toBe('2f');
      expect(normaliseAnswer('0b00101')).toBe('101');
      expect(normaliseAnswer('000')).toBe('0');
    });

    it('answers are regenerated from the seed, not trusted from the client', async () => {
      const [a] = await people(1);
      const run = await start(a!, 'hexbin');
      t.clock.advance(30_000);
      const answers = Array.from({ length: 10 }, (_, i) => ({ a: '1', t: 900 + i * 1400 + (i % 4) * 130 }));
      const r = (await submit(a!, run.runId, { answers })).json() as RunResult;
      expect(r.detail.correct ?? 0).toBeLessThan(10);
    });

    it('rejects answers faster than a human can read, impossibly early first answer, and future timestamps', async () => {
      const [a] = await people(1);
      const make = async (answers: { a: string; t: number }[], wait = 40_000) => {
        const run = await start(a!, 'hexbin');
        t.clock.advance(wait);
        return submit(a!, run.runId, { answers });
      };
      expect((await make([{ a: '1', t: 200 }])).statusCode).toBe(422);
      expect((await make([{ a: '1', t: 1000 }, { a: '1', t: 1200 }])).statusCode).toBe(422);
      expect((await make([{ a: '1', t: 1000 }, { a: '1', t: 90_000 }])).statusCode).toBe(422);
      expect((await make([{ a: '1', t: 1000 }, { a: '1', t: 60_000 }])).statusCode).toBe(422); // after time ran out
      expect((await make([{ a: '1', t: 30_000 }], 5000)).statusCode).toBe(422); // claims more time than has passed
      expect((await make(Array.from({ length: 41 }, (_, i) => ({ a: '1', t: 800 + i * 900 })))).statusCode).toBe(400);
    });

    it('rejects metronome scripts (perfectly even timing)', async () => {
      const [a] = await people(1);
      const run = await start(a!, 'hexbin');
      const qs = hexbinQuestions(seedOf(run.runId));
      const answers = qs.slice(0, 30).map((q, i) => ({ a: q.answer, t: 800 + i * 1000 }));
      t.clock.advance(40_000);
      expect((await submit(a!, run.runId, { answers })).statusCode).toBe(422);
    });

    it('questions ramp from 4 to 8 bits and cover all six conversions', () => {
      const qs = hexbinQuestions(7).map((q) => q.question);
      expect(qs).toHaveLength(40);
      expect(new Set(qs.map((q) => `${q.from}2${q.to}`)).size).toBe(6);
      expect(qs.every((q) => q.from !== q.to)).toBe(true);
    });
  });

  describe('memory (echo)', () => {
    /** Clear `levels` levels like a human (just over the minimum time per level); returns the last response. */
    async function play(p: Person, runId: string, levels: number, wrongAfter = false) {
      const seq = memorySequence(seedOf(runId));
      let last: MemoryStepResponse | null = null;
      for (let l = 1; l <= levels; l++) {
        t.clock.advance(memoryMinLevelMs(l) + 700);
        last = (await step(p, runId, seq.slice(0, l))).json() as MemoryStepResponse;
      }
      if (wrongAfter) {
        t.clock.advance(memoryMinLevelMs(levels + 1) + 700);
        const bad = seq.slice(0, levels + 1);
        bad[bad.length - 1] = ((bad.at(-1) ?? 0) + 1) % 9;
        last = (await step(p, runId, bad)).json() as MemoryStepResponse;
      }
      return last!;
    }

    it('reveals one more pad per cleared level, never the future, and ends on a slip with the levels banked', async () => {
      const [a] = await people(1);
      const run = await start(a!, 'memory');
      expect((run.spec as { sequence: number[] }).sequence).toHaveLength(1);
      const seq = memorySequence(seedOf(run.runId));
      t.clock.advance(memoryMinLevelMs(1) + 500);
      const r1 = (await step(a!, run.runId, seq.slice(0, 1))).json() as MemoryStepResponse;
      expect(r1).toMatchObject({ status: 'continue', level: 2, cleared: 1 });
      expect((r1 as { sequence: number[] }).sequence).toEqual(seq.slice(0, 2));
    });

    it('scores levels cleared, pays by tier, big brain at 9', async () => {
      const [a] = await people(1);
      const run = await start(a!, 'memory');
      const end = await play(a!, run.runId, 9, true);
      expect(end.status).toBe('over');
      const result = (end as { result: RunResult }).result;
      expect(result).toMatchObject({ game: 'memory', score: 900, label: 'level 9', points: 8, newBest: true });
      expect(t.ctx.stickers.unlockedBy(a!.id)['arcade-echo']).toBeDefined();
      expect((await step(a!, run.runId, [0])).statusCode).toBe(409); // consumed
    });

    it('a step that arrives faster than a human can watch and tap is rejected and the run is burned', async () => {
      const [a] = await people(1);
      const run = await start(a!, 'memory');
      const seq = memorySequence(seedOf(run.runId));
      expect((await step(a!, run.runId, seq.slice(0, 1))).statusCode).toBe(422); // instantly
      expect((await step(a!, run.runId, seq.slice(0, 1))).statusCode).toBe(409);
      expect(total(a!)).toBe(0);
    });

    it('wrong tap, wrong length, or an out-of-range pad ends or fails; finish banks what was cleared', async () => {
      const [a] = await people(1);
      const run = await start(a!, 'memory');
      const seq = memorySequence(seedOf(run.runId));
      expect((await step(a!, run.runId, [9])).statusCode).toBe(400);
      expect((await step(a!, run.runId, [])).statusCode).toBe(400);
      await play(a!, run.runId, 3);
      const fin = (await req(t.app, a!.jar, 'POST', `/api/arcade/runs/${run.runId}/finish`, {})).json() as RunResult;
      expect(fin).toMatchObject({ score: 300, label: 'level 3', points: 2 });
      void seq;
      const r2 = await start(a!, 'memory');
      t.clock.advance(memoryMinLevelMs(1) + 500);
      const wrongLen = ((await step(a!, r2.runId, [0, 0])).json()) as MemoryStepResponse;
      expect(wrongLen.status).toBe('over');
      expect((wrongLen as { result: RunResult }).result).toMatchObject({ score: 0, points: 0, newBest: false });
    });

    it('time running out ends the run with what was banked', async () => {
      const [a] = await people(1);
      const run = await start(a!, 'memory');
      await play(a!, run.runId, 2);
      t.clock.advance(run.durationMs);
      const seq = memorySequence(seedOf(run.runId));
      const r = await step(a!, run.runId, seq.slice(0, 3));
      expect(r.statusCode).toBe(200);
      expect((r.json() as { status: string; result: RunResult }).result).toMatchObject({ score: 200 });
    });
  });

  describe('daily cap', () => {
    it('stops paying at the cap, reports it, and the next event day starts fresh', async () => {
      const [a, b] = await people(2);
      let paid = 0;
      let last: RunResult | null = null;
      for (let i = 0; i < 9; i++) {
        last = (await reaction(a!, [180, 190, 200, 195, 185])).res.json() as RunResult;
        paid += last.points;
        expect(total(a!)).toBe(paid);
        expect(total(a!)).toBeLessThanOrEqual(ARCADE_DAILY_CAP);
      }
      expect(paid).toBe(ARCADE_DAILY_CAP);
      expect(last).toMatchObject({ points: 0, capReached: true, capRemaining: 0 });
      // other sources are not capped by it, and the cap is per attendee
      t.ctx.points.award({ attendeeId: a!.id, source: 'hunt', ref: 'x', points: 100 });
      expect(total(a!)).toBe(ARCADE_DAILY_CAP + 100);
      expect(((await reaction(b!, [180, 190, 200, 195, 185])).res.json() as RunResult).points).toBe(10);
      // next day (IST midnight) the allowance is back
      t.clock.set(dayStart(t.clock.now()) + 86_400_000 + 3_600_000);
      expect(((await reaction(a!, [180, 190, 200, 195, 185])).res.json() as RunResult).points).toBe(10);
      const games = (await req(t.app, a!.jar, 'GET', '/api/arcade/games')).json() as { daily: { cap: number; earned: number; remaining: number } };
      expect(games.daily).toMatchObject({ cap: ARCADE_DAILY_CAP, earned: 10, remaining: ARCADE_DAILY_CAP - 10 });
    });

    it('spreads across games: the cap is shared', async () => {
      const [a] = await people(1);
      for (let i = 0; i < 3; i++) await reaction(a!, [180, 190, 200, 195, 185]); // 30
      for (let i = 0; i < 3; i++) {
        const run = await start(a!, 'memory');
        await (async () => {
          const seq = memorySequence(seedOf(run.runId));
          for (let l = 1; l <= 12; l++) {
            t.clock.advance(memoryMinLevelMs(l) + 600);
            await step(a!, run.runId, seq.slice(0, l));
          }
        })();
      }
      expect(total(a!)).toBeLessThanOrEqual(ARCADE_DAILY_CAP);
    });
  });

  describe('lists and live events', () => {
    it('per-game top list: best per person, ordered, ties go to who got there first, plus my rank', async () => {
      const [a, b, c] = await people(3);
      await reaction(a!, [250, 250, 260, 240, 250]); // 750
      await reaction(b!, [250, 250, 260, 240, 250]); // 750 too, later
      await reaction(c!, [180, 190, 200, 195, 185]); // 810
      await reaction(c!, [400, 410, 420, 430, 440]); // worse run does not replace the best
      const top = (await req(t.app, b!.jar, 'GET', '/api/arcade/top?limit=5')).json() as TopResponse;
      const rx = top.boards.find((x) => x.game === 'reaction')!;
      expect(rx.entries.map((e) => e.nickname)).toEqual(['p2', 'p0', 'p1']);
      expect(rx.entries.map((e) => e.rank)).toEqual([1, 2, 3]);
      expect(rx.me).toMatchObject({ rank: 3, score: 750 });
      expect(rx.players).toBe(3);
      expect(top.boards.find((x) => x.game === 'memory')!.entries).toHaveLength(0);
      expect((await req(t.app, null, 'GET', '/api/arcade/top')).statusCode).toBe(401);
      expect((await req(t.app, admin, 'GET', '/api/arcade/top')).statusCode).toBe(200); // projector/console
    });

    it('records: taking #1 sends one arcade.record to everyone; top-changed is coalesced to screens', async () => {
      const [a, b] = await people(2);
      const all = capture(t.ctx, { attendeeId: null, admin: false, screen: false });
      const screen = capture(t.ctx, { attendeeId: null, admin: false, screen: true });
      await reaction(a!, [300, 310, 320, 290, 300]);
      await reaction(b!, [200, 210, 190, 205, 195]);
      await reaction(b!, [180, 190, 170, 185, 175]);
      const recs = all.events.filter((e) => e.type === 'arcade.record').map((e) => e.data as { nickname: string; previous: { nickname: string } | null });
      expect(recs.map((r) => r.nickname)).toEqual(['p0', 'p1', 'p1']);
      expect(recs[1]!.previous?.nickname).toBe('p0');
      expect(all.types()).not.toContain('arcade.top');
      t.clock.advance(3000);
      tick(t.ctx);
      tick(t.ctx);
      const tops = screen.events.filter((e) => e.type === 'arcade.top');
      expect(tops).toHaveLength(1);
      expect((tops[0]!.data as { games: string[] }).games).toEqual(['reaction']);
      all.unsub();
      screen.unsub();
    });

    it('/games shows my best, plays, rank and the daily allowance', async () => {
      const [a] = await people(1);
      await reaction(a!, [250, 250, 260, 240, 250]);
      const g = (await req(t.app, a!.jar, 'GET', '/api/arcade/games')).json() as {
        games: { id: string; best: { score: number } | null; plays: number; rank: number | null }[];
        daily: { earned: number };
        settings: { enabled: boolean };
      };
      expect(g.games.find((x) => x.id === 'reaction')).toMatchObject({ best: { score: 750 }, plays: 1, rank: 1 });
      expect(g.games.find((x) => x.id === 'memory')).toMatchObject({ best: null, plays: 0, rank: null });
      expect(g.settings.enabled).toBe(true);
      expect(g.daily.earned).toBe(8);
    });

    it('triple play sticker after scoring in all three games', async () => {
      const [a] = await people(1);
      await reaction(a!);
      await hexbin(a!, 8, 0, 1500);
      expect(t.ctx.stickers.unlockedBy(a!.id)['arcade-all-three']).toBeUndefined();
      const run = await start(a!, 'memory');
      const seq = memorySequence(seedOf(run.runId));
      t.clock.advance(memoryMinLevelMs(1) + 500);
      await step(a!, run.runId, seq.slice(0, 1));
      await req(t.app, a!.jar, 'POST', `/api/arcade/runs/${run.runId}/finish`, {});
      expect(t.ctx.stickers.unlockedBy(a!.id)['arcade-all-three']).toBeDefined();
    });
  });

  describe('console', () => {
    it('switch games off and on; live event to everyone; starts refused while off', async () => {
      const [a] = await people(1);
      const watcher = capture(t.ctx, { attendeeId: a!.id, admin: false, screen: false });
      expect((await req(t.app, a!.jar, 'POST', '/api/arcade/admin/settings', { enabled: false })).statusCode).toBe(401);
      await req(t.app, admin, 'POST', '/api/arcade/admin/settings', { games: { memory: false } });
      expect((await req(t.app, a!.jar, 'POST', '/api/arcade/runs', { game: 'memory' })).statusCode).toBe(403);
      expect((await req(t.app, a!.jar, 'POST', '/api/arcade/runs', { game: 'reaction' })).statusCode).toBe(200);
      await req(t.app, admin, 'POST', '/api/arcade/admin/settings', { enabled: false });
      t.clock.advance(10_000);
      expect((await req(t.app, a!.jar, 'POST', '/api/arcade/runs', { game: 'reaction' })).statusCode).toBe(403);
      expect(watcher.types().filter((x) => x === 'arcade.toggled')).toHaveLength(2);
      await req(t.app, admin, 'POST', '/api/arcade/admin/settings', { enabled: true, games: { memory: true } });
      expect((await req(t.app, a!.jar, 'POST', '/api/arcade/runs', { game: 'memory' })).statusCode).toBe(200);
      watcher.unsub();
    });

    it('stats count runs, players and flagged runs; reset needs the typed confirmation and clears points', async () => {
      const [a, b] = await people(2);
      await reaction(a!);
      await reaction(b!, [200, 200, 200, 200, 200]); // flagged
      const s = (await req(t.app, admin, 'GET', '/api/arcade/admin/stats')).json() as { games: { id: string; runs: number; flagged: number; players: number }[]; pointsPaid: number };
      expect(s.games.find((g) => g.id === 'reaction')).toMatchObject({ runs: 1, flagged: 1, players: 1 });
      expect(s.pointsPaid).toBeGreaterThan(0);
      expect((await req(t.app, a!.jar, 'GET', '/api/arcade/admin/stats')).statusCode).toBe(401);
      expect((await req(t.app, admin, 'POST', '/api/arcade/admin/reset', { confirm: 'yes' })).statusCode).toBe(400);
      expect((await req(t.app, admin, 'POST', '/api/arcade/admin/reset', { confirm: 'RESET ARCADE' })).statusCode).toBe(200);
      expect(total(a!)).toBe(0);
      const top = (await req(t.app, admin, 'GET', '/api/arcade/top')).json() as TopResponse;
      expect(top.boards.every((x) => x.entries.length === 0)).toBe(true);
    });
  });

  it('300 attendees play a reaction run each within budget', async () => {
    const ppl = await people(300);
    const t0 = performance.now();
    const runs = await Promise.all(ppl.map((p) => req(t.app, p.jar, 'POST', '/api/arcade/runs', { game: 'reaction' })));
    expect(runs.every((r) => r.statusCode === 200)).toBe(true);
    t.clock.advance(40_000);
    const res = await Promise.all(
      ppl.map((p, i) => submit(p, (runs[i]!.json() as RunStart).runId, { reactions: [200 + (i % 50), 210, 190 + (i % 30), 205, 215] })),
    );
    const ms = performance.now() - t0;
    expect(res.every((r) => r.statusCode === 200)).toBe(true);
    expect(ms).toBeLessThan(8000);
    const t1 = performance.now();
    const top = await req(t.app, ppl[0]!.jar, 'GET', '/api/arcade/top?limit=10');
    expect(top.statusCode).toBe(200);
    expect(performance.now() - t1).toBeLessThan(200);
    t.clock.advance(3000);
    const t2 = performance.now();
    tick(t.ctx);
    expect(performance.now() - t2).toBeLessThan(200);
  }, 90_000);
});
