import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LiveBus, type Viewer, anonymousViewer, matchesAudience } from '../src/core/live/bus';
import { type Jar, type TestApp, adminJar, makeApp, makeKits, req, signedInAttendee } from './helpers';

const A: Viewer = { attendeeId: 1, admin: false, screen: false };
const B: Viewer = { attendeeId: 2, admin: false, screen: false };
const ADMIN: Viewer = { attendeeId: null, admin: true, screen: false };
const SCREEN: Viewer = { attendeeId: null, admin: false, screen: true };

describe('audience matching', () => {
  it('routes each audience to the right viewers', () => {
    expect(matchesAudience(['all'], anonymousViewer)).toBe(true);
    expect(matchesAudience(['attendees'], anonymousViewer)).toBe(false);
    expect(matchesAudience(['attendees'], A)).toBe(true);
    expect(matchesAudience([{ attendeeId: 1 }], A)).toBe(true);
    expect(matchesAudience([{ attendeeId: 1 }], B)).toBe(false);
    expect(matchesAudience(['admins'], ADMIN)).toBe(true);
    expect(matchesAudience(['admins'], SCREEN)).toBe(false);
    expect(matchesAudience(['screens'], SCREEN)).toBe(true);
    expect(matchesAudience(['screens'], ADMIN)).toBe(true); // console can preview the projector
    expect(matchesAudience(['screens'], A)).toBe(false);
    expect(matchesAudience(['admins', { attendeeId: 2 }], B)).toBe(true);
  });
});

