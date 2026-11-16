// Example feature test: copy this shape for your own feature.
// Lives next to the feature; `npm test` picks up server/src/**/*.test.ts.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type TestApp, capture, makeApp, makeKits, req, signedInAttendee } from '../../../test/helpers';
import { HYPE_TAPS, flush } from './index';

describe('reactions feature', () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await makeApp();
  });
  afterEach(async () => t.close());

  it('batches taps into one reactions.burst for everyone', async () => {
    const [k1, k2] = await makeKits(t.app, 2);
    const a = await signedInAttendee(t.app, k1!, 'anna');
    const b = await signedInAttendee(t.app, k2!, 'bala');
    const screen = capture(t.ctx, { attendeeId: null, admin: false, screen: true });
    await req(t.app, a.jar, 'POST', '/api/reactions', { kind: 'fire' });
    await req(t.app, a.jar, 'POST', '/api/reactions', { kind: 'fire' });
    await req(t.app, b.jar, 'POST', '/api/reactions', { kind: 'clap' });
    expect(screen.types()).not.toContain('reactions.burst'); // nothing until the tick
    flush(t.ctx);
    flush(t.ctx); // empty flush publishes nothing
    const bursts = screen.events.filter((e) => e.type === 'reactions.burst');
    expect(bursts.map((e) => e.data)).toEqual([{ counts: { fire: 2, clap: 1 } }]);
    screen.unsub();
  });

  it('validates the kind and rate limits each attendee', async () => {
    const [kit] = await makeKits(t.app, 1);
    const a = await signedInAttendee(t.app, kit!);
    expect((await req(t.app, a.jar, 'POST', '/api/reactions', { kind: 'poop' })).statusCode).toBe(400);
    let limited = 0;
    for (let i = 0; i < 20; i++) if ((await req(t.app, a.jar, 'POST', '/api/reactions', { kind: 'wow' })).statusCode === 429) limited++;
    expect(limited).toBe(8); // 12 burst allowed
    t.clock.advance(6000);
    expect((await req(t.app, a.jar, 'POST', '/api/reactions', { kind: 'wow' })).statusCode).toBe(200);
  });

  it(`unlocks the hype sticker and +5 once at ${HYPE_TAPS} taps`, async () => {
    const [kit] = await makeKits(t.app, 1);
    const a = await signedInAttendee(t.app, kit!);
    const before = t.ctx.points.total(a.id);
    for (let i = 0; i < HYPE_TAPS + 3; i++) {
      t.clock.advance(1000);
      expect((await req(t.app, a.jar, 'POST', '/api/reactions', { kind: 'party' })).statusCode).toBe(200);
    }
    expect(t.ctx.stickers.unlockedBy(a.id)['reactions-hype']).toBeDefined();
    expect(t.ctx.points.total(a.id)).toBe(before + 5);
  });

  it('stats are console-only', async () => {
    expect((await req(t.app, null, 'GET', '/api/reactions/stats')).statusCode).toBe(401);
  });
});
