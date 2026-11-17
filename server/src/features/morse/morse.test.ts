import {
  LADDER,
  LADDER_BONUS,
  type Press,
  type Round,
  type RoundResult,
  SPRINT_PRIZES,
  levelDef,
  pointsForScore,
  wordToPatterns,
} from '@afterhours/shared/features/morse';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Jar, type TestApp, adminJar, capture, makeApp, makeKits, req, signedInAttendee } from '../../../test/helpers';
import { endSprint, startRound, submitGuess, submitTaps, tick } from './index';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Jittery human taps for a word at a given unit. */
function humanTaps(word: string, unit: number, seed: number, jitter = { press: 0.15, gap: 0.25 }): Press[] {
  const r = rng(seed);
  const jit = (j: number) => Math.exp((r() + r() + r() - 1.5) * j * 1.6);
  const out: [number, number][] = [];
  let t = 0;
  wordToPatterns(word).forEach((p, li) => {
    [...p].forEach((el, ei) => {
      if (li > 0 || ei > 0) t += (ei > 0 ? unit : 3 * unit) * jit(jitter.gap);
      const d = (el === '.' ? unit : 3 * unit) * jit(jitter.press);
      out.push([Math.round(t), Math.round(t + d)]);
      t += d;
    });
  });
  const base = out[0]?.[0] ?? 0;
  return out.map(([a, b]) => [a - base, b - base] as const);
}
const span = (p: Press[]) => (p[p.length - 1] as Press)[1] - (p[0] as Press)[0];

const PINNED: Record<number, string> = { 1: 'bug', 2: 'code', 3: 'debug', 4: 'commit', 5: 'recurse' };

interface Person {
  jar: Jar;
  id: number;
}

