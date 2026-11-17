import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ScreenCheckins } from '@afterhours/shared/features/attendance';
import { CHECKIN_POINTS, CHECKIN_WINDOW_MS } from '@afterhours/shared/features/attendance';
import { type Jar, type TestApp, adminJar, capture, makeApp, makeKits, req, signedInAttendee } from '../../../test/helpers';
import { codeFor, csvCell, tick, windowIndex } from './index';

describe('attendance feature', () => {
  let t: TestApp;
  let admin: Jar;
  beforeEach(async () => {
    t = await makeApp();
    admin = await adminJar(t.app);
  });
  afterEach(async () => t.close());

  const open = (activityId = 'a1', title = 'Opening', extra: object = {}) => req(t.app, admin, 'POST', '/api/attendance/admin/open', { activityId, title, ...extra });
  const screen = async () => (await req(t.app, admin, 'GET', '/api/attendance/screen')).json() as ScreenCheckins;
  const codeOf = async (id = 'a1') => (await screen()).open.find((o) => o.activityId === id)!.code;
  const people = async (n: number) => {
    const kits = await makeKits(t.app, n);
    return Promise.all(kits.map((k, i) => signedInAttendee(t.app, k, `p${i}`)));
  };
  const checkin = (jar: Jar, body: object) => req(t.app, jar, 'POST', '/api/attendance/checkin', body);

  it('code is a 4 char HMAC of activity and window; rotates every 30 s; current and previous window accepted', async () => {
    await open();
    const [a] = await people(1);
    const c1 = await codeOf();
    expect(c1).toMatch(/^[A-Z0-9]{4}$/);
    t.clock.advance(CHECKIN_WINDOW_MS);
    const c2 = await codeOf();
    expect(c2).not.toBe(c1); // (1 in 531k chance of a false failure; secret is random per DB)
    // previous window's code still works
    const r = await checkin(a!.jar, { code: c1.toLowerCase(), activityId: 'a1' });
    expect(r.statusCode).toBe(200);
  });

  it('a code two windows old is rejected', async () => {
    await open();
    const [a] = await people(1);
    const old = await codeOf();
    t.clock.advance(CHECKIN_WINDOW_MS * 2);
    const r = await checkin(a!.jar, { code: old });
    expect(r.statusCode).toBe(400);
    expect((r.json() as { error: { code: string } }).error.code).toBe('bad_code');
  });

  it('codes differ per activity and are not derivable without the server secret', async () => {
    const s1 = Buffer.from('aa'.repeat(32), 'hex');
    const s2 = Buffer.from('bb'.repeat(32), 'hex');
    const w = windowIndex(t.clock.now());
    expect(codeFor(s1, 'x', w)).toBe(codeFor(s1, 'x', w));
    const sample = (s: Buffer, id: string) => Array.from({ length: 40 }, (_, i) => codeFor(s, id, w + i)).join();
    expect(sample(s1, 'x')).not.toBe(sample(s2, 'x'));
    expect(sample(s1, 'x')).not.toBe(sample(s1, 'y'));
  });

  it('check-in awards points + sticker once; repeat is idempotent', async () => {
    await open('a1', 'Opening');
    const [a] = await people(1);
    const before = t.ctx.points.total(a!.id);
    const r = await checkin(a!.jar, { code: await codeOf() });
    const body = r.json() as { newlyCheckedIn: boolean; points: number; position: number; count: number; title: string };
    expect(body).toMatchObject({ newlyCheckedIn: true, points: CHECKIN_POINTS, position: 1, count: 1, title: 'Opening' });
    expect(t.ctx.points.total(a!.id)).toBe(before + CHECKIN_POINTS);
    expect(t.ctx.stickers.unlockedBy(a!.id)['attendance-first']).toBeDefined();
    const again = (await checkin(a!.jar, { code: await codeOf(), activityId: 'a1' })).json() as { newlyCheckedIn: boolean; points: number };
    expect(again).toMatchObject({ newlyCheckedIn: false, points: 0 });
    expect(t.ctx.points.total(a!.id)).toBe(before + CHECKIN_POINTS);
  });

  it('positions count up; regular sticker at 3 check-ins', async () => {
    const [a, b] = await people(2);
    for (const id of ['a1', 'a2', 'a3']) await open(id, `Act ${id}`);
    await checkin(b!.jar, { code: await codeOf('a1'), activityId: 'a1' });
    const r = (await checkin(a!.jar, { code: await codeOf('a1'), activityId: 'a1' })).json() as { position: number };
    expect(r.position).toBe(2);
    await checkin(a!.jar, { code: await codeOf('a2'), activityId: 'a2' });
    expect(t.ctx.stickers.unlockedBy(a!.id)['attendance-regular']).toBeUndefined();
    await checkin(a!.jar, { code: await codeOf('a3'), activityId: 'a3' });
    expect(t.ctx.stickers.unlockedBy(a!.id)['attendance-regular']).toBeDefined();
  });

  it('without activityId the code finds its own open check-in; a code for A does not work for B', async () => {
    await open('a1', 'One');
    await open('a2', 'Two');
    const [a] = await people(1);
    const r = (await checkin(a!.jar, { code: await codeOf('a2') })).json() as { activityId: string };
    expect(r.activityId).toBe('a2');
    const wrong = await checkin(a!.jar, { code: await codeOf('a1'), activityId: 'a2' });
    expect(wrong.statusCode).toBe(400);
  });

  it('closed or never-opened check-ins reject, even with a once-valid code', async () => {
    await open();
    const [a] = await people(1);
    const code = await codeOf();
    await req(t.app, admin, 'POST', '/api/attendance/admin/close', { activityId: 'a1' });
    expect((await checkin(a!.jar, { code, activityId: 'a1' })).statusCode).toBe(400);
    expect((await checkin(a!.jar, { code: 'ACDE', activityId: 'nope' })).statusCode).toBe(400);
    // re-open works and keeps history
    await open();
    expect((await checkin(a!.jar, { code: await codeOf() })).statusCode).toBe(200);
  });

  it('auto-closes at closesAt on the tick', async () => {
    await open('a1', 'Opening', { closesAt: t.clock.now() + 60_000 });
    const [a] = await people(1);
    const code = await codeOf();
    t.clock.advance(61_000);
    // Even before the tick runs, the server refuses past closesAt.
    expect((await checkin(a!.jar, { code })).statusCode).toBe(400);
    tick(t.ctx);
    expect((await screen()).open).toHaveLength(0);
  });

  it('brute force: 5 wrong guesses lock the attendee out, then it refills; successes cost nothing', async () => {
    await open();
    const [a, b] = await people(2);
    const real = await codeOf();
    const wrongs = ['AAAA', 'CCCC', 'DDDD', 'EEEE', 'FFFF'].filter((c) => c !== real);
    for (const c of wrongs.slice(0, 4)) expect((await checkin(a!.jar, { code: c })).statusCode).toBe(400);
    // Fifth miss is still a 400, then the bucket is empty.
    expect((await checkin(a!.jar, { code: 'GGGG' })).statusCode).toBe(400);
    const locked = await checkin(a!.jar, { code: real }); // even the right code waits
    expect(locked.statusCode).toBe(429);
    expect(locked.headers['retry-after']).toBeDefined();
    // another attendee is unaffected
    expect((await checkin(b!.jar, { code: real })).statusCode).toBe(200);
    t.clock.advance(15_000);
    expect((await checkin(a!.jar, { code: await codeOf() })).statusCode).toBe(200);
  });

  it('validates input and requires sign-in', async () => {
    await open();
    const [a] = await people(1);
    expect((await checkin(a!.jar, { code: 'ab' })).statusCode).toBe(400);
    expect((await checkin(a!.jar, { code: 'OOOO' })).statusCode).toBe(400); // letter O is not in the alphabet
    expect((await checkin(a!.jar, {})).statusCode).toBe(400);
    expect((await req(t.app, null, 'POST', '/api/attendance/checkin', { code: 'ACDE' })).statusCode).toBe(401);
    expect((await req(t.app, null, 'GET', '/api/attendance/me')).statusCode).toBe(401);
  });

  it('codes never reach attendees: not in /me, not in attendee live events', async () => {
    const [a] = await people(1);
    const phone = capture(t.ctx, { attendeeId: a!.id, admin: false, screen: false });
    const proj = capture(t.ctx, { attendeeId: null, admin: false, screen: true });
    await open();
    const code = await codeOf();
    const me = await req(t.app, a!.jar, 'GET', '/api/attendance/me');
    expect(me.body).not.toContain(code);
    expect((await req(t.app, a!.jar, 'GET', '/api/attendance/screen')).statusCode).toBe(401);
    expect(phone.types()).toContain('attendance.state');
    expect(phone.types()).not.toContain('attendance.code');
    expect(JSON.stringify(phone.events)).not.toContain(code);
    expect(proj.types()).toContain('attendance.code');
    phone.unsub();
    proj.unsub();
  });

  it('tick rotates the code event once per window, coalesces counts and arrivals', async () => {
    await open();
    const [a, b] = await people(2);
    const proj = capture(t.ctx, { attendeeId: null, admin: false, screen: true });
    const everyone = capture(t.ctx, { attendeeId: null, admin: false, screen: false });
    tick(t.ctx);
    tick(t.ctx);
    expect(proj.types().filter((x) => x === 'attendance.code')).toHaveLength(0); // open() already published this window
    await checkin(a!.jar, { code: await codeOf() });
    await checkin(b!.jar, { code: await codeOf() });
    tick(t.ctx);
    tick(t.ctx);
    expect(everyone.events.filter((e) => e.type === 'attendance.counts').map((e) => e.data)).toEqual([{ counts: { a1: 2 } }]);
    const arr = proj.events.filter((e) => e.type === 'attendance.arrivals');
    expect(arr).toHaveLength(1);
    expect((arr[0]!.data as { names: string[] }).names).toEqual(['p0', 'p1']);
    expect(everyone.types()).not.toContain('attendance.arrivals');
    t.clock.advance(CHECKIN_WINDOW_MS);
    tick(t.ctx);
    tick(t.ctx);
    expect(proj.types().filter((x) => x === 'attendance.code')).toHaveLength(1);
    proj.unsub();
    everyone.unsub();
  });

  it('console: overview, searchable lists, manual check-in, guards', async () => {
    await open('a1', 'Opening');
    const ppl = await people(3);
    await checkin(ppl[0]!.jar, { code: await codeOf() });
    const ov = (await req(t.app, admin, 'GET', '/api/attendance/admin/overview')).json() as { eventCount: number; windows: { count: number; open: boolean }[] };
    expect(ov.eventCount).toBe(3);
    expect(ov.windows[0]).toMatchObject({ count: 1, open: true });
    const list = (await req(t.app, admin, 'GET', '/api/attendance/admin/activity/a1')).json() as { total: number; rows: { nickname: string }[] };
    expect(list).toMatchObject({ total: 1 });
    const ev = (await req(t.app, admin, 'GET', '/api/attendance/admin/event?q=p2')).json() as { total: number; rows: { nickname: string; checkins: number }[] };
    expect(ev.total).toBe(1);
    expect(ev.rows[0]!.nickname).toBe('p2');
    expect(((await req(t.app, admin, 'GET', '/api/attendance/admin/event?q=%25')).json() as { total: number }).total).toBe(0); // % is literal
    const m = await req(t.app, admin, 'POST', '/api/attendance/admin/activity/a1/checkin', { attendeeId: ppl[1]!.id });
    expect(m.statusCode).toBe(200);
    expect(t.ctx.points.has(ppl[1]!.id, 'attendance', 'checkin:a1')).toBe(true);
    for (const [method, url] of [
      ['GET', '/api/attendance/admin/overview'],
      ['GET', '/api/attendance/admin/event'],
      ['GET', '/api/attendance/admin/export/event.csv'],
      ['POST', '/api/attendance/admin/open'],
      ['GET', '/api/attendance/screen'],
    ] as const) {
      expect((await req(t.app, ppl[0]!.jar, method, url, {})).statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it('CSV export has proper headers, BOM, quoting and formula neutralising', async () => {
    await open('a1', 'Opening, "big" one');
    const kits = await makeKits(t.app, 1);
    const a = await signedInAttendee(t.app, kits[0]!, 'zed');
    t.ctx.db.exec(`UPDATE attendees SET name = '=HYPERLINK("x")' WHERE id = ${a.id}`);
    await checkin(a.jar, { code: await codeOf() });
    const ev = await req(t.app, admin, 'GET', '/api/attendance/admin/export/event.csv');
    expect(ev.headers['content-type']).toContain('text/csv');
    expect(ev.headers['content-disposition']).toContain('attachment');
    expect(ev.body.charCodeAt(0)).toBe(0xfeff);
    const lines = ev.body.slice(1).trim().split('\r\n');
    expect(lines[0]).toBe('kit_id,name,roll,nickname,signed_in_at,activity_checkins');
    expect(lines[1]).toContain(`"'=HYPERLINK(""x"")"`);
    expect(lines[1]!.endsWith(',1')).toBe(true);
    const ac = await req(t.app, admin, 'GET', '/api/attendance/admin/export/activity/a1.csv');
    expect(ac.statusCode).toBe(200);
    expect(ac.body).toContain('"Opening, ""big"" one"');
    expect((await req(t.app, admin, 'GET', '/api/attendance/admin/export/activity/zzz.csv')).statusCode).toBe(404);
    expect(csvCell('-1')).toBe("'-1");
  });

  it('300 attendees check in within budget', async () => {
    await t.close();
    t = await makeApp({ env: { LOGIN_IP_PER_MIN: '100000' } });
    admin = await adminJar(t.app);
    await open();
    const kits = await makeKits(t.app, 300);
    const ppl = await Promise.all(kits.map((k, i) => signedInAttendee(t.app, k, `n${i}`)));
    const code = await codeOf();
    const t0 = performance.now();
    const rs = await Promise.all(ppl.map((p) => checkin(p.jar, { code })));
    const ms = performance.now() - t0;
    expect(rs.every((r) => r.statusCode === 200)).toBe(true);
    expect(((await screen()).open[0]!.count)).toBe(300);
    expect(ms).toBeLessThan(5000);
    const t1 = performance.now();
    tick(t.ctx);
    expect(performance.now() - t1).toBeLessThan(200);
  }, 60_000);
});
