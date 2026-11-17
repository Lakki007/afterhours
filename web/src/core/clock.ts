/*
  Server clock. The phone's clock is never trusted (spec 5.1): we sample
  GET /api/time a few times, keep the sample with the lowest round trip, and
  expose serverNow() = Date.now() + offset.
*/
import { TimeResponseSchema } from '@afterhours/shared';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { api } from './api';

let offset = 0;
let synced = false;
let rtt = Infinity;
const listeners = new Set<() => void>();

/** Server time in epoch ms. */
export function serverNow(): number {
  return Date.now() + offset;
}

export function clockOffset(): { offset: number; rtt: number; synced: boolean } {
  return { offset, rtt, synced };
}

export async function syncClock(samples = 4): Promise<void> {
  let best: { offset: number; rtt: number } | null = null;
  for (let i = 0; i < samples; i++) {
    try {
      const t0 = Date.now();
      const { now } = await api.get('/api/time', TimeResponseSchema);
      const t1 = Date.now();
      const r = t1 - t0;
      const o = now - (t0 + t1) / 2;
      if (!best || r < best.rtt) best = { offset: o, rtt: r };
    } catch {
      /* offline: keep the previous offset */
    }
  }
  if (best) {
    offset = best.offset;
    rtt = best.rtt;
    synced = true;
    for (const l of listeners) l();
  }
}

let started = false;
/** Called once by the app shell. Re-syncs every 5 minutes and when the tab comes back. */
export function startClockSync(): void {
  if (started) return;
  started = true;
  void syncClock();
  setInterval(() => void syncClock(2), 5 * 60_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncClock(2);
  });
}

/** { offset, rtt, synced }, re-rendering when a new sync lands. */
export function useClockOffset() {
  const o = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => offset,
  );
  return { offset: o, rtt, synced };
}

/** Server time that ticks every `everyMs`. For countdowns and progress rings. */
export function useServerNow(everyMs = 1000): number {
  const [now, setNow] = useState(serverNow);
  useClockOffset();
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}