describe('LiveBus', () => {
  let t = 1_000_000;
  const now = () => t;
  let bus: LiveBus;
  beforeEach(() => {
    t = 1_000_000;
    bus = new LiveBus({ now, bufferSize: 5, heartbeatMs: 0 });
  });
  afterEach(() => bus.close());

  it('issues strictly increasing cursors seeded from boot time', () => {
    const a = bus.publish('leaderboard.changed', { at: 1 });
    const b = bus.publish('leaderboard.changed', { at: 2 });
    expect(a.cursor).toBe(1_000_001);
    expect(b.cursor).toBe(a.cursor + 1);
    expect(bus.currentCursor).toBe(b.cursor);
  });

  it('since() returns only newer events the viewer may see', () => {
    const start = bus.currentCursor;
    bus.publish('leaderboard.changed', { at: 1 }, 'all');
    bus.publish('session.revoked', { reason: 'kit-reset' }, { attendeeId: 2 });
    bus.publish('screen.pinned', { pinned: 'join' }, 'screens');
    const forA = bus.since(start, A);
    expect(forA.reset).toBe(false);
    expect(forA.events.map((e) => e.type)).toEqual(['leaderboard.changed']);
    expect(bus.since(start, B).events.map((e) => e.type)).toEqual(['leaderboard.changed', 'session.revoked']);
    expect(bus.since(start, SCREEN).events.map((e) => e.type)).toEqual(['leaderboard.changed', 'screen.pinned']);
    expect(bus.since(start + 1, B).events.map((e) => e.type)).toEqual(['session.revoked']);
    expect(bus.since(bus.currentCursor, B).events).toEqual([]);
  });

  it('bounded replay buffer: too-old cursors get reset=true', () => {
    const start = bus.currentCursor;
    for (let i = 0; i < 8; i++) bus.publish('leaderboard.changed', { at: i });
    const r = bus.since(start, A);
    expect(r.reset).toBe(true);
    expect(r.cursor).toBe(bus.currentCursor);
    // the last 5 are still replayable
    expect(bus.since(bus.currentCursor - 5, A)).toMatchObject({ reset: false });
    expect(bus.since(bus.currentCursor - 5, A).events).toHaveLength(5);
  });

  it('cursors from a previous boot or from the future force a reset', () => {
    bus.publish('leaderboard.changed', { at: 1 });
    expect(bus.since(5, A).reset).toBe(true);
    expect(bus.since(bus.currentCursor + 10, A).reset).toBe(true);
    // a restarted server starts above every cursor the old one issued
    t += 60_000;
    const next = new LiveBus({ now, heartbeatMs: 0 });
    expect(next.currentCursor).toBeGreaterThan(bus.currentCursor);
    expect(next.since(bus.currentCursor, A).reset).toBe(true);
    next.close();
  });

  it('serialises once and writes only to matching clients; drops dead clients', () => {
    const got: Record<string, string[]> = { a: [], b: [] };
    bus.subscribe({ viewer: A, write: (f) => (got.a!.push(f), true), close() {} });
    let closed = false;
    bus.subscribe({ viewer: B, write: () => false, close: () => void (closed = true) });
    bus.publish('session.revoked', { reason: 'kit-reset' }, { attendeeId: 1 });
    bus.publish('leaderboard.changed', { at: 1 });
    expect(got.a).toHaveLength(2);
    expect(got.a![0]).toMatch(/^id: \d+\ndata: \{.*"type":"session.revoked"/);
    expect(closed).toBe(true);
    expect(bus.connectionCount).toBe(1);
  });
});

describe('live over HTTP', () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await makeApp();
  });
  afterEach(async () => t.close());

  it('poll endpoint (the fallback) targets by session cookie', async () => {
    const [k1, k2] = await makeKits(t.app, 2);
    const a = await signedInAttendee(t.app, k1!, 'alpha');
    const b = await signedInAttendee(t.app, k2!, 'bravo');
    const admin = await adminJar(t.app);
    const start = (await req(t.app, a.jar, 'GET', '/api/live/poll')).json().cursor as number;

    t.ctx.live.publish('session.revoked', { reason: 'kit-reset' }, { attendeeId: b.id });
    t.ctx.live.publish('screen.pinned', { pinned: null }, 'admins');
    t.ctx.live.publish('leaderboard.changed', { at: 1 }, 'all');

    const types = async (jar: Jar | null) =>
      ((await req(t.app, jar, 'GET', `/api/live/poll?since=${start}`)).json().events as { type: string }[]).map((e) => e.type);
    expect(await types(a.jar)).toEqual(['leaderboard.changed']);
    expect(await types(b.jar)).toEqual(['session.revoked', 'leaderboard.changed']);
    expect(await types(admin)).toEqual(['screen.pinned', 'leaderboard.changed']);
    expect(await types(null)).toEqual(['leaderboard.changed']);

    const stale = (await req(t.app, a.jar, 'GET', '/api/live/poll?since=12')).json();
    expect(stale.reset).toBe(true);
    expect((await req(t.app, a.jar, 'GET', '/api/live/poll?since=abc')).statusCode).toBe(400);
  });
});

/** Minimal SSE reader over node:http (no connection pooling limits). */
function openStream(port: number, path: string, headers: Record<string, string> = {}) {
  const frames: { event: string; data: string; id?: string }[] = [];
  let buf = '';
  const waiters: { pred: () => boolean; resolve: () => void }[] = [];
  const check = () => {
    for (const w of [...waiters]) {
      if (!w.pred()) continue;
      waiters.splice(waiters.indexOf(w), 1);
      w.resolve();
    }
  };
  const request = http.get({ host: '127.0.0.1', port, path, headers: { accept: 'text/event-stream', ...headers } }, (res) => {
    res.setEncoding('utf8');
    res.on('data', (chunk: string) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const raw = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const f: { event: string; data: string; id?: string } = { event: 'message', data: '' };
        for (const line of raw.split('\n')) {
          if (line.startsWith('event: ')) f.event = line.slice(7);
          else if (line.startsWith('data: ')) f.data += line.slice(6);
          else if (line.startsWith('id: ')) f.id = line.slice(4);
        }
        if (f.data || f.event !== 'message') frames.push(f);
      }
      check();
    });
  });
  request.on('error', () => {});
  return {
    frames,
    until: (pred: () => boolean, ms = 5000) =>
      new Promise<void>((resolve, reject) => {
        if (pred()) return resolve();
        const timer = setTimeout(() => reject(new Error('timeout waiting for SSE frame')), ms);
        waiters.push({ pred, resolve: () => (clearTimeout(timer), resolve()) });
      }),
    close: () => request.destroy(),
  };
}

