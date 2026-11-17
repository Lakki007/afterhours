import type { LiveEnvelope } from '@afterhours/shared';
import {
  POLL_LIMITS,
  type PollDefinitionInput,
  type PollResults,
  type PollView,
  type PublicPoll,
  type VoteRequest,
} from '@afterhours/shared/features/polls';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { COOKIES, createSession } from '../../core/auth/sessions';
import { Jar, type TestApp, adminJar, capture, makeApp, req } from '../../../test/helpers';
import { PARTICIPATION_POINTS, flush, expire } from './index';
import { reconcileQuizPayouts, payOutQuiz } from './service';
import { SEED_POLLS, SEED_QUIZ, seedPolls } from './seed';
import { type PollRow, getRow } from './store';
import { checkWord, isProfane } from './words';

interface Person {
  jar: Jar;
  id: number;
}

/** Make attendees straight in the database (hashing 300 kit passwords would take a minute). */
type People = [Person, Person, Person, Person, Person, ...Person[]];
function people(t: TestApp, n: number): People {
  const out: Person[] = [];
  const db = t.ctx.db;
  db.exec('BEGIN');
  for (let i = 0; i < n; i++) {
    const kit = `T-${String(i).padStart(4, '0')}`;
    db.prepare('INSERT INTO kits (id, password_hash, created_at) VALUES (?, ?, ?)').run(kit, 'x', t.clock.now());
    const r = db
      .prepare('INSERT INTO attendees (kit_id, nickname, avatar, profile_complete, first_signin_at) VALUES (?, ?, ?, 1, ?)')
      .run(kit, `nick${i}`, JSON.stringify({ shape: 'blob', color: 'lime', eyes: 'wide', mouth: 'grin', top: 'cap', extra: 'none' }), t.clock.now());
    const id = Number(r.lastInsertRowid);
    const jar = new Jar();
    jar.cookies[COOKIES.attendee] = createSession(t.ctx, 'attendee', id).token;
    out.push({ jar, id });
  }
  db.exec('COMMIT');
  return out as People;
}

