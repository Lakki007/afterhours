import type { Activity, ScheduleState } from '@afterhours/shared/features/schedule';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Jar, type TestApp, adminJar, capture, makeApp, makeKits, req, signedInAttendee } from '../../../test/helpers';
import { DEMO_AFTERNOON, istOn } from './seed';
import { advance } from './service';

const MIN = 60_000;

describe('schedule feature', () => {
  let t: TestApp;
  let admin: Jar;
  let base = 0;
  const T0 = () => base;

  beforeEach(async () => {
    t = await makeApp();
    admin = await adminJar(t.app);
    base = t.clock.now();
  });
  afterEach(async () => t.close());

  /** Create an activity relative to the fake clock, in minutes. */
  async function make(title: string, fromMin: number, toMin: number, extra: Record<string, unknown> = {}): Promise<number> {
    const r = await req(t.app, admin, 'POST', '/api/schedule', { title, startAt: T0() + fromMin * MIN, endAt: T0() + toMin * MIN, ...extra });
    expect(r.statusCode).toBe(200);
    const s = r.json() as ScheduleState;
    return s.activities.find((a) => a.title === title)!.id;
  }
  const state = async (jar: Jar | null = admin) => (await req(t.app, jar, 'GET', '/api/schedule')).json() as ScheduleState;
  const get = (s: ScheduleState, id: number): Activity => s.activities.find((a) => a.id === id)!;
  /** test helpers' req() has no PATCH; same cookie handling. */
  const patch = (jar: Jar | null, id: number, body: unknown) =>
    t.app.inject({ method: 'PATCH', url: `/api/schedule/${id}`, payload: body as object, headers: jar ? { cookie: jar.header } : {} });
  const post = (path: string, body?: unknown) => req(t.app, admin, 'POST', `/api/schedule${path}`, body);
  /** start/end offsets in minutes relative to T0 */
  const span = (a: Activity) => [(a.startAt - T0()) / MIN, (a.endAt - T0()) / MIN];

  describe('access', () => {
    it('state is for signed-in phones, projector and console only; writes are console only', async () => {
      expect((await req(t.app, null, 'GET', '/api/schedule')).statusCode).toBe(401);
      const [kit] = await makeKits(t.app, 1);
      const a = await signedInAttendee(t.app, kit!);
      expect((await req(t.app, a.jar, 'GET', '/api/schedule')).statusCode).toBe(200);
      const id = await make('talk', 10, 20);
      for (const [m, p, b] of [
        ['POST', '/api/schedule', { title: 'x', startAt: T0(), endAt: T0() + MIN }],
        ['DELETE', `/api/schedule/${id}`, undefined],
        ['POST', `/api/schedule/${id}/start`, undefined],
        ['POST', `/api/schedule/${id}/end`, undefined],
        ['POST', `/api/schedule/${id}/delay`, { minutes: 5 }],
        ['POST', `/api/schedule/${id}/highlight`, { highlight: true }],
        ['POST', '/api/schedule/reorder', { order: [id] }],
        ['POST', '/api/schedule/reset', { confirm: 'reset schedule' }],
      ] as const) {
        expect((await req(t.app, a.jar, m, p, b)).statusCode, `${m} ${p}`).toBe(401);
        expect((await req(t.app, null, m, p, b)).statusCode, `${m} ${p} anon`).toBe(401);
      }
      expect((await patch(a.jar, id, { title: 'hax' })).statusCode).toBe(401);
      expect((await patch(null, id, { title: 'hax' })).statusCode).toBe(401);
      expect(get(await state(), id).title).toBe('talk');
    });

    it('validates input', async () => {
      const bad = [
        { title: '', startAt: T0(), endAt: T0() + MIN },
        { title: 'x', startAt: T0() + MIN, endAt: T0() },
        { title: 'x', startAt: T0(), endAt: T0() + 13 * 60 * MIN },
        { title: 'x', startAt: T0(), endAt: T0() + MIN, kind: 'party' },
        { title: 'x', startAt: T0(), endAt: T0() + MIN, link: 'https://evil.example' },
        { title: 'x', startAt: 'soon', endAt: T0() + MIN },
      ];
      for (const b of bad) expect((await post('', b)).statusCode, JSON.stringify(b)).toBe(400);
      const id = await make('ok', 0, 10);
      expect((await post(`/${id}/delay`, { minutes: 7 })).statusCode).toBe(400);
      expect((await patch(admin, id, {})).statusCode).toBe(400);
      expect((await patch(admin, id, { startAt: T0() + 20 * MIN })).statusCode).toBe(400); // end before start
      expect((await patch(admin, id, { nope: 1 })).statusCode).toBe(400);
      expect((await post('/999/start')).statusCode).toBe(404);
      expect((await post('/abc/start')).statusCode).toBe(400);
    });
  });

  describe('now and next', () => {
    it('is time driven until an organiser takes over', async () => {
      const a = await make('a', 0, 30);
      const b = await make('b', 30, 60);
      const c = await make('c', 60, 90);
      let s = await state();
      expect([s.nowId, s.nextId]).toEqual([a, b]);
      expect(s.serverNow).toBe(T0());
      t.clock.advance(30 * MIN);
      s = await state();
      expect([s.nowId, s.nextId]).toEqual([b, c]);
      expect(get(s, a).status).toBe('ended');
      t.clock.advance(60 * MIN);
      s = await state();
      expect([s.nowId, s.nextId]).toEqual([null, null]);
    });

    it('before the event: nothing now, first activity next', async () => {
      const a = await make('a', 30, 60);
      const s = await state();
      expect([s.nowId, s.nextId]).toEqual([null, a]);
    });

    it('timeline is ordered by start time then id', async () => {
      await make('late', 60, 70);
      await make('early', 10, 20);
      await make('tie1', 40, 50);
      await make('tie2', 40, 55);
      expect((await state()).activities.map((a) => a.title)).toEqual(['early', 'tie1', 'tie2', 'late']);
    });

    it('a stale-offset phone is not needed: server time rides along and version bumps only on changes', async () => {
      const a = await make('a', 0, 30);
      const v1 = (await state()).version;
      t.clock.advance(5 * MIN);
      expect((await state()).version).toBe(v1);
      await post(`/${a}/delay`, { minutes: 5 });
      expect((await state()).version).toBe(v1 + 1);
    });
  });

  describe('start now / end now', () => {
    it('start jumps the activity to now, keeps its length, ends whatever was live', async () => {
      const a = await make('a', 0, 30);
      const b = await make('b', 30, 60);
      const c = await make('c', 60, 90);
      t.clock.advance(10 * MIN);
      const r = await post(`/${b}/start`);
      expect(r.statusCode).toBe(200);
      const s = r.json() as ScheduleState;
      expect(get(s, a).status).toBe('ended');
      expect(get(s, a).actualEndAt).toBe(t.clock.now());
      expect(span(get(s, a))).toEqual([0, 10]); // trimmed to when it really ended
      expect(get(s, b).status).toBe('live');
      expect(span(get(s, b))).toEqual([10, 40]); // 30 minutes, started 20 early
      expect(get(s, b).delayMs).toBe(-20 * MIN);
      expect(span(get(s, c))).toEqual([60, 90]); // starting early leaves a gap, later ones do not pull in
      expect([s.nowId, s.nextId]).toEqual([b, c]);
    });

    it('starting late pushes later activities only as far as needed', async () => {
      const a = await make('a', 0, 30);
      const b = await make('b', 30, 60);
      const c = await make('c', 70, 90); // 10 min slack before c
      t.clock.advance(40 * MIN);
      const s = (await post(`/${b}/start`)).json() as ScheduleState;
      expect(span(get(s, b))).toEqual([40, 70]);
      expect(span(get(s, c))).toEqual([70, 90]); // already clear: not moved
      expect(get(s, a).status).toBe('ended');
      t.clock.advance(1 * MIN);
      const s2 = (await post(`/${c}/start`)).json() as ScheduleState;
      expect(get(s2, b).status).toBe('ended');
    });

    it('an organiser-started activity stays live past its end until ended; later ones stay upcoming', async () => {
      const a = await make('a', 0, 30);
      const b = await make('b', 30, 60);
      await post(`/${a}/start`);
      t.clock.advance(45 * MIN); // a overran, b's window is open
      const s = await state();
      expect(get(s, a).status).toBe('live');
      expect(get(s, b).status).toBe('upcoming');
      expect([s.nowId, s.nextId]).toEqual([a, b]);
      const e = (await post(`/${a}/end`)).json() as ScheduleState;
      expect(get(e, a).status).toBe('ended');
      expect(get(e, a).actualEndAt).toBe(t.clock.now());
      expect(span(get(e, a))).toEqual([0, 30]); // overrun keeps its planned end
      // b is now time driven again (its window is open)
      expect(e.nowId).toBe(b);
    });

    it('end pulls a future end in to now; ending something not live is a 409; double start is a 409', async () => {
      const a = await make('a', 0, 30);
      const b = await make('b', 40, 50);
      await post(`/${a}/start`);
      expect((await post(`/${a}/start`)).statusCode).toBe(409);
      t.clock.advance(10 * MIN);
      const s = (await post(`/${a}/end`)).json() as ScheduleState;
      expect(span(get(s, a))).toEqual([0, 10]);
      expect((await post(`/${a}/end`)).statusCode).toBe(409);
      expect((await post(`/${b}/end`)).statusCode).toBe(409);
    });

    it('an ended activity can be started again (oops button)', async () => {
      const a = await make('a', 0, 30);
      await post(`/${a}/start`);
      t.clock.advance(5 * MIN);
      await post(`/${a}/end`);
      t.clock.advance(5 * MIN);
      const s = (await post(`/${a}/start`)).json() as ScheduleState;
      expect(get(s, a).status).toBe('live');
      expect(span(get(s, a))).toEqual([10, 20]); // trimmed to 5 min when ended, restart gives at least 10
    });
  });

  describe('delay', () => {
    it('moves the activity and pushes only overlapping followers, absorbing slack', async () => {
      const a = await make('a', 10, 40);
      const b = await make('b', 40, 70);
      const c = await make('c', 80, 100); // 10 min gap after b
      const d = await make('d', 120, 140); // 20 min gap after c
      const s = (await post(`/${a}/delay`, { minutes: 15 })).json() as ScheduleState;
      expect(span(get(s, a))).toEqual([25, 55]);
      expect(span(get(s, b))).toEqual([55, 85]); // pushed 15
      expect(span(get(s, c))).toEqual([85, 105]); // pushed 5 (gap ate 10)
      expect(span(get(s, d))).toEqual([120, 140]); // untouched
      expect(get(s, a).delayMs).toBe(15 * MIN);
      expect(get(s, a).plannedStartAt).toBe(T0() + 10 * MIN);
      expect(get(s, c).delayMs).toBe(5 * MIN);
    });

    it('a delay that fits inside the gap moves nothing else', async () => {
      const a = await make('a', 10, 20);
      const b = await make('b', 40, 50);
      const s = (await post(`/${a}/delay`, { minutes: 10 })).json() as ScheduleState;
      expect(span(get(s, a))).toEqual([20, 30]);
      expect(span(get(s, b))).toEqual([40, 50]);
    });

    it('delays stack', async () => {
      const a = await make('a', 10, 20);
      const b = await make('b', 20, 30);
      await post(`/${a}/delay`, { minutes: 5 });
      await post(`/${a}/delay`, { minutes: 10 });
      const s = await state();
      expect(span(get(s, a))).toEqual([25, 35]);
      expect(span(get(s, b))).toEqual([35, 45]);
      expect(get(s, a).delayMs).toBe(15 * MIN);
    });

    it('on a live (organiser-started) activity it only extends the end', async () => {
      const a = await make('a', 0, 30);
      const b = await make('b', 30, 60);
      await post(`/${a}/start`);
      t.clock.advance(20 * MIN);
      const s = (await post(`/${a}/delay`, { minutes: 10 })).json() as ScheduleState;
      expect(span(get(s, a))).toEqual([0, 40]);
      expect(get(s, a).status).toBe('live');
      expect(span(get(s, b))).toEqual([40, 70]);
    });

    it('on an activity that is live only by the clock, it pulls it back to upcoming', async () => {
      const a = await make('a', 0, 30);
      t.clock.advance(1 * MIN);
      expect(get(await state(), a).status).toBe('live');
      const s = (await post(`/${a}/delay`, { minutes: 5 })).json() as ScheduleState;
      expect(get(s, a).status).toBe('upcoming');
      expect(s.nextId).toBe(a);
    });

    it('does not move finished activities or running ones, and refuses to delay an ended one', async () => {
      const a = await make('a', 0, 30);
      const b = await make('b', 30, 60);
      const c = await make('c', 60, 90);
      t.clock.advance(35 * MIN);
      expect((await post(`/${a}/delay`, { minutes: 5 })).statusCode).toBe(409);
      const s = (await post(`/${b}/delay`, { minutes: 5 })).json() as ScheduleState;
      expect(span(get(s, a))).toEqual([0, 30]);
      expect(span(get(s, c))).toEqual([65, 95]);
    });
  });

  describe('reorder', () => {
    it('swaps durations into the slots, keeping gaps by position, and resets planned times', async () => {
      const a = await make('a', 10, 30); // 20 min
      const b = await make('b', 40, 50); // 10 min, gap 10 after a
      const c = await make('c', 50, 80); // 30 min, no gap
      const s = (await post('/reorder', { order: [c, a, b] })).json() as ScheduleState;
      expect(span(get(s, c))).toEqual([10, 40]);
      expect(span(get(s, a))).toEqual([50, 70]); // slot 2 had a 10 min gap
      expect(span(get(s, b))).toEqual([70, 80]);
      expect(s.activities.map((x) => x.id)).toEqual([c, a, b]);
      expect(get(s, c).delayMs).toBe(0);
    });

    it('leaves running and finished activities alone and starts after a running one', async () => {
      const a = await make('a', 0, 30);
      const b = await make('b', 30, 40);
      const c = await make('c', 40, 60);
      await post(`/${a}/start`);
      await patch(admin, a, { endAt: T0() + 50 * MIN }); // running one now ends at 50
      const s = (await post('/reorder', { order: [c, b] })).json() as ScheduleState;
      expect(get(s, a).status).toBe('live');
      expect(span(get(s, c))).toEqual([50, 70]); // not before the running one ends
      expect(span(get(s, b))).toEqual([70, 80]);
    });

    it('rejects a stale or tampered list (409), including finished ones, duplicates and strangers', async () => {
      const a = await make('a', 0, 10);
      const b = await make('b', 10, 20);
      const c = await make('c', 20, 30);
      expect((await post('/reorder', { order: [a, b] })).statusCode).toBe(409);
      expect((await post('/reorder', { order: [a, a, b] })).statusCode).toBe(409);
      expect((await post('/reorder', { order: [a, b, 9999] })).statusCode).toBe(409);
      expect((await post('/reorder', { order: [] })).statusCode).toBe(400);
      t.clock.advance(15 * MIN); // a ended by the clock, b is live
      expect((await post('/reorder', { order: [c, b, a] })).statusCode).toBe(409);
      expect((await post('/reorder', { order: [c] })).statusCode).toBe(200);
    });
  });

  describe('edit, create, delete, highlight', () => {
    it('edits fields; changing startAt resets the planned time', async () => {
      const a = await make('a', 10, 20, { blurb: 'old' });
      const r = await patch(admin, a, { title: 'b', blurb: 'new', kind: 'talk', link: '/polls', startAt: T0() + 15 * MIN, endAt: T0() + 25 * MIN });
      const x = get(r.json() as ScheduleState, a);
      expect([x.title, x.blurb, x.kind, x.link, x.delayMs]).toEqual(['b', 'new', 'talk', '/polls', 0]);
      expect(x.plannedStartAt).toBe(T0() + 15 * MIN);
    });

    it('deleting removes it and its id is never reused', async () => {
      const a = await make('a', 10, 20);
      expect(((await req(t.app, admin, 'DELETE', `/api/schedule/${a}`)).json() as ScheduleState).activities).toHaveLength(0);
      expect((await req(t.app, admin, 'DELETE', `/api/schedule/${a}`)).statusCode).toBe(404);
      expect(await make('a2', 10, 20)).toBeGreaterThan(a);
    });

    it('highlight toggles', async () => {
      const a = await make('a', 10, 20);
      expect(get((await post(`/${a}/highlight`, { highlight: true })).json() as ScheduleState, a).highlight).toBe(true);
      expect(get((await post(`/${a}/highlight`, { highlight: false })).json() as ScheduleState, a).highlight).toBe(false);
    });

    it('caps the list at 100', async () => {
      for (let i = 0; i < 100; i++) {
        if (i % 50 === 49) t.clock.advance(61_000); // the console's own rate limit
        await make(`x${i}`, i, i + 1);
      }
      expect((await post('', { title: 'one too many', startAt: T0(), endAt: T0() + MIN })).statusCode).toBe(409);
    });

    it('reset needs the typed confirmation; reseed loads the demo', async () => {
      await make('a', 10, 20);
      expect((await post('/reset', { confirm: 'yes' })).statusCode).toBe(400);
      expect(((await post('/reset', { confirm: 'reset schedule' })).json() as ScheduleState).activities).toHaveLength(0);
      const s = (await post('/reset', { confirm: 'reset schedule', reseed: true })).json() as ScheduleState;
      expect(s.activities).toHaveLength(DEMO_AFTERNOON.length);
    });

    it('a failed action leaves the cache and database consistent', async () => {
      const a = await make('a', 10, 20);
      expect((await post('/reorder', { order: [a, 5555] })).statusCode).toBe(409);
      expect((await state()).activities).toHaveLength(1);
    });
  });

  describe('live events', () => {
    it('every organiser action reaches phones, projector and console with the new state and a change descriptor', async () => {
      const [kit] = await makeKits(t.app, 1);
      const phone = await signedInAttendee(t.app, kit!);
      const onPhone = capture(t.ctx, { attendeeId: phone.id, admin: false, screen: false });
      const onScreen = capture(t.ctx, { attendeeId: null, admin: false, screen: true });
      const a = await make('a', 0, 30);
      const b = await make('b', 30, 60);
      await post(`/${a}/start`);
      await post(`/${a}/delay`, { minutes: 10 });
      await post(`/${a}/end`);
      await post(`/${b}/highlight`, { highlight: true });
      await post('/reorder', { order: [b] });
      await patch(admin, b, { title: 'bb' });
      await req(t.app, admin, 'DELETE', `/api/schedule/${b}`);
      const kinds = (c: ReturnType<typeof capture>) => c.events.filter((e) => e.type === 'schedule.changed').map((e) => (e.data as { change: { kind: string } }).change.kind);
      const expected = ['created', 'created', 'started', 'delayed', 'ended', 'highlighted', 'reordered', 'edited', 'deleted'];
      expect(kinds(onPhone)).toEqual(expected);
      expect(kinds(onScreen)).toEqual(expected);
      const started = onPhone.events.find((e) => (e.data as { change: { kind: string } }).change.kind === 'started')!.data as { change: { activityId: number }; state: ScheduleState };
      expect(started.change.activityId).toBe(a);
      expect(started.state.nowId).toBe(a);
      onPhone.unsub();
      onScreen.unsub();
    });

    it('failed actions publish nothing', async () => {
      const a = await make('a', 10, 20);
      const c = capture(t.ctx, { attendeeId: null, admin: true, screen: false });
      await post(`/${a}/end`);
      await post(`/${a}/delay`, { minutes: 9 });
      expect(c.events).toHaveLength(0);
      c.unsub();
    });

    it('time alone moving now/next fires one "advanced" event; quiet ticks fire none', async () => {
      const a = await make('a', 0, 30);
      const b = await make('b', 30, 60);
      advance(t.ctx); // prime
      const c = capture(t.ctx, { attendeeId: null, admin: true, screen: false });
      t.clock.advance(10 * MIN);
      advance(t.ctx);
      expect(c.events).toHaveLength(0);
      t.clock.advance(20 * MIN);
      advance(t.ctx);
      advance(t.ctx);
      expect(c.events).toHaveLength(1);
      const d = c.events[0]!.data as { change: { kind: string; previousNowId: number; nowId: number }; state: ScheduleState };
      expect(d.change).toEqual({ kind: 'advanced', previousNowId: a, nowId: b });
      expect(d.state.nowId).toBe(b);
      c.unsub();
    });

    it('a phone that missed events can recover from GET alone (state is complete)', async () => {
      const a = await make('a', 0, 30);
      await post(`/${a}/start`);
      await post(`/${a}/delay`, { minutes: 15 });
      const s = await state();
      expect(get(s, a)).toMatchObject({ status: 'live', delayMs: 0 });
      expect(span(get(s, a))).toEqual([0, 45]);
    });
  });

  describe('demo afternoon', () => {
    it('seeds 21 Nov 2026, 2 pm to 7 pm IST, in order, no overlaps, 3 highlights, only in-app links', async () => {
      await post('/reset', { confirm: 'reset schedule' });
      await (await import('./index')).schedule.seed!(t.ctx);
      const s = await state();
      const first = s.activities[0]!;
      const last = s.activities.at(-1)!;
      expect(first.startAt).toBe(istOn('2026-11-21', '14:00'));
      expect(first.startAt).toBe(Date.parse('2026-11-21T08:30:00Z'));
      expect(last.endAt).toBe(Date.parse('2026-11-21T13:30:00Z'));
      expect(s.activities.filter((a) => a.highlight)).toHaveLength(3);
      for (let i = 1; i < s.activities.length; i++) expect(s.activities[i]!.startAt).toBeGreaterThanOrEqual(s.activities[i - 1]!.endAt);
      const kinds = new Set(s.activities.map((a) => a.kind));
      for (const k of ['talk', 'poll', 'hunt', 'morse', 'game', 'break']) expect(kinds.has(k as never), k).toBe(true);
      // seeding twice does not duplicate
      await (await import('./index')).schedule.seed!(t.ctx);
      expect((await state()).activities).toHaveLength(DEMO_AFTERNOON.length);
    });
  });

  describe('scale', () => {
    it('300 phones fetching state at once is fast and every answer is identical', async () => {
      const big = await makeApp({ env: { LOGIN_IP_PER_MIN: '100000' } });
      const phones = await (async () => {
        const kits = await makeKits(big.app, 300);
        return Promise.all(kits.map((k, i) => signedInAttendee(big.app, k, `p${i}`)));
      })();
      const bigAdmin = await adminJar(big.app);
      for (let i = 0; i < 14; i++) await req(big.app, bigAdmin, 'POST', '/api/schedule', { title: `item ${i}`, startAt: T0() + i * 10 * MIN, endAt: T0() + i * 10 * MIN + 10 * MIN });
      const started = performance.now();
      const results = await Promise.all(phones.map((p) => req(big.app, p.jar, 'GET', '/api/schedule')));
      const ms = performance.now() - started;
      expect(results.every((r) => r.statusCode === 200)).toBe(true);
      expect(new Set(results.map((r) => r.body)).size).toBe(1);
      expect(ms).toBeLessThan(3000);
      await big.close();
    }, 60_000);

    it('a console action fans out to 300 listeners without slowing down', async () => {
      const a = await make('a', 0, 30);
      const listeners = Array.from({ length: 300 }, (_, i) => capture(t.ctx, { attendeeId: i + 1, admin: false, screen: false }));
      const started = performance.now();
      await post(`/${a}/start`);
      expect(performance.now() - started).toBeLessThan(1000);
      expect(listeners.every((l) => l.types().includes('schedule.changed'))).toBe(true);
      listeners.forEach((l) => l.unsub());
    });

    it('one phone cannot hammer the state route', async () => {
      const [kit] = await makeKits(t.app, 1);
      const p = await signedInAttendee(t.app, kit!);
      let limited = 0;
      for (let i = 0; i < 30; i++) if ((await req(t.app, p.jar, 'GET', '/api/schedule')).statusCode === 429) limited++;
      expect(limited).toBe(10);
    });
  });
});
