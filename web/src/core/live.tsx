/*
  useLive(): the one live layer for features.

    // subscribe to a typed event (payload type comes from shared LiveEvents)
    useLiveEvent('reactions.burst', (data) => float(data.counts));

    // or imperatively
    const { status, on } = useLive();
    useEffect(() => on('points.awarded', (d) => ...), [on]);

  One connection per page. Each surface mounts <LiveProvider identity=…>;
  when the identity changes (sign-in, sign-out) the stream reconnects with
  the last cursor, so events published in between are replayed.
*/
import { type LiveEnvelope, type LiveEventType, type LiveEvents, LivePollResponseSchema } from '@afterhours/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { LiveConnection, type LiveStatus } from './liveConnection';

let singleton: LiveConnection | null = null;

export function getLiveConnection(): LiveConnection {
  singleton ??= new LiveConnection({
    createEventSource: (url) => new EventSource(url, { withCredentials: true }),
    poll: (since) => api.get(since === null ? '/api/live/poll' : `/api/live/poll?since=${since}`, LivePollResponseSchema),
    now: () => Date.now(),
    setInterval: (fn, ms) => window.setInterval(fn, ms),
    clearInterval: (id) => window.clearInterval(id as number),
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (id) => window.clearTimeout(id as number),
  });
  return singleton;
}

type On = <K extends LiveEventType>(type: K, fn: (data: LiveEvents[K], env: LiveEnvelope<K>) => void) => () => void;

interface LiveContextValue {
  status: LiveStatus;
  on: On;
}

const LiveContext = createContext<LiveContextValue | null>(null);

export function LiveProvider({ identity, children }: { identity: string; children: ReactNode }) {
  const conn = getLiveConnection();
  const qc = useQueryClient();
  const [status, setStatus] = useState<LiveStatus>(conn.status);
  const first = useRef(true);

  useEffect(() => {
    const offStatus = conn.onStatus((s) => {
      setStatus(s);
      document.documentElement.dataset.live = s;
    });
    document.documentElement.dataset.live = conn.status;
    // Missed events (buffer overflow / server restart): refetch every query.
    const offReset = conn.onReset(() => void qc.invalidateQueries());
    const online = () => conn.nudge();
    window.addEventListener('online', online);
    conn.start();
    return () => {
      offStatus();
      offReset();
      window.removeEventListener('online', online);
    };
  }, [conn, qc]);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    conn.restart();
  }, [identity, conn]);

  const on = useCallback<On>(
    (type, fn) =>
      conn.onEvent((env) => {
        if (env.type === type) fn(env.data as LiveEvents[typeof type], env as LiveEnvelope<typeof type>);
      }),
    [conn],
  );

  const value = useMemo(() => ({ status, on }), [status, on]);
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveContextValue {
  const v = useContext(LiveContext);
  if (!v) throw new Error('useLive() needs a <LiveProvider> above it');
  return v;
}

/** Subscribe to one live event type for the lifetime of the component. */
export function useLiveEvent<K extends LiveEventType>(type: K, handler: (data: LiveEvents[K], env: LiveEnvelope<K>) => void): void {
  const { on } = useLive();
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => on(type, (d, e) => ref.current(d, e)), [on, type]);
}