describe('polls feature', () => {
  let t: TestApp;
  let admin: Jar;
  beforeEach(async () => {
    t = await makeApp();
    admin = await adminJar(t.app);
  });
  afterEach(async () => t.close());

  // ---- helpers -----------------------------------------------------------------
  async function call(jar: Jar | null, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown) {
    const r = await req(t.app, jar, method, url, body);
    return { status: r.statusCode, body: r.json() as Record<string, unknown>, raw: r.body };
  }
  const create = async (def: PollDefinitionInput): Promise<number> => {
    const r = await call(admin, 'POST', '/api/polls/admin', def);
    expect(r.status, r.raw).toBe(200);
    return (r.body as { poll: { id: number } }).poll.id;
  };
  const launch = (id: number, closeCurrent = false) => call(admin, 'POST', `/api/polls/admin/${id}/launch`, { closeCurrent });
  const close = (id: number) => call(admin, 'POST', `/api/polls/admin/${id}/close`);
  const reveal = (id: number) => call(admin, 'POST', `/api/polls/admin/${id}/reveal`);
  const vote = (p: Person, id: number, v: VoteRequest) => call(p.jar, 'POST', `/api/polls/${id}/vote`, v);
  const view = async (p: Person, id: number) => (await call(p.jar, 'GET', `/api/polls/${id}`)).body as unknown as PollView;
  const quizDef = (over: Partial<Extract<PollDefinitionInput, { kind: 'quiz' }>> = {}): PollDefinitionInput => ({
    kind: 'quiz',
    question: 'which one is right?',
    options: [{ label: 'alpha' }, { label: 'bravo' }, { label: 'charlie' }, { label: 'delta' }],
    correct: 2,
    durationMs: 20_000,
    basePoints: 20,
    speedBonusMax: 20,
    series: 's1',
    ...over,
  });
  const single = (q = 'pick a thing'): PollDefinitionInput => ({ kind: 'single', question: q, options: [{ label: 'a' }, { label: 'b' }, { label: 'c' }] });

  // ---- authoring + guards ----------------------------------------------------------

  it('validates definitions with the shared schema', async () => {
    const bad = async (def: unknown) => expect((await call(admin, 'POST', '/api/polls/admin', def)).status).toBe(400);
    await bad({ kind: 'quiz', question: 'q?? hm', options: [{ label: 'a' }, { label: 'b' }], correct: 5 });
    await bad({ kind: 'single', question: 'only one option', options: [{ label: 'a' }] });
    await bad({ kind: 'multi', question: 'too many picks', options: [{ label: 'a' }, { label: 'b' }], maxChoices: 5 });
    await bad({ kind: 'this_or_that', question: 'three halves', options: [{ label: 'a' }, { label: 'b' }, { label: 'c' }] });
    await bad({ kind: 'weird', question: 'unknown kind' });
    await bad({ kind: 'quiz', question: 'zero clock', options: [{ label: 'a' }, { label: 'b' }], correct: 0, durationMs: 100 });
  });

  it('keeps every console route behind the admin guard and the screen route behind the projector guard', async () => {
    const [p] = people(t, 1);
    for (const [m, url] of [
      ['GET', '/api/polls/admin'],
      ['POST', '/api/polls/admin'],
      ['POST', '/api/polls/admin/1/launch'],
      ['POST', '/api/polls/admin/1/reveal'],
      ['GET', '/api/polls/admin/1/results'],
    ] as const) {
      expect((await call(null, m, url, {})).status, `${m} ${url} anonymous`).toBe(401);
      expect((await call(p!.jar, m, url, {})).status, `${m} ${url} attendee`).toBe(401);
    }
    expect((await call(p!.jar, 'GET', '/api/polls/screen')).status).toBe(401);
    expect((await call(admin, 'GET', '/api/polls/screen')).status).toBe(200);
    expect((await call(null, 'GET', '/api/polls/current')).status).toBe(401);
    expect((await call(null, 'POST', '/api/polls/1/vote', { kind: 'single', choice: 0 })).status).toBe(401);
  });

  it('hides drafts from attendees', async () => {
    const [p] = people(t, 1);
    const id = await create(single());
    expect((await call(p!.jar, 'GET', `/api/polls/${id}`)).status).toBe(404);
    expect((await vote(p!, id, { kind: 'single', choice: 0 })).status).toBe(404);
    expect(((await call(p!.jar, 'GET', '/api/polls/current')).body as { view: unknown }).view).toBeNull();
  });

  it('edits and deletes drafts only, and reorders', async () => {
    const a = await create(single('first one'));
    const b = await create(single('second one'));
    expect((await call(admin, 'PUT', `/api/polls/admin/${a}`, single('renamed one'))).status).toBe(200);
    await call(admin, 'POST', '/api/polls/admin/reorder', { ids: [b, a] });
    const list = (await call(admin, 'GET', '/api/polls/admin')).body as { polls: { poll: PublicPoll }[] };
    expect(list.polls.map((x) => x.poll.id)).toEqual([b, a]);
    await launch(a);
    expect((await call(admin, 'PUT', `/api/polls/admin/${a}`, single('sneaky edit'))).status).toBe(409);
    expect((await call(admin, 'DELETE', `/api/polls/admin/${a}`)).status).toBe(409);
    expect((await call(admin, 'DELETE', `/api/polls/admin/${b}`)).status).toBe(200);
  });

  // ---- lifecycle ---------------------------------------------------------------------

  it('runs draft -> live -> closed -> revealed, one live poll at a time, with a big launch event', async () => {
    const [p] = people(t, 1);
    const phone = capture(t.ctx, { attendeeId: p!.id, admin: false, screen: false });
    const screen = capture(t.ctx, { attendeeId: null, admin: false, screen: true });
    const a = await create(single('first one'));
    const b = await create(single('second one'));

    expect((await reveal(a)).status).toBe(409); // draft cannot be revealed
    expect((await close(a)).status).toBe(409); // draft cannot be closed
    expect((await launch(a)).status).toBe(200);
    for (const who of [phone, screen]) {
      const ev = who.events.find((e) => e.type === 'polls.launched');
      expect(ev, 'launch reaches phones and the projector').toBeDefined();
      expect((ev as LiveEnvelope<'polls.launched'>).data.poll.id).toBe(a);
    }
    expect((await launch(a)).status).toBe(409); // already live
    expect((await launch(b)).status).toBe(409); // one live at a time
    expect(t.ctx.db.prepare("SELECT COUNT(*) AS n FROM polls WHERE status = 'live'").get()).toEqual({ n: 1 });
    expect((await launch(b, true)).status).toBe(200); // closeCurrent hands over
    expect(getRow(t.ctx.db, a)?.status).toBe('closed');
    expect(phone.types().filter((x) => x === 'polls.closed')).toHaveLength(1);

    expect((await call(p!.jar, 'GET', '/api/polls/current')).body).toMatchObject({ view: { poll: { id: b, status: 'live' } } });
    await close(b);
    expect((await launch(b)).status).toBe(409); // closed cannot go live again
    expect((await reveal(b)).status).toBe(200);
    expect((await reveal(b)).status).toBe(409); // already revealed
    expect(phone.types()).toContain('polls.revealed');
  });

  it('the database itself refuses two live polls and two votes from one person', async () => {
    const [p] = people(t, 1);
    const a = await create(single('first one'));
    const b = await create(single('second one'));
    await launch(a);
    expect(() => t.ctx.db.exec(`UPDATE polls SET status = 'live' WHERE id = ${b}`)).toThrow();
    await vote(p!, a, { kind: 'single', choice: 0 });
    expect(() =>
      t.ctx.db.exec(`INSERT INTO poll_votes (poll_id, attendee_id, received_at) VALUES (${a}, ${p!.id}, 1)`),
    ).toThrow();
  });

  // ---- voting rules ----------------------------------------------------------------

  it('one vote per attendee, whatever they try', async () => {
    const [p, q] = people(t, 2);
    const id = await create(single());
    await launch(id);
    expect((await vote(p!, id, { kind: 'single', choice: 0 })).status).toBe(200);
    const again = await vote(p!, id, { kind: 'single', choice: 1 });
    expect(again.status).toBe(409);
    expect((again.body as { error: { code: string } }).error.code).toBe('already_voted');
    expect((await vote(q!, id, { kind: 'single', choice: 1 })).status).toBe(200);
    const res = (await view(p!, id)).results as { counts: number[]; total: number };
    expect(res.counts).toEqual([1, 1, 0]);
    expect(res.total).toBe(2);
  });

  it('rejects votes before launch, after close, for the wrong kind, and out of range', async () => {
    const [p] = people(t, 1);
    const id = await create(single());
    expect((await vote(p!, id, { kind: 'single', choice: 0 })).status).toBe(404); // draft
    await launch(id);
    expect((await vote(p!, id, { kind: 'rating', value: 3 })).status).toBe(400); // wrong kind
    expect((await vote(p!, id, { kind: 'single', choice: 3 })).status).toBe(400); // only 3 options
    expect((await call(p!.jar, 'POST', `/api/polls/${id}/vote`, { kind: 'single', choice: -1 })).status).toBe(400);
    expect((await call(p!.jar, 'POST', `/api/polls/${id}/vote`, { kind: 'single', choice: 'a' })).status).toBe(400);
    await close(id);
    const late = await vote(p!, id, { kind: 'single', choice: 0 });
    expect(late.status).toBe(409);
    expect((late.body as { error: { code: string } }).error.code).toBe('poll_closed');
  });

  it('validates multi, this-or-that and rating payloads', async () => {
    const [p, q, r] = people(t, 3);
    const m = await create({ kind: 'multi', question: 'pick up to two', maxChoices: 2, options: [{ label: 'a' }, { label: 'b' }, { label: 'c' }] });
    await launch(m);
    expect((await vote(p!, m, { kind: 'multi', choices: [0, 1, 2] })).status).toBe(400); // over the cap
    expect((await vote(p!, m, { kind: 'multi', choices: [1, 1] })).status).toBe(400); // duplicate
    expect((await vote(p!, m, { kind: 'multi', choices: [0, 3] })).status).toBe(400); // out of range
    expect((await vote(p!, m, { kind: 'multi', choices: [2, 0] })).status).toBe(200);
    expect((await vote(q!, m, { kind: 'multi', choices: [0] })).status).toBe(200);
    expect(((await view(p!, m)).results as { counts: number[] }).counts).toEqual([2, 0, 1]);
    expect((await view(p!, m)).myVote).toEqual({ kind: 'multi', choices: [0, 2] });
    await close(m);

    const tt = await create({ kind: 'this_or_that', question: 'left or right?', options: [{ label: 'L' }, { label: 'R' }] });
    await launch(tt);
    expect((await call(p!.jar, 'POST', `/api/polls/${tt}/vote`, { kind: 'this_or_that', choice: 2 })).status).toBe(400);
    expect((await vote(p!, tt, { kind: 'this_or_that', choice: 1 })).status).toBe(200);
    await close(tt);

    const rt = await create({ kind: 'rating', question: 'rate it from 1 to 5', scale: { min: 1, max: 5, style: 'slider', lowLabel: '', highLabel: '' } });
    await launch(rt);
    expect((await vote(p!, rt, { kind: 'rating', value: 6 })).status).toBe(400);
    expect((await vote(p!, rt, { kind: 'rating', value: 0 })).status).toBe(400);
    expect((await vote(p!, rt, { kind: 'rating', value: 5 })).status).toBe(200);
    expect((await vote(q!, rt, { kind: 'rating', value: 2 })).status).toBe(200);
    const res = (await vote(r!, rt, { kind: 'rating', value: 5 })).body as { results: Extract<PollResults, { kind: 'rating' }> };
    expect(res.results.histogram).toEqual([0, 1, 0, 0, 2]);
    expect(res.results.average).toBe(4);
  });

  it('rate limits scripted hammering per attendee', async () => {
    const [p] = people(t, 1);
    const id = await create(single());
    await launch(id);
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await vote(p!, id, { kind: 'single', choice: i % 3 })).status);
    expect(codes.filter((c) => c === 429).length).toBeGreaterThanOrEqual(3);
    expect(codes[0]).toBe(200);
  });

  // ---- results visibility ----------------------------------------------------------------

  it('shows results to a phone only after it voted, or at reveal; always to the projector', async () => {
    const [p, q] = people(t, 2);
    const id = await create(single());
    await launch(id);
    await vote(p!, id, { kind: 'single', choice: 1 });
    expect((await view(q!, id)).results).toBeNull(); // has not voted
    expect((await view(p!, id)).results).toMatchObject({ kind: 'single', counts: [0, 1, 0] });
    const screen = (await call(admin, 'GET', '/api/polls/screen')).body as { results: PollResults };
    expect(screen.results).toMatchObject({ kind: 'single', counts: [0, 1, 0] });
    await close(id);
    expect((await view(q!, id)).results).toBeNull(); // closed is not revealed
    await reveal(id);
    expect((await view(q!, id)).results).toMatchObject({ counts: [0, 1, 0] });
  });

  // ---- quiz -------------------------------------------------------------------------------

  describe('quiz', () => {
    /** Collect every byte a given attendee could see while the quiz runs. */
    function leakProbe(p: Person) {
      const feed = capture(t.ctx, { attendeeId: p.id, admin: false, screen: false });
      const seen: string[] = [];
      return {
        feed,
        note: (s: string) => seen.push(s),
        corpus: () => [...seen, ...feed.events.map((e) => JSON.stringify(e))].join('\n'),
      };
    }

    it('never sends the correct answer to any attendee before reveal (responses and live events)', async () => {
      const [a, b] = people(t, 2);
      const probeA = leakProbe(a);
      const probeScreen = capture(t.ctx, { attendeeId: null, admin: false, screen: true });
      const id = await create(quizDef({ correct: 2 }));
      await launch(id);
      t.clock.advance(POLL_LIMITS.quizLeadInMs + 2000);

      const hits = [
        await call(a.jar, 'GET', '/api/polls/current'),
        await call(a.jar, 'GET', `/api/polls/${id}`),
        await call(a.jar, 'GET', '/api/polls/history'),
        await call(admin, 'GET', '/api/polls/screen'),
      ];
      hits.forEach((h) => probeA.note(h.raw));
      probeA.note((await vote(a, id, { kind: 'quiz', choice: 2 })).raw); // the right answer; the reply must not say so
      probeA.note((await vote(b, id, { kind: 'quiz', choice: 0 })).raw);
      flush(t.ctx);
      probeA.note(JSON.stringify((await call(a.jar, 'GET', `/api/polls/${id}`)).body));
      probeA.note((await call(admin, 'GET', '/api/polls/screen')).raw);
      t.clock.advance(30_000);
      expire(t.ctx); // clock runs out: closed, still not revealed
      probeA.note((await call(a.jar, 'GET', `/api/polls/${id}`)).raw);
      probeA.note((await call(admin, 'GET', '/api/polls/screen')).raw);
      probeA.note((await call(a.jar, 'GET', '/api/polls/history')).raw);

      const everything = probeA.corpus() + probeScreen.events.map((e) => JSON.stringify(e)).join('\n');
      expect(everything).not.toMatch(/"correct":\s*(\d|true|false)/); // only "correct":null may appear
      expect(everything).not.toMatch(/"counts"/); // no distribution either
      expect(everything).not.toMatch(/"points":/); // no personal result
      expect(probeA.feed.types()).not.toContain('polls.quiz-result');
      expect(probeA.feed.types()).not.toContain('points.awarded'); // an early +points would say "you were right"
      expect(t.ctx.points.total(a.id)).toBe(0);

      // The console, by contrast, does see it.
      const adm = (await call(admin, 'GET', '/api/polls/admin')).body as { polls: { poll: { correct: number | null } }[] };
      expect(adm.polls[0]?.poll.correct).toBe(2);
      probeA.feed.unsub();
      probeScreen.unsub();
    });

    it('reveals the answer, distribution and personal result after reveal', async () => {
      const [a, b] = people(t, 2);
      const phoneA = capture(t.ctx, { attendeeId: a.id, admin: false, screen: false });
      const phoneB = capture(t.ctx, { attendeeId: b.id, admin: false, screen: false });
      const id = await create(quizDef({ correct: 2 }));
      await launch(id);
      t.clock.advance(POLL_LIMITS.quizLeadInMs + 5000); // 5 s after "go"
      await vote(a, id, { kind: 'quiz', choice: 2 });
      await vote(b, id, { kind: 'quiz', choice: 0 });
      await close(id);
      expect((await reveal(id)).status).toBe(200);

      const va = await view(a, id);
      expect(va.poll).toMatchObject({ kind: 'quiz', correct: 2 });
      expect(va.results).toMatchObject({ kind: 'quiz', revealed: true, correct: 2, counts: [1, 0, 1, 0], right: 1 });
      // base 20 + floor(20 * (1 - 5000/20000)) = 35
      expect(va.myQuiz).toMatchObject({ correct: true, points: 35, speedBonus: 15, elapsedMs: 5000, choice: 2 });
      expect((await view(b, id)).myQuiz).toMatchObject({ correct: false, points: 0, choice: 0 });

      expect(t.ctx.points.total(a.id)).toBe(35);
      expect(t.ctx.points.total(b.id)).toBe(PARTICIPATION_POINTS);
      expect(phoneA.types()).toContain('polls.quiz-result');
      expect(phoneB.events.find((e) => e.type === 'polls.quiz-result')?.data).toMatchObject({ correct: false });
      // a's result never goes to b
      expect(phoneB.events.filter((e) => e.type === 'polls.quiz-result')).toHaveLength(1);
      expect(t.ctx.stickers.unlockedBy(a.id)['polls-quiz-whiz']).toBeDefined();
      expect(t.ctx.stickers.unlockedBy(a.id)['polls-lightning']).toBeDefined(); // 5 s of 20 s is exactly the first quarter
      expect(t.ctx.stickers.unlockedBy(b.id)['polls-quiz-whiz']).toBeUndefined();
    });

    it('scores base + speed bonus from server receipt time, and a late answer is rejected', async () => {
      const ps = people(t, 5);
      const id = await create(quizDef({ correct: 1 }));
      await launch(id);
      const goAt = t.clock.now() + POLL_LIMITS.quizLeadInMs;
      const answerAt = async (p: Person, offset: number) => {
        t.clock.set(goAt + offset);
        return vote(p, id, { kind: 'quiz', choice: 1 });
      };
      // before "go": answer before open
      t.clock.set(goAt - 1);
      const early = await vote(ps[0]!, id, { kind: 'quiz', choice: 1 });
      expect(early.status).toBe(409);
      expect((early.body as { error: { code: string } }).error.code).toBe('too_early');

      expect((await answerAt(ps[0]!, 0)).status).toBe(200); // instant: full bonus
      expect((await answerAt(ps[1]!, 10_000)).status).toBe(200); // half the clock
      expect((await answerAt(ps[2]!, 20_000)).status).toBe(200); // on the buzzer: no bonus
      expect((await answerAt(ps[3]!, 20_000 + POLL_LIMITS.quizGraceMs)).status).toBe(200); // inside the grace window
      const late = await answerAt(ps[4]!, 20_000 + POLL_LIMITS.quizGraceMs + 1);
      expect(late.status).toBe(409);
      expect((late.body as { error: { code: string } }).error.code).toBe('too_late');
      expect(getRow(t.ctx.db, id)?.status).toBe('closed'); // the late answer closed it lazily

      await reveal(id);
      const pts = ps.slice(0, 4).map((p) => t.ctx.points.total(p.id));
      expect(pts).toEqual([40, 30, 20, 20]);
      expect(t.ctx.stickers.unlockedBy(ps[0]!.id)['polls-lightning']).toBeDefined();
      expect(t.ctx.stickers.unlockedBy(ps[1]!.id)['polls-lightning']).toBeUndefined();
      expect(t.ctx.points.total(ps[4]!.id)).toBe(0); // rejected answers are nothing at all
    });

    it('a client cannot claim a faster time: only the server clock counts', async () => {
      const [a] = people(t, 1);
      const id = await create(quizDef({ correct: 0 }));
      await launch(id);
      t.clock.advance(POLL_LIMITS.quizLeadInMs + 15_000);
      const r = await call(a.jar, 'POST', `/api/polls/${id}/vote`, { kind: 'quiz', choice: 0, elapsedMs: 1, receivedAt: 0, points: 999 });
      expect(r.status).toBe(200);
      await close(id);
      await reveal(id);
      expect((await view(a, id)).myQuiz).toMatchObject({ elapsedMs: 15_000, points: 25 });
    });

    it('brute forcing every option gets exactly one answer and stays quiet about which is right', async () => {
      const [a] = people(t, 1);
      const id = await create(quizDef({ correct: 3 }));
      await launch(id);
      t.clock.advance(POLL_LIMITS.quizLeadInMs + 1000);
      const replies: string[] = [];
      const codes: number[] = [];
      for (const choice of [0, 1, 2, 3, 3, 0]) {
        const r = await vote(a, id, { kind: 'quiz', choice });
        codes.push(r.status);
        replies.push(r.raw);
      }
      expect(codes).toEqual([200, 409, 409, 409, 409, 409]);
      // The first (wrong) choice is the one on record; every other try changed nothing.
      await close(id);
      await reveal(id);
      expect((await view(a, id)).myQuiz).toMatchObject({ choice: 0, correct: false });
      expect(t.ctx.points.total(a.id)).toBe(PARTICIPATION_POINTS);
      // The 409s are identical for the right and wrong option: no oracle.
      expect(new Set(replies.slice(1).map((r) => (JSON.parse(r) as { error: { code: string } }).error.code))).toEqual(new Set(['already_voted']));
    });

    it('closes by itself when the clock runs out (server timed)', async () => {
      const [a] = people(t, 1);
      const phone = capture(t.ctx, { attendeeId: a.id, admin: false, screen: false });
      const id = await create(quizDef());
      await launch(id);
      t.clock.advance(POLL_LIMITS.quizLeadInMs + 20_000);
      expire(t.ctx);
      expect(getRow(t.ctx.db, id)?.status).toBe('live'); // still inside the grace window
      t.clock.advance(POLL_LIMITS.quizGraceMs + 1);
      expire(t.ctx);
      expect(getRow(t.ctx.db, id)?.status).toBe('closed');
      const closed = phone.events.find((e) => e.type === 'polls.closed') as LiveEnvelope<'polls.closed'>;
      expect(closed.data.auto).toBe(true);
    });

    it('payouts are idempotent: reveal, retry and boot reconcile never pay twice', async () => {
      const [a] = people(t, 1);
      const id = await create(quizDef({ correct: 1 }));
      await launch(id);
      t.clock.advance(POLL_LIMITS.quizLeadInMs);
      await vote(a, id, { kind: 'quiz', choice: 1 });
      await reveal(id);
      expect((await reveal(id)).status).toBe(409);
      const once = t.ctx.points.total(a.id);
      expect(once).toBe(40);
      const row = getRow(t.ctx.db, id) as PollRow;
      payOutQuiz(t.ctx, row, true);
      reconcileQuizPayouts(t.ctx);
      expect(t.ctx.points.total(a.id)).toBe(once);
    });

    it('keeps a series scoreboard across questions, ties broken by speed', async () => {
      const [a, b, c] = people(t, 3);
      const q1 = await create(quizDef({ question: 'question one is?', correct: 0 }));
      const q2 = await create(quizDef({ question: 'question two is?', correct: 0 }));
      await launch(q1);
      t.clock.advance(POLL_LIMITS.quizLeadInMs);
      await vote(a, q1, { kind: 'quiz', choice: 0 });
      t.clock.advance(4000);
      await vote(b, q1, { kind: 'quiz', choice: 0 });
      await vote(c, q1, { kind: 'quiz', choice: 1 });
      await reveal(q1);
      await launch(q2);
      t.clock.advance(POLL_LIMITS.quizLeadInMs);
      await vote(b, q2, { kind: 'quiz', choice: 0 });
      t.clock.advance(1000);
      await vote(a, q2, { kind: 'quiz', choice: 0 });
      await reveal(q2);
      const screen = (await call(admin, 'GET', '/api/polls/screen')).body as { board: { attendeeId: number; points: number; rank: number; correct: number }[] };
      expect(screen.board.map((e) => e.attendeeId)).toEqual([a!.id, b!.id]); // a: 40 + 39, b: 35 + 40
      expect(screen.board[0]).toMatchObject({ rank: 1, correct: 2 });
      expect(screen.board.some((e) => e.attendeeId === c!.id)).toBe(false); // nothing right, not on the board
    });

    it('a stolen answer by direct DB value never leaks through the poll config', async () => {
      const id = await create(quizDef({ correct: 3 }));
      const row = getRow(t.ctx.db, id) as PollRow;
      expect(row.config).not.toContain('correct');
      expect(row.correct_option).toBe(3);
    });
  });

  // ---- word cloud -----------------------------------------------------------------------------

  describe('word cloud', () => {
    const cloud = (maxWords = 1): PollDefinitionInput => ({ kind: 'wordcloud', question: 'one word for today', maxWords });

    it('normalises, merges and counts', async () => {
      const ps = people(t, 4);
      const id = await create(cloud());
      await launch(id);
      await vote(ps[0]!, id, { kind: 'wordcloud', words: ['  Python '] });
      await vote(ps[1]!, id, { kind: 'wordcloud', words: ['PYTHON'] });
      await vote(ps[2]!, id, { kind: 'wordcloud', words: ['c++'] });
      const r = await vote(ps[3]!, id, { kind: 'wordcloud', words: ['Node.JS'] });
      expect(r.status).toBe(200);
      const res = (await view(ps[0]!, id)).results as Extract<PollResults, { kind: 'wordcloud' }>;
      expect(res.words[0]).toEqual({ word: 'python', count: 2 });
      expect(res.words.map((w) => w.word).sort()).toEqual(['c++', 'node.js', 'python']);
      expect((await view(ps[0]!, id)).myVote).toEqual({ kind: 'wordcloud', words: ['python'] });
    });

    it('allows up to maxWords, dedupes, and rejects extras, junk and links', async () => {
      const [p, q, r, s] = people(t, 4);
      const id = await create(cloud(2));
      await launch(id);
      expect((await vote(p!, id, { kind: 'wordcloud', words: ['a', 'b', 'c'] })).status).toBe(400);
      expect((await vote(p!, id, { kind: 'wordcloud', words: ['!!!'] })).status).toBe(422);
      expect((await vote(p!, id, { kind: 'wordcloud', words: ['x'] })).status).toBe(422); // too short
      expect((await vote(p!, id, { kind: 'wordcloud', words: ['y'.repeat(40)] })).status).toBe(422);
      expect((await vote(p!, id, { kind: 'wordcloud', words: ['http://spam.example'] })).status).toBe(422);
      expect((await vote(p!, id, { kind: 'wordcloud', words: ['<script>alert(1)</script>'] })).status).toBe(200); // tags stripped to plain text
      const mine = (await view(p!, id)).myVote as { words: string[] };
      expect(mine.words.join(' ')).not.toMatch(/[<>()]/);
      expect((await vote(q!, id, { kind: 'wordcloud', words: ['Hello', 'hello'] })).status).toBe(200);
      expect(((await view(q!, id)).myVote as { words: string[] }).words).toEqual(['hello']);
      // a rejected word does not use up the one vote
      expect((await vote(r!, id, { kind: 'wordcloud', words: ['fuck'] })).status).toBe(422);
      expect((await vote(r!, id, { kind: 'wordcloud', words: ['lovely'] })).status).toBe(200);
      void s;
    });

    it('lets an organiser hide a word, live, and unhide it', async () => {
      const ps = people(t, 3);
      const screen = capture(t.ctx, { attendeeId: null, admin: false, screen: true });
      const id = await create(cloud());
      await launch(id);
      await vote(ps[0]!, id, { kind: 'wordcloud', words: ['chaos'] });
      await vote(ps[1]!, id, { kind: 'wordcloud', words: ['chaos'] });
      await vote(ps[2]!, id, { kind: 'wordcloud', words: ['sleepy'] });
      expect((await call(ps[0]!.jar, 'POST', `/api/polls/admin/${id}/words/hide`, { word: 'chaos' })).status).toBe(401);
      expect((await call(admin, 'POST', `/api/polls/admin/${id}/words/hide`, { word: ' CHAOS ' })).status).toBe(200);
      flush(t.ctx);
      const last = screen.events.filter((e) => e.type === 'polls.results').at(-1) as LiveEnvelope<'polls.results'>;
      expect((last.data.results as Extract<PollResults, { kind: 'wordcloud' }>).words.map((w) => w.word)).toEqual(['sleepy']);
      const adm = (await call(admin, 'GET', `/api/polls/admin/${id}/results`)).body as { words: { word: string; count: number; hidden: boolean }[] };
      expect(adm.words).toEqual([
        { word: 'chaos', count: 2, hidden: true },
        { word: 'sleepy', count: 1, hidden: false },
      ]);
      // phones do not see it either, and the voters still count
      expect(((await view(ps[2]!, id)).results as Extract<PollResults, { kind: 'wordcloud' }>).words.map((w) => w.word)).toEqual(['sleepy']);
      await call(admin, 'POST', `/api/polls/admin/${id}/words/unhide`, { word: 'chaos' });
      expect(((await view(ps[2]!, id)).results as Extract<PollResults, { kind: 'wordcloud' }>).words.map((w) => w.word)).toEqual(['chaos', 'sleepy']);
      // hiding on a revealed cloud pushes straight away (nothing else would flush)
      await close(id);
      await reveal(id);
      screen.events.length = 0;
      await call(admin, 'POST', `/api/polls/admin/${id}/words/hide`, { word: 'sleepy' });
      expect(screen.types()).toContain('polls.results');
      screen.unsub();
    });
  });

  // ---- profanity filter ----------------------------------------------------------------------------

  describe('profanity filter', () => {
    const blocked = [
      // English
      'fuck', 'FUCK', 'fuuuuck', 'f*ck', 'f.u.c.k', 'f u c k', 'sh1t', 'b!tch', 'a$$hole', 'bastard', 'dickhead', 'cunt', 'pussy', 'whore',
      // Hindi, romanised
      'madarchod', 'MaDaRcHoD', 'bhenchod', 'behenchod', 'bhosdike', 'chutiya', 'gandu', 'bc', 'mc', 'bsdk', 'lund', 'randi', 'harami', 'bakchod', 'm.c', 'madarch0d',
      // Telugu, romanised
      'lanja', 'lanjakodaka', 'denga', 'dengey', 'pooku', 'gudda', 'erripuku', 'sulli', 'thulla', 'vedava',
    ];
    const allowed = [
      'class', 'assassin', 'assignment', 'classic', 'scunthorpe', 'shiitake', 'cocktail', 'dickens', 'passion', 'grape', 'basement', 'analysis',
      'python', 'c++', 'c#', 'node.js', 'react', 'hackathon', 'placement', 'chai', 'biryani', 'osmania', 'pass hole', 'mccain', 'bcom', 'compute', 'lundberg',
    ];
    it.each(blocked)('blocks %s', (w) => {
      expect(isProfane(w), w).toBe(true);
      expect(checkWord(w)).toMatchObject({ ok: false, reason: 'profane' });
    });
    it.each(allowed)('lets %s through', (w) => {
      expect(isProfane(w), w).toBe(false);
      expect(checkWord(w).ok).toBe(true);
    });
  });

  // ---- hot path: 300 phones --------------------------------------------------------------------------

  it('300 votes in 5 seconds become a few dozen events, not 300 x 300', async () => {
    const ps = people(t, 300);
    const phone = capture(t.ctx, { attendeeId: ps[0]!.id, admin: false, screen: false });
    const screen = capture(t.ctx, { attendeeId: null, admin: false, screen: true });
    const id = await create({ kind: 'single', question: 'biryani or haleem?', options: [{ label: 'biryani' }, { label: 'haleem' }, { label: 'both' }] });
    await launch(id);
    const started = performance.now();
    let flushes = 0;
    let nextFlush = t.clock.now() + 500;
    for (let i = 0; i < 300; i++) {
      t.clock.advance(16); // 300 votes over ~4.8 s
      const r = await vote(ps[i]!, id, { kind: 'single', choice: i % 3 });
      expect(r.status).toBe(200);
      if (t.clock.now() >= nextFlush) {
        flush(t.ctx); // what the 500 ms tick does
        flushes++;
        nextFlush += 500;
      }
    }
    flush(t.ctx);
    const wall = performance.now() - started;

    const resultEvents = phone.events.filter((e) => e.type === 'polls.results');
    expect(resultEvents.length).toBeGreaterThanOrEqual(1);
    expect(resultEvents.length).toBeLessThanOrEqual(12); // ~2/s, not one per vote
    expect(screen.events.filter((e) => e.type === 'polls.results').length).toBe(resultEvents.length);
    expect(flushes).toBeLessThanOrEqual(11);
    const last = resultEvents.at(-1) as LiveEnvelope<'polls.results'>;
    expect(last.data.voters).toBe(300);
    expect(last.data.results).toMatchObject({ total: 300, counts: [100, 100, 100] });
    expect(wall).toBeLessThan(8000); // 300 requests worth of work, nowhere near quadratic
    // Everyone got +2 and a sticker, once.
    expect(t.ctx.points.total(ps[299]!.id)).toBe(PARTICIPATION_POINTS);
    expect(t.ctx.stickers.unlockedBy(ps[299]!.id)['polls-first-vote']).toBeDefined();
    phone.unsub();
    screen.unsub();
  });

  it('300 attendees through a quiz: payout and reveal stay quick and exact', async () => {
    const ps = people(t, 300);
    const id = await create(quizDef({ correct: 1 }));
    await launch(id);
    t.clock.advance(POLL_LIMITS.quizLeadInMs);
    for (let i = 0; i < 300; i++) {
      t.clock.advance(20);
      await vote(ps[i]!, id, { kind: 'quiz', choice: i % 2 }); // half right
    }
    await close(id);
    const started = performance.now();
    await reveal(id);
    expect(performance.now() - started).toBeLessThan(5000);
    const row = t.ctx.db.prepare("SELECT COUNT(*) AS n, SUM(points) AS p FROM points_ledger WHERE source = 'polls.quiz'").get() as { n: number; p: number };
    expect(row.n).toBe(150);
    expect(row.p).toBeGreaterThan(150 * 20);
    const screen = (await call(admin, 'GET', '/api/polls/screen')).body as { board: unknown[]; results: { right: number } };
    expect(screen.board).toHaveLength(10);
    expect(screen.results.right).toBe(150);
  });

  // ---- seed ---------------------------------------------------------------------------------------------

  it('seeds a tech-club afternoon: drafts only, 7 quiz questions, and every seeded poll works end to end', async () => {
    seedPolls(t.ctx);
    seedPolls(t.ctx); // idempotent
    const total = t.ctx.db.prepare('SELECT COUNT(*) AS n FROM polls').get() as { n: number };
    expect(total.n).toBe(SEED_POLLS.length + SEED_QUIZ.length);
    expect(SEED_QUIZ.length).toBeGreaterThanOrEqual(6);
    expect(SEED_QUIZ.length).toBeLessThanOrEqual(8);
    expect(t.ctx.db.prepare("SELECT COUNT(*) AS n FROM polls WHERE status != 'draft'").get()).toEqual({ n: 0 });
    const kinds = new Set((t.ctx.db.prepare('SELECT DISTINCT kind FROM polls').all() as { kind: string }[]).map((k) => k.kind));
    expect([...kinds].sort()).toEqual(['multi', 'quiz', 'rating', 'single', 'this_or_that', 'wordcloud']);

    const [p] = people(t, 1);
    const list = (await call(admin, 'GET', '/api/polls/admin')).body as { polls: { poll: PublicPoll }[] };
    const sample: Record<string, VoteRequest> = {
      single: { kind: 'single', choice: 0 },
      multi: { kind: 'multi', choices: [0] },
      this_or_that: { kind: 'this_or_that', choice: 1 },
      rating: { kind: 'rating', value: 3 },
      wordcloud: { kind: 'wordcloud', words: ['coffee'] },
      quiz: { kind: 'quiz', choice: 0 },
    };
    for (const { poll } of list.polls) {
      await launch(poll.id, true);
      t.clock.advance(POLL_LIMITS.quizLeadInMs + 100);
      expect((await vote(p!, poll.id, sample[poll.kind]!)).status, poll.question).toBe(200);
      t.clock.advance(11_000); // clear the per-attendee rate limit between polls
    }
  });
});

