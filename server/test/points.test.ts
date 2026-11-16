import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type TestApp, Jar, capture, makeApp, makeKits, req, signedInAttendee } from './helpers';

describe('points ledger', () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await makeApp();
  });
  afterEach(async () => t.close());

  it('award is idempotent per (attendee, source, ref) and publishes once', async () => {
    const [kit] = await makeKits(t.app, 1);
    const { id } = await signedInAttendee(t.app, kit!);
    const cap = capture(t.ctx, { attendeeId: id, admin: false, screen: false });
    const base = t.ctx.points.total(id); // 20 from sign-in + profile

    const first = t.ctx.points.award({ attendeeId: id, source: 'polls', ref: 'poll:7', points: 15, label: 'voted' });
    const again = t.ctx.points.award({ attendeeId: id, source: 'polls', ref: 'poll:7', points: 15 });
    const tryMore = t.ctx.points.award({ attendeeId: id, source: 'polls', ref: 'poll:7', points: 999 });
    expect(first).toEqual({ awarded: true, total: base + 15 });
    expect(again).toEqual({ awarded: false, total: base + 15 });
    expect(tryMore.awarded).toBe(false);
    // same ref, different source is a different award
    expect(t.ctx.points.award({ attendeeId: id, source: 'hunt', ref: 'poll:7', points: 1 }).awarded).toBe(true);
    expect(t.ctx.points.total(id)).toBe(base + 16);

    const awarded = cap.events.filter((e) => e.type === 'points.awarded');
    expect(awarded.map((e) => e.data)).toEqual([
      { source: 'polls', ref: 'poll:7', points: 15, total: base + 15, label: 'voted' },
      { source: 'hunt', ref: 'poll:7', points: 1, total: base + 16, label: null },
    ]);
    expect(t.ctx.points.has(id, 'polls', 'poll:7')).toBe(true);
    cap.unsub();
  });

  it('rejects malformed awards loudly (programming errors)', async () => {
    expect(() => t.ctx.points.award({ attendeeId: 1, source: 'Bad Source', ref: 'x', points: 1 })).toThrow();
    expect(() => t.ctx.points.award({ attendeeId: 1, source: 'ok', ref: '', points: 1 })).toThrow();
    expect(() => t.ctx.points.award({ attendeeId: 1, source: 'ok', ref: 'x', points: 1.5 })).toThrow();
  });

  it('totalFrom sums a source family since a time (for daily caps)', async () => {
    const [kit] = await makeKits(t.app, 1);
    const { id } = await signedInAttendee(t.app, kit!);
    t.ctx.points.award({ attendeeId: id, source: 'arcade.reaction', ref: 'run:1', points: 20 });
    t.clock.advance(1000);
    const mark = t.clock.now();
    t.ctx.points.award({ attendeeId: id, source: 'arcade.hex', ref: 'run:2', points: 30 });
    t.ctx.points.award({ attendeeId: id, source: 'arcadex', ref: 'run:3', points: 99 });
    expect(t.ctx.points.totalFrom(id, 'arcade')).toBe(50);
    expect(t.ctx.points.totalFrom(id, 'arcade', mark)).toBe(30);
  });

  it('leaderboard orders by total, ties go to whoever got there first, hides incomplete profiles', async () => {
    const kits = await makeKits(t.app, 4);
    const a = await signedInAttendee(t.app, kits[0]!, 'anna');
    const b = await signedInAttendee(t.app, kits[1]!, 'bala');
    const c = await signedInAttendee(t.app, kits[2]!, 'chitra');
    // d signs in but never finishes a profile
    const dJar = new Jar();
    await req(t.app, dJar, 'POST', '/api/auth/signin', kits[3]);

    t.clock.advance(1000);
    t.ctx.points.award({ attendeeId: c.id, source: 'x', ref: '1', points: 5 });
    t.clock.advance(1000);
    t.ctx.points.award({ attendeeId: b.id, source: 'x', ref: '1', points: 5 }); // ties with c, but later
    t.ctx.points.award({ attendeeId: a.id, source: 'x', ref: '1', points: 1 });

    const lb = t.ctx.points.leaderboard(10, b.id);
    expect(lb.entries.map((e) => [e.rank, e.nickname, e.total])).toEqual([
      [1, 'chitra', 25],
      [2, 'bala', 25],
      [3, 'anna', 21],
    ]);
    expect(lb.me).toEqual({ rank: 2, total: 25 });
    expect(lb.players).toBe(3);
    expect(t.ctx.points.rankOf(a.id)).toBe(3);

    // over HTTP: attendee gets "me", anonymous is refused
    const http = await req(t.app, a.jar, 'GET', '/api/points/leaderboard?limit=2');
    expect(http.json().entries).toHaveLength(2);
    expect(http.json().me).toEqual({ rank: 3, total: 21 });
    expect((await req(t.app, new Jar(), 'GET', '/api/points/leaderboard')).statusCode).toBe(401);
    expect((await req(t.app, dJar, 'GET', '/api/points/me')).json()).toMatchObject({ total: 10, rank: null });
  });

  it('cache is invalidated by awards', async () => {
    const [k1, k2] = await makeKits(t.app, 2);
    const a = await signedInAttendee(t.app, k1!, 'anna');
    const b = await signedInAttendee(t.app, k2!, 'bala');
    expect(t.ctx.points.leaderboard(10).entries[0]?.attendeeId).toBe(a.id);
    t.ctx.points.award({ attendeeId: b.id, source: 'x', ref: '1', points: 100 });
    expect(t.ctx.points.leaderboard(10).entries[0]?.attendeeId).toBe(b.id);
  });
});

describe('stickers', () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await makeApp();
  });
  afterEach(async () => t.close());

  it('unlock is idempotent and publishes the celebration exactly once', async () => {
    const [kit] = await makeKits(t.app, 1);
    const { id, jar } = await signedInAttendee(t.app, kit!);
    const cap = capture(t.ctx, { attendeeId: id, admin: false, screen: false });
    expect(t.ctx.stickers.unlock(id, 'reactions-hype')).toEqual({ unlocked: true });
    expect(t.ctx.stickers.unlock(id, 'reactions-hype')).toEqual({ unlocked: false });
    const evts = cap.events.filter((e) => e.type === 'sticker.unlocked');
    expect(evts).toHaveLength(1);
    expect(evts[0]!.data).toMatchObject({ sticker: { id: 'reactions-hype', feature: 'reactions' } });

    const book = (await req(t.app, jar, 'GET', '/api/stickers')).json();
    expect(Object.keys(book.unlocked).sort()).toEqual(['new-face', 'reactions-hype', 'showed-up']);
    expect(book.catalogue.map((s: { id: string }) => s.id)).toContain('reactions-hype');
    cap.unsub();
  });

  it('unknown stickers and duplicate registrations throw', () => {
    expect(() => t.ctx.stickers.unlock(1, 'nope')).toThrow(/Unknown sticker/);
    expect(() =>
      t.ctx.stickers.register([{ id: 'showed-up', title: 'x', hint: '', shape: 'star', color: 'lime', glyph: 'star', feature: 'x' }]),
    ).toThrow(/Duplicate/);
    expect(() =>
      t.ctx.stickers.register([{ id: 'Bad Id', title: 'x', hint: '', shape: 'star', color: 'lime', glyph: 'star', feature: 'x' }]),
    ).toThrow();
  });
});