describe('morse feature', () => {
  let t: TestApp;
  let a: Person;
  let b: Person;
  beforeEach(async () => {
    t = await makeApp();
    const kits = await makeKits(t.app, 2);
    a = await signedInAttendee(t.app, kits[0]!, 'anna');
    b = await signedInAttendee(t.app, kits[1]!, 'bala');
  });
  afterEach(async () => t.close());

  const wordOf = (id: string) => (t.ctx.db.prepare('SELECT word FROM morse_rounds WHERE id = ?').get(id) as { word: string }).word;
  const startHttp = async (p: Person, mode: 'decode' | 'encode', level: number, sprint = false) => {
    const r = await req(t.app, p.jar, 'POST', '/api/morse/rounds', { mode, level, sprint });
    const body = r.json() as Round;
    // Encode words are pinned so jittery-tap tests are fully deterministic (a random word could, by chance, produce a gap the judge reads as a word break).
    if (r.statusCode === 200 && body.mode === 'encode') {
      const pinned = PINNED[body.level] as string;
      t.ctx.db.prepare('UPDATE morse_rounds SET word = ? WHERE id = ?').run(pinned, body.id);
      body.word = pinned.toUpperCase();
    }
    return { status: r.statusCode, body };
  };
  /** Wait out the beeps plus a bit of typing time. */
  const listen = (round: Round, typingMs = 1500) => t.clock.advance((round.signal?.leadInMs ?? 0) + (round.signal?.totalMs ?? 0) + typingMs);
  const guessHttp = async (p: Person, id: string, guess: string) => {
    const r = await req(t.app, p.jar, 'POST', `/api/morse/rounds/${id}/guess`, { guess });
    return { status: r.statusCode, body: r.json() as RoundResult };
  };
  const tapHttp = async (p: Person, id: string, presses: Press[]) => {
    const r = await req(t.app, p.jar, 'POST', `/api/morse/rounds/${id}/taps`, { presses });
    return { status: r.statusCode, body: r.json() as RoundResult };
  };
  /** A fresh decode clear at a level (new round, listen, right answer). */
  const clearDecode = async (p: Person, level: number, typingMs = 1500) => {
    const { body: round } = await startHttp(p, 'decode', level);
    listen(round, typingMs);
    const res = await guessHttp(p, round.id, wordOf(round.id));
    t.clock.advance(5000); // refill the limiters and move on
    return res.body;
  };
  const clearEncode = async (p: Person, level: number, seed = 1, unit = 150) => {
    const { body: round } = await startHttp(p, 'encode', level);
    const presses = humanTaps(round.word!, unit, seed);
    t.clock.advance(span(presses) + 1200);
    const res = await tapHttp(p, round.id, presses);
    t.clock.advance(5000);
    return res.body;
  };
  const morsePoints = (id: number) => t.ctx.points.totalFrom(id, 'morse');

  // -------------------------------------------------------------------------
  describe('state, gating, on/off', () => {
    it('is attendee-only and starts with level 1 open, the rest locked', async () => {
      expect((await req(t.app, null, 'GET', '/api/morse/state')).statusCode).toBe(401);
      const s = (await req(t.app, a.jar, 'GET', '/api/morse/state')).json();
      expect(s.enabled).toBe(true);
      expect(s.decode.map((l: { unlocked: boolean }) => l.unlocked)).toEqual([true, false, false, false, false]);
      expect(s.ladder).toHaveLength(LADDER.length);
      expect(s.openRound).toBeNull();
    });

    it('refuses a locked level and an invalid level', async () => {
      expect((await startHttp(a, 'decode', 2)).status).toBe(403);
      expect((await req(t.app, a.jar, 'POST', '/api/morse/rounds', { mode: 'decode', level: 9 })).statusCode).toBe(400);
      expect((await req(t.app, a.jar, 'POST', '/api/morse/rounds', { mode: 'telepathy', level: 1 })).statusCode).toBe(400);
    });

    it('unlocks the next level only after clearing the previous, per mode', async () => {
      await clearDecode(a, 1);
      const s = (await req(t.app, a.jar, 'GET', '/api/morse/state')).json();
      expect(s.decode.map((l: { unlocked: boolean }) => l.unlocked)).toEqual([true, true, false, false, false]);
      expect(s.encode.map((l: { unlocked: boolean }) => l.unlocked)).toEqual([true, false, false, false, false]);
      expect((await startHttp(a, 'decode', 2)).status).toBe(200);
    });

    it('organiser off blocks attendee actions and broadcasts; on restores', async () => {
      const admin = await adminJar(t.app);
      const live = capture(t.ctx, { attendeeId: a.id, admin: false, screen: false });
      expect((await req(t.app, a.jar, 'PUT', '/api/morse/admin/enabled', { enabled: false })).statusCode).toBe(401);
      expect((await req(t.app, admin, 'PUT', '/api/morse/admin/enabled', { enabled: false })).statusCode).toBe(200);
      expect(live.events.find((e) => e.type === 'morse.state')?.data).toEqual({ enabled: false, sprint: null });
      const r = await startHttp(a, 'decode', 1);
      expect(r.status).toBe(403);
      expect(((await req(t.app, a.jar, 'GET', '/api/morse/state')).json() as { enabled: boolean }).enabled).toBe(false);
      await req(t.app, admin, 'PUT', '/api/morse/admin/enabled', { enabled: true });
      expect((await startHttp(a, 'decode', 1)).status).toBe(200);
      live.unsub();
    });

    it('turning it off mid round blocks the answer too', async () => {
      const admin = await adminJar(t.app);
      const { body } = await startHttp(a, 'decode', 1);
      listen(body);
      await req(t.app, admin, 'PUT', '/api/morse/admin/enabled', { enabled: false });
      expect((await guessHttp(a, body.id, wordOf(body.id))).status).toBe(403);
    });
  });

  // -------------------------------------------------------------------------
  describe('decode rounds', () => {
    it('never sends the word, and the signal carries it as timings only', async () => {
      const r = await req(t.app, a.jar, 'POST', '/api/morse/rounds', { mode: 'decode', level: 1 });
      const round = r.json() as Round;
      const word = wordOf(round.id);
      expect(round.word).toBeNull();
      expect(r.body.toLowerCase()).not.toContain(word);
      expect(round.letters).toBe(word.length);
      expect(round.signal).not.toBeNull();
      // segments alternate on/off, start and end on, and match the word at the round's speed
      const sig = round.signal!;
      expect(sig.segments.length % 2).toBe(1);
      expect(sig.unitMs).toBe(Math.round(1200 / levelDef(1).decodeWpm));
      const expectedOn = wordToPatterns(word).join('').length;
      expect(Math.ceil(sig.segments.length / 2)).toBe(expectedOn);
      // the state endpoint (resume) also hides it
      const st = await req(t.app, a.jar, 'GET', '/api/morse/state');
      expect(st.body.toLowerCase()).not.toContain(`"${word}"`);
      expect((st.json() as { openRound: Round }).openRound.id).toBe(round.id);
    });

    it('rejects an answer before the beeps are over (no attempt used, nothing revealed)', async () => {
      const { body: round } = await startHttp(a, 'decode', 1);
      t.clock.advance(300);
      const res = await guessHttp(a, round.id, wordOf(round.id));
      expect(res.body.passed).toBe(false);
      expect(res.body.verdict).toBe('too_early');
      expect(res.body.word).toBeNull();
      expect(res.body.attemptsLeft).toBe(2);
      expect(morsePoints(a.id)).toBe(0);
    });

    it('scores a right answer, pays level points, unlocks the sticker, and pays once', async () => {
      const before = t.ctx.points.total(a.id);
      const { body: round } = await startHttp(a, 'decode', 1);
      listen(round, 800); // fast typist
      const res = (await guessHttp(a, round.id, wordOf(round.id).toUpperCase())).body;
      expect(res.passed).toBe(true);
      expect(res.over).toBe(true);
      expect(res.firstClear).toBe(true);
      expect(res.score).toBeGreaterThanOrEqual(60);
      expect(res.score).toBeLessThanOrEqual(100);
      const pts = pointsForScore(levelDef(1).basePoints, res.score);
      expect(res.pointsAwarded).toBe(pts);
      expect(t.ctx.points.total(a.id)).toBe(before + pts);
      expect(res.word).toBe(wordOf(round.id).toUpperCase());
      expect(t.ctx.stickers.unlockedBy(a.id)['morse-first-decode']).toBeDefined();
      // the same round again is closed
      const again = await guessHttp(a, round.id, wordOf(round.id));
      expect(again.body.passed).toBe(false);
      expect(again.body.verdict).toBe('closed');
      expect(t.ctx.points.total(a.id)).toBe(before + pts);
    });

    it('faster answers score higher than slower ones', async () => {
      const fast = await clearDecode(a, 1, 500);
      const slow = await clearDecode(b, 1, 30_000);
      expect(fast.score).toBeGreaterThan(slow.score);
      expect(slow.score).toBeGreaterThanOrEqual(60);
    });

    it('gives two attempts: wrong then right passes; wrong twice ends and reveals the word', async () => {
      const { body: r1 } = await startHttp(a, 'decode', 1);
      listen(r1);
      const w1 = await guessHttp(a, r1.id, 'zzzz');
      expect(w1.body.passed).toBe(false);
      expect(w1.body.over).toBe(false);
      expect(w1.body.attemptsLeft).toBe(1);
      expect(w1.body.word).toBeNull();
      expect(w1.body.letterOk).toEqual([]); // no positional hints while still playable
      const ok = await guessHttp(a, r1.id, wordOf(r1.id));
      expect(ok.body.passed).toBe(true);

      t.clock.advance(5000);
      const { body: r2 } = await startHttp(a, 'decode', 1);
      listen(r2);
      await guessHttp(a, r2.id, 'nope');
      const second = await guessHttp(a, r2.id, 'nada');
      expect(second.body.over).toBe(true);
      expect(second.body.word).toBe(wordOf(r2.id).toUpperCase());
      expect((await guessHttp(a, r2.id, wordOf(r2.id))).body.verdict).toBe('closed'); // cannot try again on a spent round
    });

    it('is a 404 on someone else\'s round and a 409 on the wrong mode', async () => {
      const { body: round } = await startHttp(a, 'decode', 1);
      listen(round);
      expect((await guessHttp(b, round.id, wordOf(round.id))).status).toBe(404);
      expect((await tapHttp(a, round.id, [[0, 100]])).status).toBe(409);
      expect((await guessHttp(a, 'does-not-exist', 'x')).status).toBe(404);
    });

    it('expires: a guess after the answer window is refused', async () => {
      const { body: round } = await startHttp(a, 'decode', 1);
      t.clock.set(round.expiresAt + 1);
      const res = await guessHttp(a, round.id, wordOf(round.id));
      expect(res.body.passed).toBe(false);
      expect(res.body.verdict).toBe('expired');
      expect(morsePoints(a.id)).toBe(0);
    });

    it('starting a new round retires the old one (one live round each)', async () => {
      const { body: r1 } = await startHttp(a, 'decode', 1);
      t.clock.advance(3000);
      const { body: r2 } = await startHttp(a, 'decode', 1);
      listen(r2);
      expect((await guessHttp(a, r1.id, wordOf(r1.id))).body.verdict).toBe('closed');
      expect((await guessHttp(a, r2.id, wordOf(r2.id))).body.passed).toBe(true);
    });

    it('validates the guess payload and rate limits answer spam', async () => {
      const { body: round } = await startHttp(a, 'decode', 1);
      listen(round);
      expect((await req(t.app, a.jar, 'POST', `/api/morse/rounds/${round.id}/guess`, { guess: '' })).statusCode).toBe(400);
      expect((await req(t.app, a.jar, 'POST', `/api/morse/rounds/${round.id}/guess`, { guess: 'x'.repeat(40) })).statusCode).toBe(400);
      expect((await req(t.app, a.jar, 'POST', `/api/morse/rounds/${round.id}/guess`, {})).statusCode).toBe(400);
      let limited = 0;
      for (let i = 0; i < 20; i++) if ((await req(t.app, a.jar, 'POST', `/api/morse/rounds/${round.id}/guess`, { guess: 'abc' })).statusCode === 429) limited++;
      expect(limited).toBeGreaterThan(0);
    });

    it('rate limits round spam', async () => {
      let limited = 0;
      for (let i = 0; i < 14; i++) if ((await startHttp(a, 'decode', 1)).status === 429) limited++;
      expect(limited).toBeGreaterThan(0);
    });

    it('does not repeat the same word back to back', async () => {
      const seen: string[] = [];
      for (let i = 0; i < 6; i++) {
        const { body } = await startHttp(a, 'decode', 1);
        seen.push(wordOf(body.id));
        t.clock.advance(5000);
      }
      for (let i = 1; i < seen.length; i++) expect(seen[i]).not.toBe(seen[i - 1]);
    });
  });

  // -------------------------------------------------------------------------
  describe('points: best score is idempotent', () => {
    it('a replay with a lower or equal score pays nothing; a higher one pays only the difference', async () => {
      const first = await clearDecode(a, 1, 30_000); // slow => low score
      const afterFirst = morsePoints(a.id);
      expect(afterFirst).toBe(pointsForScore(levelDef(1).basePoints, first.score));

      const worse = await clearDecode(a, 1, 60_000);
      expect(worse.pointsAwarded).toBe(0);
      expect(worse.newBest).toBe(false);
      expect(morsePoints(a.id)).toBe(afterFirst);

      const better = await clearDecode(a, 1, 200); // lightning
      expect(better.newBest).toBe(true);
      expect(better.firstClear).toBe(false);
      expect(better.bestScore).toBe(better.score);
      expect(morsePoints(a.id)).toBe(pointsForScore(levelDef(1).basePoints, better.score));
      expect(better.pointsAwarded).toBe(pointsForScore(levelDef(1).basePoints, better.score) - afterFirst);

      // farming the same top score again does nothing
      const total = morsePoints(a.id);
      for (let i = 0; i < 4; i++) await clearDecode(a, 1, 200);
      expect(morsePoints(a.id)).toBe(total);
    });

    it('a failed replay never loses points', async () => {
      await clearDecode(a, 1);
      const total = morsePoints(a.id);
      const { body: round } = await startHttp(a, 'decode', 1);
      listen(round);
      await guessHttp(a, round.id, 'no');
      await guessHttp(a, round.id, 'no');
      expect(morsePoints(a.id)).toBe(total);
      const s = (await req(t.app, a.jar, 'GET', '/api/morse/state')).json();
      expect(s.decode[0].bestScore).toBeGreaterThan(0);
    });

    it('state reports points, best, attempts and how many others cleared', async () => {
      await clearDecode(a, 1);
      await clearDecode(b, 1);
      t.clock.advance(3000);
      const s = (await req(t.app, a.jar, 'GET', '/api/morse/state')).json();
      expect(s.decode[0].clearedByOthers).toBe(2);
      expect(s.morsePoints).toBe(morsePoints(a.id));
      expect(s.players).toBe(2);
    });

    it('clearing all five decode levels pays the ladder bonus once and unlocks bat ears', async () => {
      let sum = 0;
      for (let lvl = 1; lvl <= 5; lvl++) {
        const r = await clearDecode(a, lvl, 300);
        expect(r.passed, `level ${lvl}`).toBe(true);
        sum += r.pointsAwarded;
        if (lvl === 5) expect(r.pointsAwarded).toBeGreaterThanOrEqual(LADDER_BONUS);
      }
      expect(morsePoints(a.id)).toBe(sum);
      expect(t.ctx.stickers.unlockedBy(a.id)['morse-decoder']).toBeDefined();
      expect(t.ctx.points.has(a.id, 'morse', 'ladder-decode')).toBe(true);
      // replaying level 5 at the same speed does not pay the bonus again
      const total = morsePoints(a.id);
      await clearDecode(a, 5, 300);
      expect(morsePoints(a.id)).toBeLessThanOrEqual(total + 40);
      expect([...t.ctx.db.prepare("SELECT ref FROM points_ledger WHERE attendee_id = ? AND ref = 'ladder-decode'").all(a.id)]).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('encode rounds', () => {
    it('sends the word to tap and no signal', async () => {
      const { body: round } = await startHttp(a, 'encode', 1);
      expect(round.word).toBe(wordOf(round.id).toUpperCase());
      expect(round.signal).toBeNull();
      expect(round.attemptsLeft).toBe(3);
    });

    it('passes a jittery human at several speeds, pays, and reports per-press detail', async () => {
      for (const [i, unit] of [90, 150, 240].entries()) {
        const { body: round } = await startHttp(a, 'encode', 1);
        const presses = humanTaps(round.word!, unit, 10 + i);
        t.clock.advance(span(presses) + 1500);
        const res = (await tapHttp(a, round.id, presses)).body;
        expect(res.verdict, `unit ${unit}`).toBe('ok');
        expect(res.passed).toBe(true);
        expect(res.presses).toHaveLength(presses.length);
        expect(res.wpm).toBeGreaterThan(0);
        expect(res.rhythm).toBeGreaterThan(0.3);
        expect(res.score).toBeGreaterThanOrEqual(40);
        t.clock.advance(5000);
      }
      expect(morsePoints(a.id)).toBeGreaterThan(0);
      expect(t.ctx.stickers.unlockedBy(a.id)['morse-first-encode']).toBeDefined();
    });

    it('faster consistent tapping beats slow consistent tapping on score, both pass', async () => {
      const slow = await clearEncode(a, 1, 3, 260);
      const fast = await clearEncode(b, 1, 3, 100);
      expect(slow.passed).toBe(true);
      expect(fast.passed).toBe(true);
      expect(fast.score).toBeGreaterThan(slow.score);
    });

    it('wrong letter fails, says what it read, keeps the round open for a retry', async () => {
      const { body: round } = await startHttp(a, 'encode', 1);
      // tap the word with its last letter swapped for another
      const word = round.word!;
      const wrong = word.slice(0, -1) + (word.endsWith('E') ? 'T' : 'E');
      const presses = humanTaps(wrong, 150, 5);
      t.clock.advance(span(presses) + 1500);
      const res = (await tapHttp(a, round.id, presses)).body;
      expect(res.passed).toBe(false);
      expect(res.verdict).toBe('wrong');
      expect(res.decoded).toBe(wrong);
      expect(res.over).toBe(false);
      expect(res.attemptsLeft).toBe(2);
      expect(morsePoints(a.id)).toBe(0);
    });

    it('an extra letter fails', async () => {
      // level 1 is unlocked; use a word known from the round
      const { body: round } = await startHttp(a, 'encode', 1);
      const presses = humanTaps(`${round.word}E`, 150, 6);
      t.clock.advance(span(presses) + 1500);
      const res = (await tapHttp(a, round.id, presses)).body;
      expect(res.passed).toBe(false);
      expect(res.verdict).toBe('wrong');
      expect(res.decoded).toBe(`${round.word}E`);
    });

    it('a missing letter fails', async () => {
      const { body: round } = await startHttp(a, 'encode', 1);
      const presses = humanTaps(round.word!.slice(0, -1), 150, 7);
      t.clock.advance(span(presses) + 1500);
      const res = (await tapHttp(a, round.id, presses)).body;
      expect(res.passed).toBe(false);
    });

    it('too fast (sub-human unit) and too slow (asleep) taps fail with a clear verdict', async () => {
      const { body: r1 } = await startHttp(a, 'encode', 1);
      const fast = humanTaps(r1.word!, 25, 8, { press: 0.03, gap: 0.05 });
      t.clock.advance(span(fast) + 1500);
      const f = (await tapHttp(a, r1.id, fast)).body;
      expect(f.passed).toBe(false);
      expect(['too_fast', 'invalid']).toContain(f.verdict);

      t.clock.advance(5000);
      const { body: r2 } = await startHttp(a, 'encode', 1);
      const slow = humanTaps(r2.word!, 700, 9);
      t.clock.advance(span(slow) + 1500);
      const s = (await tapHttp(a, r2.id, slow)).body;
      expect(s.passed).toBe(false);
      expect(s.verdict).toBe('too_slow');
      expect(morsePoints(a.id)).toBe(0);
    });

    it('a pasted machine-perfect sequence is flagged robotic even with plenty of time', async () => {
      const { body: round } = await startHttp(a, 'encode', 1);
      const perfect = humanTaps(round.word!, 130, 1, { press: 0, gap: 0 });
      t.clock.advance(span(perfect) + 2000);
      const res = (await tapHttp(a, round.id, perfect)).body;
      expect(res.passed).toBe(false);
      expect(res.verdict).toBe('robotic');
    });

    it('a pasted sequence submitted impossibly fast after the round started is refused, however human it looks', async () => {
      const { body: round } = await startHttp(a, 'encode', 1);
      const looksHuman = humanTaps(round.word!, 200, 21);
      expect(span(looksHuman)).toBeGreaterThan(1500);
      t.clock.advance(100); // 100 ms after the round began
      const res = (await tapHttp(a, round.id, looksHuman)).body;
      expect(res.passed).toBe(false);
      expect(res.verdict).toBe('too_quick');
      expect(morsePoints(a.id)).toBe(0);
      // and it used up an attempt, so spamming pastes ends the round
      t.clock.advance(100);
      await tapHttp(a, round.id, looksHuman);
      t.clock.advance(100);
      const third = (await tapHttp(a, round.id, looksHuman)).body;
      expect(third.over).toBe(true);
      expect(third.attemptsLeft).toBe(0);
    });

    it('a retry is measured from the previous attempt, not from the round start', async () => {
      const { body: round } = await startHttp(a, 'encode', 1);
      const good = humanTaps(round.word!, 200, 22);
      // a long wait, then a wrong attempt...
      t.clock.advance(20_000);
      const wrong = humanTaps('E', 200, 1);
      t.clock.advance(span(wrong) + 500);
      await tapHttp(a, round.id, wrong);
      // ...then right away a long perfect-looking sequence cannot have been tapped in 50 ms
      t.clock.advance(50);
      const res = (await tapHttp(a, round.id, good)).body;
      expect(res.verdict).toBe('too_quick');
    });

    it('rejects malformed presses at the schema and nonsense at the judge', async () => {
      const { body: round } = await startHttp(a, 'encode', 1);
      const url = `/api/morse/rounds/${round.id}/taps`;
      expect((await req(t.app, a.jar, 'POST', url, { presses: [] })).statusCode).toBe(400);
      expect((await req(t.app, a.jar, 'POST', url, { presses: [[0, -5]] })).statusCode).toBe(400);
      expect((await req(t.app, a.jar, 'POST', url, { presses: 'dit dah' })).statusCode).toBe(400);
      expect((await req(t.app, a.jar, 'POST', url, { presses: Array.from({ length: 500 }, (_, i) => [i * 100, i * 100 + 50]) })).statusCode).toBe(400);
      t.clock.advance(3000);
      const res = (await tapHttp(a, round.id, [[0, 100], [50, 120]])).body; // overlapping
      expect(res.verdict).toBe('invalid');
      expect(res.passed).toBe(false);
    });

    it('expires after the round time', async () => {
      const { body: round } = await startHttp(a, 'encode', 1);
      t.clock.set(round.expiresAt + 5);
      const presses = humanTaps(round.word!, 150, 3);
      expect((await tapHttp(a, round.id, presses)).body.verdict).toBe('expired');
    });

    it('encode ladder is gated and pays its own bonus', async () => {
      expect((await startHttp(a, 'encode', 2)).status).toBe(403);
      for (let lvl = 1; lvl <= 5; lvl++) {
        const r = await clearEncode(a, lvl, lvl * 11, 140);
        expect(r.passed, `level ${lvl}: ${r.verdict} ${r.decoded}`).toBe(true);
      }
      expect(t.ctx.stickers.unlockedBy(a.id)['morse-telegrapher']).toBeDefined();
      expect(t.ctx.points.has(a.id, 'morse', 'ladder-encode')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe('board, projector, live events', () => {
    it('streams a clear to screens and consoles but not to other phones', async () => {
      const screen = capture(t.ctx, { attendeeId: null, admin: false, screen: true });
      const phone = capture(t.ctx, { attendeeId: b.id, admin: false, screen: false });
      await clearDecode(a, 1);
      const feed = screen.events.filter((e) => e.type === 'morse.cleared');
      expect(feed).toHaveLength(1);
      expect(feed[0]?.data).toMatchObject({ nickname: 'anna', mode: 'decode', level: 1, firstClear: true });
      expect(phone.types()).not.toContain('morse.cleared');
      // replays that do not improve the best publish nothing new
      await clearDecode(a, 1, 60_000);
      expect(screen.events.filter((e) => e.type === 'morse.cleared')).toHaveLength(1);
      screen.unsub();
      phone.unsub();
    });

    it('board ranks by morse points, shows me, and the projector and console overviews are guarded', async () => {
      await clearDecode(a, 1, 300);
      await clearDecode(a, 2, 300);
      await clearDecode(b, 1, 300);
      t.clock.advance(3000);
      const board = (await req(t.app, b.jar, 'GET', '/api/morse/board')).json();
      expect(board.top.map((r: { nickname: string }) => r.nickname)).toEqual(['anna', 'bala']);
      expect(board.me.nickname).toBe('bala');
      expect(board.me.rank).toBe(2);
      expect(board.top[0].decodeCleared).toBe(2);
      expect((await req(t.app, null, 'GET', '/api/morse/board')).statusCode).toBe(401);
      expect((await req(t.app, null, 'GET', '/api/morse/screen')).statusCode).toBe(401);
      expect((await req(t.app, a.jar, 'GET', '/api/morse/admin')).statusCode).toBe(401);
      const admin = await adminJar(t.app);
      const ov = (await req(t.app, admin, 'GET', '/api/morse/admin')).json();
      expect(ov.clears.decode).toEqual([2, 1, 0, 0, 0]);
      expect(ov.players).toBe(2);
      expect(ov.recent.length).toBe(3);
      expect((await req(t.app, admin, 'GET', '/api/morse/screen')).statusCode).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  describe('speed rounds (sprint)', () => {
    const startSprint = async (mode: 'decode' | 'encode' = 'decode', level = 1, durationSec = 60) => {
      const admin = await adminJar(t.app);
      const r = await req(t.app, admin, 'POST', '/api/morse/admin/sprint', { mode, level, durationSec });
      return { admin, status: r.statusCode, body: r.json() };
    };

    it('is console-only, bounded, and one at a time', async () => {
      expect((await req(t.app, a.jar, 'POST', '/api/morse/admin/sprint', { mode: 'decode', level: 1, durationSec: 60 })).statusCode).toBe(401);
      const admin = await adminJar(t.app);
      expect((await req(t.app, admin, 'POST', '/api/morse/admin/sprint', { mode: 'decode', level: 1, durationSec: 5 })).statusCode).toBe(400);
      expect((await startSprint()).status).toBe(200);
      expect((await startSprint()).status).toBe(409);
    });

    it('needs a running sprint, forces its mode and level, and ignores ladder gating', async () => {
      expect((await startHttp(a, 'decode', 1, true)).status).toBe(409);
      const { body: sp } = await startSprint('decode', 3, 60);
      const live = (await startHttp(a, 'encode', 1, true)).body; // asks for encode L1, gets the sprint's decode L3
      expect(live.mode).toBe('decode');
      expect(live.level).toBe(3);
      expect(live.sprint).toBe(true);
      expect(live.expiresAt).toBeLessThanOrEqual(sp.endsAt);
    });

    it('sprint passes add up per attendee, do not touch ladder points, and the podium is paid once at the end', async () => {
      const kits = await makeKits(t.app, 1);
      const c = await signedInAttendee(t.app, kits[0]!, 'chitra');
      const screen = capture(t.ctx, { attendeeId: null, admin: false, screen: true });
      const { admin } = await startSprint('decode', 1, 600);
      const play = async (p: Person, n: number, typing: number) => {
        let last = 0;
        for (let i = 0; i < n; i++) {
          const { body: round } = await startHttp(p, 'decode', 1, true);
          listen(round, typing);
          const res = (await guessHttp(p, round.id, wordOf(round.id))).body;
          expect(res.passed).toBe(true);
          expect(res.pointsAwarded).toBe(0);
          last = res.sprintScore ?? 0;
          t.clock.advance(4000);
        }
        return last;
      };
      const sa = await play(a, 3, 300);
      const sb = await play(b, 2, 300);
      const sc = await play(c, 1, 300);
      expect(sa).toBeGreaterThan(sb);
      expect(sb).toBeGreaterThan(sc);
      expect(morsePoints(a.id)).toBe(0);
      expect((await req(t.app, a.jar, 'GET', '/api/morse/state')).json().sprint.top[0].nickname).toBe('anna');

      tick(t.ctx);
      expect(screen.types()).toContain('morse.sprint-board');
      tick(t.ctx); // unchanged board is not re-published
      expect(screen.events.filter((e) => e.type === 'morse.sprint-board')).toHaveLength(1);

      t.clock.advance(700_000); // well past the 600 s end
      tick(t.ctx);
      expect(t.ctx.points.totalFrom(a.id, 'morse.sprint')).toBe(SPRINT_PRIZES.first);
      expect(t.ctx.points.totalFrom(b.id, 'morse.sprint')).toBe(SPRINT_PRIZES.second);
      expect(t.ctx.points.totalFrom(c.id, 'morse.sprint')).toBe(SPRINT_PRIZES.third);
      expect(t.ctx.stickers.unlockedBy(a.id)['morse-sprinter']).toBeDefined();
      const ended = screen.events.find((e) => e.type === 'morse.sprint-ended');
      expect((ended?.data as { top: { nickname: string }[] }).top.map((r) => r.nickname)).toEqual(['anna', 'bala', 'chitra']);
      // ending again (tick, or the button) pays nothing more
      tick(t.ctx);
      expect((await req(t.app, admin, 'POST', '/api/morse/admin/sprint/end')).statusCode).toBe(409);
      expect(t.ctx.points.totalFrom(a.id, 'morse.sprint')).toBe(SPRINT_PRIZES.first);
      const ov = (await req(t.app, admin, 'GET', '/api/morse/screen')).json();
      expect(ov.sprint).toBeNull();
      expect(ov.lastSprint.top[0].nickname).toBe('anna');
      screen.unsub();
    });

    it('an answer landing after the sprint ended does not count', async () => {
      const { admin } = await startSprint('decode', 1, 30);
      const { body: round } = await startHttp(a, 'decode', 1, true);
      listen(round, 500);
      expect((await req(t.app, admin, 'POST', '/api/morse/admin/sprint/end')).statusCode).toBe(200);
      const res = (await guessHttp(a, round.id, wordOf(round.id))).body;
      expect(res.passed).toBe(false);
      expect(['closed', 'sprint_over', 'expired']).toContain(res.verdict);
    });

    it('encode sprints work the same way', async () => {
      await startSprint('encode', 1, 60);
      const { body: round } = await startHttp(a, 'encode', 1, true);
      const presses = humanTaps(round.word!, 150, 4);
      t.clock.advance(span(presses) + 1200);
      const res = (await tapHttp(a, round.id, presses)).body;
      expect(res.passed).toBe(true);
      expect(res.sprintScore).toBe(res.score);
    });

    it('ladder rounds still work during a sprint', async () => {
      await startSprint('decode', 4, 60);
      const r = await clearDecode(a, 1);
      expect(r.passed).toBe(true);
      expect(r.pointsAwarded).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('danger zone', () => {
    it('reset needs the typed phrase, the console, and wipes morse points and stickers only', async () => {
      await clearDecode(a, 1);
      t.ctx.points.award({ attendeeId: a.id, source: 'polls', ref: 'p1', points: 7 });
      const others = t.ctx.points.total(a.id) - morsePoints(a.id);
      const admin = await adminJar(t.app);
      expect((await req(t.app, a.jar, 'POST', '/api/morse/admin/reset', { confirm: 'RESET MORSE' })).statusCode).toBe(401);
      expect((await req(t.app, admin, 'POST', '/api/morse/admin/reset', { confirm: 'yes' })).statusCode).toBe(400);
      expect(morsePoints(a.id)).toBeGreaterThan(0);
      expect((await req(t.app, admin, 'POST', '/api/morse/admin/reset', { confirm: 'RESET MORSE' })).statusCode).toBe(200);
      expect(morsePoints(a.id)).toBe(0);
      expect(t.ctx.points.total(a.id)).toBe(others);
      expect(t.ctx.stickers.unlockedBy(a.id)['morse-first-decode']).toBeUndefined();
      const s = (await req(t.app, a.jar, 'GET', '/api/morse/state')).json();
      expect(s.decode.every((l: { cleared: boolean }) => !l.cleared)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe('seed', () => {
    it('loads demo history without error and is safe on an empty app', async () => {
      const { morse } = await import('./index');
      await morse.seed?.(t.ctx);
      expect(((await req(t.app, a.jar, 'GET', '/api/morse/state')).json() as { enabled: boolean }).enabled).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// the hot path with a crowd
// ---------------------------------------------------------------------------

describe('morse at 300 phones', () => {
  it('300 attendees play decode and encode rounds, with boards read repeatedly, in well under a few seconds', async () => {
    const t = await makeApp();
    const db = t.ctx.db;
    const N = 300;
    // Attendees straight into the core tables (signing in 300 times would just time scrypt).
    const ids: number[] = [];
    for (let i = 0; i < N; i++) {
      db.prepare('INSERT INTO kits (id, password_hash, created_at) VALUES (?, ?, ?)').run(`AH-${1000 + i}`, 'x', t.clock.now());
      const r = db
        .prepare("INSERT INTO attendees (kit_id, name, roll, nickname, avatar, profile_complete, first_signin_at) VALUES (?, 'n', 'r', ?, NULL, 1, ?)")
        .run(`AH-${1000 + i}`, `p${i}`, t.clock.now());
      ids.push(Number(r.lastInsertRowid));
    }
    const wordOf = (id: string) => (db.prepare('SELECT word FROM morse_rounds WHERE id = ?').get(id) as { word: string }).word;
    const admin = await adminJar(t.app);
    const t0 = performance.now();
    let passed = 0;
    for (const [i, id] of ids.entries()) {
      const round = startRound(t.ctx, id, 'decode', 1, false);
      t.clock.advance(round.signal!.leadInMs + round.signal!.totalMs + 500 + (i % 7) * 300);
      if (submitGuess(t.ctx, id, round.id, wordOf(round.id)).passed) passed++;
      const enc = startRound(t.ctx, id, 'encode', 1, false);
      const taps = humanTaps(enc.word!, 120 + (i % 5) * 30, i + 1);
      t.clock.advance(span(taps) + 1500);
      if (submitTaps(t.ctx, id, enc.id, taps).passed) passed++;
      if (i % 25 === 0) {
        expect((await req(t.app, admin, 'GET', '/api/morse/admin')).statusCode).toBe(200);
        expect((await req(t.app, admin, 'GET', '/api/morse/board')).statusCode).toBe(200);
      }
    }
    // everyone refreshes the leaderboards at the same moment
    for (let k = 0; k < 40; k++) {
      expect((await req(t.app, admin, 'GET', '/api/morse/board')).statusCode).toBe(200);
      expect((await req(t.app, admin, 'GET', '/api/morse/screen')).statusCode).toBe(200);
    }
    const ms = performance.now() - t0;
    expect(passed).toBeGreaterThanOrEqual(N * 2 - 20); // the odd jittery tap may legitimately miss
    expect(ms).toBeLessThan(8000);
    const ov = (await req(t.app, admin, 'GET', '/api/morse/admin')).json();
    expect(ov.clears.decode[0]).toBe(N);
    endSprint(t.ctx, 999); // unknown sprint id: a harmless no-op
    await t.close();
  });
});
