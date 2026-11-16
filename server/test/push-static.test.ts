import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestApp, Jar, makeApp, makeKits, req, signedInAttendee } from './helpers';

describe('push plumbing', () => {
  it('stores subscriptions, fans out by audience, and prunes dead endpoints', async () => {
    const calls: string[] = [];
    const t = await makeApp({
      env: { VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv' },
      pushSender: async (sub) => {
        calls.push(sub.endpoint);
        if (sub.endpoint.includes('gone')) throw Object.assign(new Error('gone'), { statusCode: 410 });
        if (sub.endpoint.includes('flaky')) throw Object.assign(new Error('500'), { statusCode: 500 });
      },
    });
    try {
      const [k1, k2] = await makeKits(t.app, 2);
      const a = await signedInAttendee(t.app, k1!, 'anna');
      const b = await signedInAttendee(t.app, k2!, 'bala');
      expect((await req(t.app, a.jar, 'GET', '/api/push/key')).json()).toEqual({ enabled: true, publicKey: 'pub' });
      const sub = (endpoint: string) => ({ endpoint, keys: { p256dh: 'k', auth: 'a' } });
      expect((await req(t.app, new Jar(), 'POST', '/api/push/subscribe', sub('https://push.example/x'))).statusCode).toBe(401);
      expect((await req(t.app, a.jar, 'POST', '/api/push/subscribe', sub('https://push.example/a1'))).statusCode).toBe(200);
      await req(t.app, a.jar, 'POST', '/api/push/subscribe', sub('https://push.example/gone'));
      await req(t.app, b.jar, 'POST', '/api/push/subscribe', sub('https://push.example/flaky'));
      expect(t.ctx.push.count()).toBe(3);

      const one = await t.ctx.push.sendPush({ attendeeId: b.id }, { title: 'hi', body: 'b only' });
      expect(one).toEqual({ sent: 0, failed: 1, removed: 0 });

      const everyone = await t.ctx.push.sendPush('all', { title: 'Starts in 15', body: 'Morse round', url: '/morse', tag: 'act-3' });
      expect(everyone).toEqual({ sent: 1, failed: 1, removed: 1 });
      expect(t.ctx.push.count()).toBe(2);

      await req(t.app, a.jar, 'POST', '/api/push/unsubscribe', { endpoint: 'https://push.example/a1' });
      expect(t.ctx.push.count()).toBe(1);
    } finally {
      await t.close();
    }
  });

  it('is cleanly disabled without VAPID keys', async () => {
    const t = await makeApp();
    try {
      expect((await req(t.app, null, 'GET', '/api/push/key')).json()).toEqual({ enabled: false, publicKey: null });
      expect(await t.ctx.push.sendPush('all', { title: 'x', body: 'y' })).toEqual({ sent: 0, failed: 0, removed: 0 });
    } finally {
      await t.close();
    }
  });
});

describe('static serving (production)', () => {
  let dist: string;
  let t: TestApp;
  beforeAll(async () => {
    dist = mkdtempSync(join(tmpdir(), 'ah-dist-'));
    mkdirSync(join(dist, 'assets'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html><div id="root"></div>');
    writeFileSync(join(dist, 'sw.js'), 'self.x=1');
    writeFileSync(join(dist, 'manifest.webmanifest'), '{}');
    writeFileSync(join(dist, 'assets', 'index-abc123.js'), 'console.log(1)');
    writeFileSync(join(dist, 'icon-192.png'), 'png');
    t = await makeApp({ env: { WEB_DIST: dist } });
  });
  afterAll(async () => {
    await t.close();
    rmSync(dist, { recursive: true, force: true });
  });

  it('hashed assets are immutable; index, sw and manifest are no-cache', async () => {
    const asset = await req(t.app, null, 'GET', '/assets/index-abc123.js');
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    for (const p of ['/', '/sw.js', '/manifest.webmanifest']) {
      const r = await req(t.app, null, 'GET', p);
      expect(r.statusCode, p).toBe(200);
      expect(r.headers['cache-control'], p).toBe('no-cache');
    }
    expect((await req(t.app, null, 'GET', '/icon-192.png')).headers['cache-control']).toBe('public, max-age=86400');
  });

  it('SPA fallback for app routes, real 404s for files and the API', async () => {
    for (const p of ['/admin/kits', '/screen', '/dev/kit', '/profile?x=1']) {
      const r = await req(t.app, null, 'GET', p);
      expect(r.statusCode, p).toBe(200);
      expect(r.body).toContain('id="root"');
      expect(r.headers['cache-control']).toBe('no-cache');
    }
    expect((await req(t.app, null, 'GET', '/assets/missing.js')).statusCode).toBe(404);
    const api = await req(t.app, null, 'GET', '/api/nope');
    expect(api.statusCode).toBe(404);
    expect(api.json().error.code).toBe('not_found');
  });

  it('API responses are no-store and carry security headers', async () => {
    const r = await req(t.app, null, 'GET', '/api/time');
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(typeof r.json().now).toBe('number');
    expect((await req(t.app, null, 'GET', '/api/health')).json()).toMatchObject({ ok: true });
  });
});
