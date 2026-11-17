/*
  The one live connection. SSE first; if the stream errors or goes quiet for
  LIVE_STALL_MS (5 s, spec 3) it falls back to polling /api/live/poll every
  LIVE_POLL_MS, and keeps quietly re-trying SSE in the background, switching
  back the moment a stream says hello. Events are de-duplicated by cursor, so
  overlap between poll and stream is harmless.

  Framework-free so it can be unit tested with fakes (liveConnection.test.ts).
*/
import { LIVE_POLL_MS, LIVE_STALL_MS, type LiveEnvelope, type LivePollResponse, SSE_HEARTBEAT, SSE_HELLO } from '@afterhours/shared';

export type LiveStatus = 'connecting' | 'live' | 'polling' | 'offline';

interface EventSourceLike {
  addEventListener(type: string, fn: (e: MessageEvent<string>) => void): void;
  onerror: ((e: Event) => void) | null;
  close(): void;
}

export interface LiveDeps {
  createEventSource: (url: string) => EventSourceLike;
  poll: (since: number | null) => Promise<LivePollResponse>;
  now: () => number;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (id: unknown) => void;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
}

export interface LiveOptions {
  stallMs?: number;
  pollMs?: number;
  /** While polling, how often to try the stream again. */
  retrySseMs?: number;
}

type Handler = (env: LiveEnvelope) => void;

export class LiveConnection {
  cursor: number | null = null;
  status: LiveStatus = 'connecting';
  private es: EventSourceLike | null = null;
  private esHealthy = false;
  private lastActivity = 0;
  private watchdog: unknown = null;
  private pollTimer: unknown = null;
  private retryTimer: unknown = null;
  private polling = false;
  private running = false;
  private readonly handlers = new Set<Handler>();
  private readonly statusListeners = new Set<(s: LiveStatus) => void>();
  private readonly resetListeners = new Set<() => void>();
  private readonly stallMs: number;
  private readonly pollMs: number;
  private readonly retrySseMs: number;

  constructor(
    private readonly deps: LiveDeps,
    opts: LiveOptions = {},
  ) {
    this.stallMs = opts.stallMs ?? LIVE_STALL_MS;
    this.pollMs = opts.pollMs ?? LIVE_POLL_MS;
    this.retrySseMs = opts.retrySseMs ?? 20_000;
  }

  onEvent(fn: Handler): () => void {
    this.handlers.add(fn);
    return () => this.handlers.delete(fn);
  }
  onStatus(fn: (s: LiveStatus) => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }
  /** Fired when the server cannot prove we missed nothing: refetch everything. */
  onReset(fn: () => void): () => void {
    this.resetListeners.add(fn);
    return () => this.resetListeners.delete(fn);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.openStream();
    this.watchdog = this.deps.setInterval(() => this.checkStall(), 1000);
  }

  stop(): void {
    this.running = false;
    this.closeStream();
    this.stopPolling();
    if (this.watchdog) this.deps.clearInterval(this.watchdog);
    if (this.retryTimer) this.deps.clearTimeout(this.retryTimer);
    this.watchdog = null;
    this.retryTimer = null;
  }

  /** Reconnect with a new identity (cookies changed); keeps the cursor so nothing is missed. */
  restart(): void {
    this.stop();
    this.setStatus('connecting');
    this.start();
  }

  /** Network came back: try the stream right away. */
  nudge(): void {
    if (this.running && !this.esHealthy) this.openStream();
  }

  private setStatus(s: LiveStatus) {
    if (this.status === s) return;
    this.status = s;
    for (const l of this.statusListeners) l(s);
  }

  private touch() {
    this.lastActivity = this.deps.now();
  }

  private dispatch(env: LiveEnvelope) {
    if (this.cursor !== null && env.cursor <= this.cursor) return; // already seen
    this.cursor = env.cursor;
    for (const h of this.handlers) {
      try {
        h(env);
      } catch (err) {
        console.error('live handler failed', env.type, err);
      }
    }
  }

  private reset(cursor: number) {
    this.cursor = cursor;
    for (const l of this.resetListeners) l();
  }

  private openStream() {
    this.closeStream();
    const url = this.cursor !== null ? `/api/live?since=${this.cursor}` : '/api/live';
    let es: EventSourceLike;
    try {
      es = this.deps.createEventSource(url);
    } catch {
      this.fallBack();
      return;
    }
    this.es = es;
    this.esHealthy = false;
    this.touch();
    es.addEventListener(SSE_HELLO, (e) => {
      if (this.es !== es) return;
      try {
        const { cursor } = JSON.parse(e.data) as { cursor: number };
        if (this.cursor === null || cursor > this.cursor) this.cursor = cursor;
      } catch {
        /* ignore */
      }
      this.esHealthy = true;
      this.touch();
      this.stopPolling();
      this.setStatus('live');
    });
    es.addEventListener(SSE_HEARTBEAT, () => {
      if (this.es === es) this.touch();
    });
    es.addEventListener('reset', (e) => {
      if (this.es !== es) return;
      this.touch();
      this.reset(Number(e.data));
    });
    es.addEventListener('message', (e) => {
      if (this.es !== es) return;
      this.touch();
      try {
        this.dispatch(JSON.parse(e.data) as LiveEnvelope);
      } catch {
        /* ignore malformed frame */
      }
    });
    es.onerror = () => {
      if (this.es !== es) return;
      this.fallBack();
    };
  }

  private closeStream() {
    if (this.es) {
      this.es.onerror = null;
      this.es.close();
    }
    this.es = null;
    this.esHealthy = false;
  }

  private checkStall() {
    if (!this.running || !this.es) return;
    if (this.deps.now() - this.lastActivity > this.stallMs) this.fallBack();
  }

  /** Stream failed or stalled: poll now, and try the stream again later. */
  private fallBack() {
    this.closeStream();
    if (!this.running) return;
    if (this.status !== 'offline') this.setStatus('polling');
    this.startPolling();
    if (this.retryTimer) this.deps.clearTimeout(this.retryTimer);
    this.retryTimer = this.deps.setTimeout(() => {
      this.retryTimer = null;
      // Keep polling while the probe connects; hello stops the polling.
      if (this.running && this.polling) this.openStream();
    }, this.retrySseMs);
  }

  private startPolling() {
    if (this.polling) return;
    this.polling = true;
    const loop = async () => {
      if (!this.polling) return;
      let delay = this.pollMs;
      try {
        const r = await this.deps.poll(this.cursor);
        if (!this.polling) return;
        if (r.reset) this.reset(r.cursor);
        else {
          for (const env of r.events) this.dispatch(env as LiveEnvelope);
          if (this.cursor === null || r.cursor > this.cursor) this.cursor = r.cursor;
        }
        if (!this.esHealthy) this.setStatus('polling');
      } catch {
        this.setStatus('offline');
        delay = Math.min(this.pollMs * 2.5, 5000);
      }
      if (this.polling) this.pollTimer = this.deps.setTimeout(() => void loop(), delay);
    };
    void loop();
  }

  private stopPolling() {
    this.polling = false;
    if (this.pollTimer) this.deps.clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }
}
