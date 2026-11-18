import type { AlertStatus, AnnounceResponse, Banner, RecentBannersResponse } from '@afterhours/shared/features/alerts';
import type { ScheduleState } from '@afterhours/shared/features/schedule';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import type { PushSender } from '../../core/push/service';
import { type Jar, SRC_ROOT, type TestApp, adminJar, capture, makeApp, makeKits, req, signedInAttendee } from '../../../test/helpers';
import { features } from '../registry';
import { LIVE_WINDOW_MS, SOON_LEAD_MS, checkAlerts, istTime } from './index';

const MIN = 60_000;

interface Sent {
  endpoint: string;
  payload: { title: string; body: string; url: string; tag?: string };
}

describe('alerts feature', () => {
  let sent: Sent[];
  let t: TestApp;
  let admin: Jar;
  let base: number;
  let fail: ((endpoint: string) => number | null) | null;
  let sender: PushSender;

  beforeEach(async () => {
    sent = [];
    fail = null;
    sender = async (s, body) => {
      const code = fail?.(s.endpoint);
      if (code) throw Object.assign(new Error('push failed'), { statusCode: code });
      sent.push({ endpoint: s.endpoint, payload: JSON.parse(body) as Sent['payload'] });
    };
    t = await makeApp({ pushSender: sender });
    admin = await adminJar(t.app);
    base = t.clock.now();
  });
  afterEach(async () => t.close());

  const sub = (n: number, attendeeId: number | null = null) =>
    t.ctx.push.subscribe(attendeeId, { endpoint: `https://push.example/${n}`, keys: { p256dh: 'p', auth: 'a' } });
  async function make(title: string, fromMin: number, toMin: number, extra: Record<string, unknown> = {}): Promise<number> {
    const r = await req(t.app, admin, 'POST', '/api/schedule', { title, startAt: base + fromMin * MIN, endAt: base + toMin * MIN, highlight: true, location: 'seminar hall', ...extra });
    expect(r.statusCode).toBe(200);
    return (r.json() as ScheduleState).activities.find((a) => a.title === title)!.id;
  }
  const act = (path: string, body?: unknown) => req(t.app, admin, 'POST', `/api/schedule${path}`, body);
  const tickAt = async (min: number) => {
    t.clock.set(base + min * MIN);
    return checkAlerts(t.ctx);
  };
  const titles = (which?: string) => sent.filter((s) => !which || s.endpoint === which).map((s) => s.payload.title);

  describe('15 minute and live-now alerts', () => {
    it('sends "in 15 min" once when the window opens, never before, never twice', async () => {
      sub(1);
      await make('hot takes', 30, 60);
      expect(await tickAt(14)).toBe(0); // 16 min out
      expect(sent).toHaveLength(0);
      expect(await tickAt(15)).toBe(1); // exactly 15 min out
      expect(sent).toHaveLength(1);
      expect(sent[0]!.payload).toMatchObject({ title: 'hot takes in 15 min', url: '/', tag: expect.stringMatching(/^ah-soon-/) as string });
      expect(sent[0]!.payload.body).toContain('seminar hall');
      for (const m of [16, 20, 29.99]) expect(await tickAt(m)).toBe(0);
      expect(sent).toHaveLength(1);
    });

    it('sends "live now" once when the start time arrives', async () => {
      sub(1);
      await make('hot takes', 30, 60, { link: '/polls' });
      await tickAt(16);
      sent.length = 0;
      expect(await tickAt(29)).toBe(0);
      expect(await tickAt(30)).toBe(1);
      expect(sent.map((s) => s.payload.title)).toEqual(['hot takes is live']);
      expect(sent[0]!.payload.url).toBe('/polls');
      expect(await tickAt(31)).toBe(0);
      expect(await tickAt(35)).toBe(0);
    });

    it('only highlights get alerts', async () => {
      sub(1);
      await make('plain talk', 20, 40, { highlight: false });
      await tickAt(10);
      await tickAt(20);
      expect(sent).toHaveLength(0);
    });

    it('turning highlight off before it fires cancels it, turning it on arms it', async () => {
      sub(1);
      const id = await make('x', 30, 60, { highlight: false });
      await act(`/${id}/highlight`, { highlight: true });
      await tickAt(20);
      expect(sent).toHaveLength(1);
      await act(`/${id}/highlight`, { highlight: false });
      await tickAt(30);
      expect(sent).toHaveLength(1);
    });

    it('every subscribed phone gets each alert once; unsubscribed ones get nothing', async () => {
      for (let i = 0; i < 5; i++) sub(i);
      t.ctx.push.unsubscribe('https://push.example/4');
      await make('x', 20, 40);
      await tickAt(10);
      await tickAt(10);
      expect(sent.map((s) => s.endpoint).sort()).toEqual([0, 1, 2, 3].map((i) => `https://push.example/${i}`));
    });

    it('two ticks racing still send once', async () => {
      sub(1);
      await make('x', 20, 40);
      t.clock.set(base + 10 * MIN);
      await Promise.all([checkAlerts(t.ctx), checkAlerts(t.ctx), checkAlerts(t.ctx)]);
      expect(sent).toHaveLength(1);
    });

    it('works with push off: the in-app banner still goes out exactly once', async () => {
      const off = await makeApp(); // no VAPID, no sender
      const adminOff = await adminJar(off.app);
      const startAt = off.clock.now() + 20 * MIN;
      await req(off.app, adminOff, 'POST', '/api/schedule', { title: 'x', startAt, endAt: startAt + 10 * MIN, highlight: true });
      const c = capture(off.ctx, { attendeeId: null, admin: false, screen: true });
      off.clock.advance(6 * MIN);
      await checkAlerts(off.ctx);
      await checkAlerts(off.ctx);
      expect(c.types().filter((x) => x === 'alerts.banner')).toHaveLength(1);
      c.unsub();
      await off.close();
    });

    it('a failing push service does not break the banner, and the alert is not retried', async () => {
      sub(1);
      sub(2);
      fail = (e) => (e.endsWith('/1') ? 500 : null);
      await make('x', 20, 40);
      const c = capture(t.ctx, { attendeeId: null, admin: true, screen: false });
      await tickAt(10);
      await tickAt(10);
      expect(sent.map((s) => s.endpoint)).toEqual(['https://push.example/2']);
      expect(c.types().filter((x) => x === 'alerts.banner')).toHaveLength(1);
      const status = (await req(t.app, admin, 'GET', '/api/alerts/status')).json() as AlertStatus;
      expect(status.log[0]!.push).toEqual({ sent: 1, failed: 1, removed: 0 });
      c.unsub();
    });

    it('dead subscriptions (410) are pruned', async () => {
      sub(1);
      sub(2);
      fail = (e) => (e.endsWith('/1') ? 410 : null);
      await make('x', 20, 40);
      await tickAt(10);
      expect(t.ctx.push.count()).toBe(1);
    });
  });

  describe('banners', () => {
    it('the same event reaches phones, the projector and the console', async () => {
      const [kit] = await makeKits(t.app, 1);
      const phone = await signedInAttendee(t.app, kit!);
      const views = [
        capture(t.ctx, { attendeeId: phone.id, admin: false, screen: false }),
        capture(t.ctx, { attendeeId: null, admin: false, screen: true }),
        capture(t.ctx, { attendeeId: null, admin: true, screen: false }),
      ];
      await make('hot takes', 20, 40);
      await tickAt(5);
      for (const v of views) {
        const b = v.events.filter((e) => e.type === 'alerts.banner').map((e) => e.data as Banner);
        expect(b).toHaveLength(1);
        expect(b[0]).toMatchObject({ kind: 'soon', title: 'hot takes in 15 min', activityId: expect.any(Number) as number });
        v.unsub();
      }
    });
  });

  describe('survives a restart', () => {
    async function restart(): Promise<TestApp['ctx']> {
      // Same database, same clock, brand-new app (no in-memory state carried over).
      const { app, ctx } = await buildApp({ config: t.ctx.config, srcRoot: SRC_ROOT, features, db: t.ctx.db, now: t.clock.now, timers: false, pushSender: sender });
      await app.ready();
      return ctx;
    }

    it('restart inside the 15 min window does not resend; the live alert still fires later, once', async () => {
      sub(1);
      await make('x', 30, 60);
      await tickAt(16);
      expect(sent).toHaveLength(1);
      const ctx2 = await restart();
      t.clock.set(base + 20 * MIN);
      expect(await checkAlerts(ctx2)).toBe(0);
      expect(sent).toHaveLength(1);
      t.clock.set(base + 30 * MIN);
      await checkAlerts(ctx2);
      await checkAlerts(ctx2);
      expect(sent.map((s) => s.payload.title)).toEqual(['x in 15 min', 'x is live']);
      const ctx3 = await restart();
      await checkAlerts(ctx3);
      expect(sent).toHaveLength(2);
    });

    it('a restart before anything fired still sends the due alert once', async () => {
      sub(1);
      await make('x', 30, 60);
      t.clock.set(base + 17 * MIN);
      const ctx2 = await restart();
      await checkAlerts(ctx2);
      await checkAlerts(t.ctx);
      expect(sent).toHaveLength(1);
    });

    it('server down through the whole window: soon is skipped, live fires only if still fresh', async () => {
      sub(1);
      await make('x', 30, 60);
      await tickAt(31); // came back 1 min late
      expect(titles()).toEqual(['x is live']);
      sent.length = 0;
      await make('y', 100, 130);
      await tickAt(100 + LIVE_WINDOW_MS / MIN + 1); // came back 11 min late
      expect(sent).toHaveLength(0);
      const s = (await req(t.app, admin, 'GET', '/api/alerts/status')).json() as AlertStatus;
      expect(s.armed.find((a) => a.title === 'y')).toMatchObject({ soon: { state: 'missed' }, live: { state: 'missed' } });
    });
  });

  describe('re-arming', () => {
    it('a delay after the 15 min alert fired re-arms it for the new time, replacing the old notification', async () => {
      sub(1);
      const id = await make('hot takes', 30, 60);
      await tickAt(15);
      expect(titles()).toEqual(['hot takes in 15 min']);
      const firstTag = sent[0]!.payload.tag;

      await act(`/${id}/delay`, { minutes: 15 }); // now starts at 45
      const delayedStart = base + 45 * MIN;
      expect(await tickAt(16)).toBe(0); // 29 min out: not yet
      expect(await tickAt(29)).toBe(0);
      expect(await tickAt(30)).toBe(1); // 15 min before the new time
      expect(sent).toHaveLength(2);
      expect(sent[1]!.payload.title).toBe(`hot takes moved to ${istTime(delayedStart)}`);
      expect(sent[1]!.payload.tag).toBe(firstTag); // replaces, does not stack
      expect(await tickAt(31)).toBe(0);

      // and the live alert fires at the new start only
      expect(await tickAt(44)).toBe(0);
      expect(await tickAt(45)).toBe(1);
      expect(sent[2]!.payload.title).toBe('hot takes is live');
      expect(await tickAt(46)).toBe(0);
      expect(sent).toHaveLength(3);
    });

    it('a delay that lands inside the window re-sends straight away, once', async () => {
      sub(1);
      const id = await make('x', 30, 60);
      await tickAt(20); // soon fired
      await act(`/${id}/delay`, { minutes: 5 }); // starts at 35, window already open
      expect(await tickAt(20)).toBe(1);
      expect(sent[1]!.payload.title).toContain('moved to');
      expect(await tickAt(21)).toBe(0);
    });

    it('a delay before the 15 min alert fired just moves it: one alert, at the new time', async () => {
      sub(1);
      const id = await make('x', 30, 60);
      await tickAt(10);
      await act(`/${id}/delay`, { minutes: 10 });
      expect(await tickAt(20)).toBe(0); // old window time, nothing
      expect(await tickAt(25)).toBe(1);
      expect(sent[0]!.payload.title).toBe('x in 15 min'); // not "moved": nothing was announced before
    });

    it('a delay after "live now" fired re-arms nothing but, if it makes the start later again, re-fires at the new start', async () => {
      sub(1);
      const id = await make('x', 30, 60);
      await tickAt(16);
      await tickAt(30);
      expect(sent.map((s) => s.payload.title)).toEqual(['x in 15 min', 'x is live']);
      // organiser realises it did not really start: delay pulls it back to upcoming
      await act(`/${id}/delay`, { minutes: 10 });
      expect(await tickAt(31)).toBe(1); // soon window for the new 40 start is open (9 min out)
      expect(await tickAt(40)).toBe(1);
      expect(sent.at(-1)!.payload.title).toBe('x is live');
    });
  });

  describe('start early, end, delete', () => {
    it('starting early before the window opens sends live-now once, and never "in 15"', async () => {
      sub(1);
      const id = await make('x', 60, 90);
      await tickAt(5);
      await act(`/${id}/start`);
      await tickAt(5);
      await tickAt(6);
      expect(titles()).toEqual(['x is live']);
      await tickAt(60);
      expect(sent).toHaveLength(1);
    });

    it('starting early after the 15 min alert: live-now fires immediately, once', async () => {
      sub(1);
      const id = await make('x', 30, 60);
      await tickAt(16);
      await tickAt(20);
      await act(`/${id}/start`);
      await tickAt(20);
      await tickAt(30);
      expect(titles()).toEqual(['x in 15 min', 'x is live']);
    });

    it('a pre-fired soon alert followed by ending the activity sends nothing more', async () => {
      sub(1);
      const id = await make('x', 30, 60);
      await tickAt(16);
      await act(`/${id}/start`);
      await tickAt(16);
      await act(`/${id}/end`);
      await tickAt(30);
      expect(titles()).toEqual(['x in 15 min', 'x is live']);
    });

    it('deleting before the window cancels everything; deleting after the 15 min alert cancels the live one', async () => {
      sub(1);
      const a = await make('a', 30, 60);
      const b = await make('b', 100, 120);
      await req(t.app, admin, 'DELETE', `/api/schedule/${a}`);
      await tickAt(20);
      await tickAt(30);
      expect(sent).toHaveLength(0);
      await tickAt(86);
      expect(titles()).toEqual(['b in 15 min']);
      await req(t.app, admin, 'DELETE', `/api/schedule/${b}`);
      await tickAt(100);
      expect(sent).toHaveLength(1);
      // a new activity does not inherit the old one's claims (ids are never reused)
      await make('c', 130, 140);
      await tickAt(116);
      expect(titles()).toEqual(['b in 15 min', 'c in 15 min']);
    });

    it('an activity whose time passed while nobody was looking never alerts', async () => {
      sub(1);
      await make('a', 30, 40);
      await tickAt(45);
      expect(sent).toHaveLength(0);
    });
  });

  describe('announcements', () => {
    const announce = (jar: Jar | null, body: unknown) => req(t.app, jar, 'POST', '/api/alerts/announce', body);

    it('is console only and validated', async () => {
      const [kit] = await makeKits(t.app, 1);
      const a = await signedInAttendee(t.app, kit!);
      expect((await announce(null, { body: 'hi' })).statusCode).toBe(401);
      expect((await announce(a.jar, { body: 'hi' })).statusCode).toBe(401);
      expect((await announce(admin, { body: '' })).statusCode).toBe(400);
      expect((await announce(admin, { body: 'x'.repeat(201) })).statusCode).toBe(400);
      expect((await announce(admin, { body: 'hi', link: 'javascript:alert(1)' })).statusCode).toBe(400);
      expect((await announce(admin, { body: 'hi', title: 'x'.repeat(61) })).statusCode).toBe(400);
    });

    it('goes out as a live banner to everyone and a push to every subscriber, together', async () => {
      const kits = await makeKits(t.app, 2);
      const p1 = await signedInAttendee(t.app, kits[0]!, 'one');
      const p2 = await signedInAttendee(t.app, kits[1]!, 'two');
      sub(1, p1.id);
      sub(2, p2.id);
      sub(3);
      const c1 = capture(t.ctx, { attendeeId: p1.id, admin: false, screen: false });
      const screen = capture(t.ctx, { attendeeId: null, admin: false, screen: true });
      const r = await announce(admin, { title: 'food is here', body: 'biryani at the atrium, go go', link: '/polls' });
      expect(r.statusCode).toBe(200);
      const res = r.json() as AnnounceResponse;
      expect(res.push).toEqual({ sent: 3, failed: 0, removed: 0 });
      expect(res.banner).toMatchObject({ kind: 'announcement', title: 'food is here', url: '/polls', activityId: null });
      expect(sent).toHaveLength(3);
      expect(sent[0]!.payload).toMatchObject({ title: 'food is here', body: 'biryani at the atrium, go go', url: '/polls' });
      for (const c of [c1, screen]) expect(c.events.filter((e) => e.type === 'alerts.banner').map((e) => (e.data as Banner).id)).toEqual([res.banner.id]);
      c1.unsub();
      screen.unsub();
    });

    it('push:false is banner only; no subscribers is fine; each announcement is its own alert', async () => {
      sub(1);
      const r1 = (await announce(admin, { body: 'quiet one', push: false })).json() as AnnounceResponse;
      expect(r1.push).toBeNull();
      expect(sent).toHaveLength(0);
      const r2 = (await announce(admin, { body: 'quiet one' })).json() as AnnounceResponse;
      expect(r2.banner.id).not.toBe(r1.banner.id);
      expect(sent).toHaveLength(1);
      expect(sent[0]!.payload.title).toBe('announcement');
    });

    it('is rate limited', async () => {
      let limited = 0;
      for (let i = 0; i < 14; i++) if ((await announce(admin, { body: `n${i}`, push: false })).statusCode === 429) limited++;
      expect(limited).toBe(4);
    });

    it('a banner is plain text (the UI renders it escaped); markup is kept as data, not interpreted by us', async () => {
      const r = (await announce(admin, { body: '<img src=x onerror=alert(1)>', push: false })).json() as AnnounceResponse;
      expect(r.banner.body).toBe('<img src=x onerror=alert(1)>');
    });
  });

  describe('recent, test and status routes', () => {
    it('recent replays the last 10 banners, oldest first, to signed-in phones only', async () => {
      const [kit] = await makeKits(t.app, 1);
      const a = await signedInAttendee(t.app, kit!);
      expect((await req(t.app, null, 'GET', '/api/alerts/recent')).statusCode).toBe(401);
      for (let i = 0; i < 12; i++) {
        if (i === 6) t.clock.advance(61_000); // announce rate limit
        await req(t.app, admin, 'POST', '/api/alerts/announce', { body: `n${i}`, push: false });
      }
      const { banners } = (await req(t.app, a.jar, 'GET', '/api/alerts/recent')).json() as RecentBannersResponse;
      expect(banners.map((b) => b.body)).toEqual(Array.from({ length: 10 }, (_, i) => `n${i + 2}`));
    });

    it('test push goes only to the caller, and is rate limited', async () => {
      const kits = await makeKits(t.app, 2);
      const a = await signedInAttendee(t.app, kits[0]!, 'aa');
      const b = await signedInAttendee(t.app, kits[1]!, 'bb');
      sub(1, a.id);
      sub(2, b.id);
      const r = (await req(t.app, a.jar, 'POST', '/api/alerts/test')).json() as { pushEnabled: boolean; devices: number; sent: number };
      expect(r).toEqual({ pushEnabled: true, devices: 1, sent: 1 });
      expect(sent.map((s) => s.endpoint)).toEqual(['https://push.example/1']);
      await req(t.app, a.jar, 'POST', '/api/alerts/test');
      await req(t.app, a.jar, 'POST', '/api/alerts/test');
      expect((await req(t.app, a.jar, 'POST', '/api/alerts/test')).statusCode).toBe(429);
      expect((await req(t.app, null, 'POST', '/api/alerts/test')).statusCode).toBe(401);
    });

    it('status is console only and shows what is armed', async () => {
      const [kit] = await makeKits(t.app, 1);
      const a = await signedInAttendee(t.app, kit!);
      expect((await req(t.app, a.jar, 'GET', '/api/alerts/status')).statusCode).toBe(401);
      await make('x', 30, 60);
      await make('plain', 40, 50, { highlight: false });
      await tickAt(16);
      const s = (await req(t.app, admin, 'GET', '/api/alerts/status')).json() as AlertStatus;
      expect(s.armed).toHaveLength(1);
      expect(s.armed[0]).toMatchObject({ title: 'x', soon: { dueAt: base + 30 * MIN - SOON_LEAD_MS, state: 'sent' }, live: { state: 'pending' } });
      expect(s.log).toHaveLength(1);
    });
  });

  describe('scale', () => {
    it('300 subscribed phones: one alert is 300 pushes, once, quickly', async () => {
      for (let i = 0; i < 300; i++) sub(i);
      await make('x', 20, 40);
      const started = performance.now();
      await tickAt(10);
      await tickAt(10);
      expect(sent).toHaveLength(300);
      expect(new Set(sent.map((s) => s.endpoint)).size).toBe(300);
      expect(performance.now() - started).toBeLessThan(2000);
    });
  });
});
