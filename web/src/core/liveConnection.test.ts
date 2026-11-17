import type { LivePollResponse } from '@afterhours/shared';
import { describe, expect, it } from 'vitest';
import { LiveConnection, type LiveDeps } from './liveConnection';

/** Deterministic fake timers + fake EventSource + fake poll endpoint. */
function harness() {
  let now = 0;
  const timers: { id: number; at: number; every?: number; fn: () => void }[] = [];
  let nextId = 1;
  const sources: FakeES[] = [];
  const polls: (number | null)[] = [];
  let pollReply: LivePollResponse = { cursor: 100, events: [], reset: false };
  let pollFails = false;

  class FakeES {
    url: string;
    closed = false;
    onerror: ((e: Event) => void) | null = null;
    listeners: Record<string, ((e: MessageEvent<string>) => void)[]> = {};
    constructor(url: string) {
      this.url = url;
      sources.push(this);
    }
    addEventListener(type: string, fn: (e: MessageEvent<string>) => void) {
      (this.listeners[type] ??= []).push(fn);
    }
    emit(type: string, data: string) {
      for (const fn of this.listeners[type] ?? []) fn({ data } as MessageEvent<string>);
    }
    close() {
      this.closed = true;
    }
  }

  const deps: LiveDeps = {
    createEventSource: (url) => new FakeES(url),
    poll: async (since) => {
      polls.push(since);
      if (pollFails) throw new Error('offline');
      return pollReply;
    },
    now: () => now,
    setInterval: (fn, ms) => (timers.push({ id: nextId, at: now + ms, every: ms, fn }), nextId++),
    clearInterval: (id) => void timers.splice(timers.findIndex((t) => t.id === id) >>> 0, 1),
    setTimeout: (fn, ms) => (timers.push({ id: nextId, at: now + ms, fn }), nextId++),
    clearTimeout: (id) => {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
  };

  async function advance(ms: number) {
    const end = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const t = timers[0];
      if (!t || t.at > end) break;
      now = t.at;
      if (t.every) t.at += t.every;
      else timers.shift();
      t.fn();
      await Promise.resolve();
      await Promise.resolve();
    }
    now = end;
    await Promise.resolve();
  }

  return {
    deps,
    sources,
    polls,
    advance,
    setPoll: (r: LivePollResponse) => void (pollReply = r),
    setPollFails: (f: boolean) => void (pollFails = f),
    latest: () => sources[sources.length - 1]!,
  };
}

const env = (cursor: number, type = 'leaderboard.changed') => JSON.stringify({ cursor, type, at: 0, data: { at: 0 } });

describe('LiveConnection', () => {
  it('goes live on hello and dispatches stream events in order, once', async () => {
    const h = harness();
    const c = new LiveConnection(h.deps);
    const got: number[] = [];
    c.onEvent((e) => got.push(e.cursor));
    c.start();
    expect(c.status).toBe('connecting');
    h.latest().emit('hello', JSON.stringify({ cursor: 10 }));
    expect(c.status).toBe('live');
    h.latest().emit('message', env(11));
    h.latest().emit('message', env(11)); // duplicate
    h.latest().emit('message', env(12));
    expect(got).toEqual([11, 12]);
    c.stop();
  });

  it('falls back to polling when the stream errors, and polls from the cursor', async () => {
    const h = harness();
    const c = new LiveConnection(h.deps);
    const got: number[] = [];
    c.onEvent((e) => got.push(e.cursor));
    c.start();
    h.latest().emit('hello', JSON.stringify({ cursor: 50 }));
    h.setPoll({ cursor: 52, events: [JSON.parse(env(51)), JSON.parse(env(52))], reset: false });
    h.latest().onerror?.(new Event('error'));
    await h.advance(0);
    expect(c.status).toBe('polling');
    expect(h.sources[0]!.closed).toBe(true);
    expect(h.polls[0]).toBe(50);
    expect(got).toEqual([51, 52]);
    await h.advance(2000);
    expect(h.polls.at(-1)).toBe(52);
    c.stop();
  });

  it('treats 5 s of silence (no heartbeat) as a stall', async () => {
    const h = harness();
    const c = new LiveConnection(h.deps);
    c.start();
    h.latest().emit('hello', JSON.stringify({ cursor: 1 }));
    await h.advance(3000);
    h.latest().emit('hb', '1'); // heartbeat keeps it alive
    await h.advance(4500);
    expect(c.status).toBe('live');
    await h.advance(2000); // now > 5 s since the last frame
    expect(c.status).toBe('polling');
    c.stop();
  });

  it('keeps polling while it re-tries the stream, and stops polling on hello', async () => {
    const h = harness();
    const c = new LiveConnection(h.deps, { retrySseMs: 10_000 });
    c.start();
    h.latest().onerror?.(new Event('error'));
    await h.advance(9_000);
    const pollsBefore = h.polls.length;
    expect(pollsBefore).toBeGreaterThan(3);
    await h.advance(1_500); // retry fires: a new EventSource probes
    expect(h.sources).toHaveLength(2);
    expect(h.sources[1]!.url).toBe('/api/live?since=100');
    await h.advance(1_000);
    expect(h.polls.length).toBeGreaterThan(pollsBefore); // still polling meanwhile
    h.latest().emit('hello', JSON.stringify({ cursor: 100 }));
    expect(c.status).toBe('live');
    const n = h.polls.length;
    await h.advance(2_500);
    h.latest().emit('hb', '100');
    await h.advance(2_500);
    expect(h.polls.length).toBe(n); // polling stopped once the stream was back
    expect(c.status).toBe('live');
    c.stop();
  });

  it('reports offline when polls fail and refetch-resets when the server says so', async () => {
    const h = harness();
    const c = new LiveConnection(h.deps);
    let resets = 0;
    c.onReset(() => resets++);
    c.start();
    h.setPollFails(true);
    h.latest().onerror?.(new Event('error'));
    await h.advance(0);
    expect(c.status).toBe('offline');
    h.setPollFails(false);
    h.setPoll({ cursor: 999, events: [], reset: true });
    await h.advance(6000);
    expect(resets).toBe(1);
    expect(c.cursor).toBe(999);
    expect(c.status).toBe('polling');
    c.stop();
  });

  it('restart keeps the cursor so a new identity replays what it missed', async () => {
    const h = harness();
    const c = new LiveConnection(h.deps);
    c.start();
    h.latest().emit('hello', JSON.stringify({ cursor: 70 }));
    c.restart();
    expect(h.latest().url).toBe('/api/live?since=70');
    c.stop();
  });
});
