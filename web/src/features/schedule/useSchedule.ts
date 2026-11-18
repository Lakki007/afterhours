/*
  Schedule state: one query, kept fresh by 'schedule.changed' (which carries the
  whole new state, so no refetch). The latest `change` is kept too, so cards can
  animate what happened ("started", "delayed"...) without diffing.
*/
import { type Activity, type ScheduleChange, type ScheduleState, ScheduleStateSchema } from '@afterhours/shared/features/schedule';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { api } from '../../core/api';
import { useLiveEvent } from '../../core/live';

export const scheduleKey = ['schedule'] as const;

let last: { seq: number; change: ScheduleChange } | null = null;
let seq = 0;
const subs = new Set<() => void>();

function useChangeFeed() {
  const qc = useQueryClient();
  useLiveEvent('schedule.changed', (d) => {
    const prev = qc.getQueryData<ScheduleState>(scheduleKey);
    // 'advanced' does not bump the version; organiser changes do. Never go backwards.
    if (!prev || d.state.version >= prev.version) qc.setQueryData(scheduleKey, d.state);
    last = { seq: ++seq, change: d.change };
    subs.forEach((f) => f());
  });
}

export function useSchedule() {
  useChangeFeed();
  return useQuery({
    queryKey: scheduleKey,
    queryFn: () => api.get('/api/schedule', ScheduleStateSchema),
    // The live stream does the work; this is a slow safety net.
    refetchInterval: 90_000,
    staleTime: 30_000,
  });
}

/** The most recent change seen on the live stream (null until one arrives). */
export function useLastChange(): { seq: number; change: ScheduleChange } | null {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => last,
  );
}

export function nowAndNext(state: ScheduleState | undefined): { now: Activity | null; next: Activity | null } {
  if (!state) return { now: null, next: null };
  const by = (id: number | null) => (id === null ? null : (state.activities.find((a) => a.id === id) ?? null));
  return { now: by(state.nowId), next: by(state.nextId) };
}

export const KIND_LABEL: Record<Activity['kind'], string> = {
  talk: 'talk',
  game: 'game',
  poll: 'poll',
  hunt: 'hunt',
  morse: 'morse',
  break: 'break',
  other: 'thing',
};

export const LINK_LABEL: Record<string, string> = {
  '/polls': 'vote now',
  '/hunt': 'start hunting',
  '/morse': 'grab the key',
  '/arcade': 'hit the arcade',
  '/leaderboard': 'see the board',
  '/checkin': 'check in',
  '/schedule': 'see the plan',
};
