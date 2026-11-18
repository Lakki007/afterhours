// Projector poll state + scene status (eager: the scene host probes it).
import { ScreenPollStateSchema } from '@afterhours/shared/features/polls';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../core/api';
import type { SceneStatus } from '../../core/feature';
import { useServerNow } from '../../core/clock';
import { useLiveEvent } from '../../core/live';

export const screenPollKey = ['polls', 'screen'] as const;

export function useScreenPoll() {
  const q = useQuery({ queryKey: screenPollKey, queryFn: () => api.get('/api/polls/screen', ScreenPollStateSchema), refetchInterval: 20_000 });
  useLiveEvent('polls.launched', () => void q.refetch());
  useLiveEvent('polls.closed', () => void q.refetch());
  useLiveEvent('polls.revealed', () => void q.refetch());
  useLiveEvent('polls.results', () => void q.refetch());
  return q;
}

/** Takes over while a poll is live and for 40 s after a reveal; otherwise sits in the rotation if there is one. */
export function usePollSceneStatus(): SceneStatus {
  const q = useScreenPoll();
  const now = useServerNow(5000);
  const p = q.data?.poll;
  if (!p) return 'off';
  if (p.status === 'live') return 'takeover';
  if (p.status === 'revealed' && p.revealedAt && now - p.revealedAt < 40_000) return 'takeover';
  return 'available';
}