describe('SSE stream', () => {
  let t: TestApp;
  let port: number;
  beforeEach(async () => {
    t = await makeApp();
    await t.app.listen({ port: 0, host: '127.0.0.1' });
    port = (t.app.server.address() as AddressInfo).port;
  });
  afterEach(async () => t.close());

  it('says hello, delivers targeted events, and replays from Last-Event-ID', async () => {
    const [kit] = await makeKits(t.app, 1);
    const a = await signedInAttendee(t.app, kit!, 'alpha');
    const s = openStream(port, '/api/live', { cookie: a.jar.header });
    await s.until(() => s.frames.some((f) => f.event === 'hello'));
    expect(t.ctx.live.connectionCount).toBe(1);

    t.ctx.live.publish('session.revoked', { reason: 'kit-reset' }, { attendeeId: 999 }); // not for us
    const env = t.ctx.live.publish('points.awarded', { source: 'x', ref: 'y', points: 3, total: 23, label: null }, { attendeeId: a.id });
    await s.until(() => s.frames.some((f) => f.event === 'message'));
    const msgs = s.frames.filter((f) => f.event === 'message');
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.id).toBe(String(env.cursor));
    expect(JSON.parse(msgs[0]!.data)).toMatchObject({ type: 'points.awarded', data: { total: 23 } });
    s.close();

    // reconnect with Last-Event-ID one before: the event is replayed
    const again = openStream(port, '/api/live', { cookie: a.jar.header, 'last-event-id': String(env.cursor - 1) });
    await again.until(() => again.frames.some((f) => f.event === 'hello'));
    expect(again.frames.filter((f) => f.event === 'message').map((f) => JSON.parse(f.data).type)).toEqual(['points.awarded']);
    again.close();
  });

  it('sends heartbeats', async () => {
    const quick = await makeApp();
    // timers are off in tests; build a bus heartbeat by hand via a real bus option
    const bus = new LiveBus({ heartbeatMs: 50 });
    const frames: string[] = [];
    bus.subscribe({ viewer: anonymousViewer, write: (f) => (frames.push(f), true), close() {} });
    await new Promise((r) => setTimeout(r, 180));
    expect(frames.filter((f) => f.startsWith('event: hb')).length).toBeGreaterThanOrEqual(2);
    bus.close();
    await quick.close();
  });

  it('holds 300 open streams and fans one event out to all of them', async () => {
    const N = 300;
    // Open in waves of 50: Windows caps the listen backlog near 200, so 300
    // connects in the same millisecond get refused by the OS before Node
    // sees them. Real phones never arrive like that.
    const streams: ReturnType<typeof openStream>[] = [];
    for (let wave = 0; wave < N / 50; wave++) {
      const batch = Array.from({ length: 50 }, () => openStream(port, '/api/live'));
      await Promise.all(batch.map((s) => s.until(() => s.frames.some((f) => f.event === 'hello'), 15_000)));
      streams.push(...batch);
    }
    expect(t.ctx.live.connectionCount).toBe(N);
    const started = performance.now();
    t.ctx.live.publish('leaderboard.changed', { at: 42 }, 'all');
    await Promise.all(streams.map((s) => s.until(() => s.frames.some((f) => f.event === 'message'), 10_000)));
    const ms = performance.now() - started;
    expect(ms).toBeLessThan(2000);
    for (const s of streams) s.close();
    await new Promise((r) => setTimeout(r, 200));
    expect(t.ctx.live.connectionCount).toBe(0);
  }, 30_000);
});
