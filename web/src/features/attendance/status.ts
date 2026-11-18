// Projector data + scene status for check-in (eager: the scene host probes it on every rotation).
import { ScreenCheckinsSchema } from '@afterhours/shared/features/attendance';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../core/api';
import { serverNow, useServerNow } from '../../core/clock';
import { useLiveEvent } from '../../core/live';
import type { SceneStatus } from '../../core/feature';

export const screenKey = ['attendance', 'screen'] as const;

export function useScreenCheckins() {
  const q = useQuery({ queryKey: screenKey, queryFn: () => api.get('/api/attendance/screen', ScreenCheckinsSchema), refetchInterval: 15_000 });
  useLiveEvent('attendance.code', () => void q.refetch());
  useLiveEvent('attendance.state', () => void q.refetch());
  useLiveEvent('attendance.counts', () => void q.refetch());
  return q;
}

const TAKEOVER_MS = 90_000;
const firstSeen = new Map<string, number>();

/** Takes over for the first 90 s after a check-in opens, then rotates normally while open. */
export function useCheckinSceneStatus(): SceneStatus {
  const q = useScreenCheckins();
  const now = useServerNow(5000);
  const open = q.data?.open ?? [];
  if (open.length === 0) return 'off';
  for (const o of open) if (!firstSeen.has(o.activityId)) firstSeen.set(o.activityId, serverNow());
  return open.some((o) => now - (firstSeen.get(o.activityId) ?? 0) < TAKEOVER_MS) ? 'takeover' : 'available';
}
