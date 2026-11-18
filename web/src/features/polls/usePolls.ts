/*
  Poll state on the phone: the current poll (live, else the latest finished one),
  kept fresh by the polls.* live events. Results are only ever shown once the
  server has sent them to us (after voting, or at reveal).
*/
import { type CurrentPollResponse, CurrentPollResponseSchema, PollHistoryResponseSchema, type PollView } from '@afterhours/shared/features/polls';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../core/api';
import { useLiveEvent } from '../../core/live';

export const currentKey = ['polls', 'current'] as const;
export const historyKey = ['polls', 'history'] as const;

export function usePatchCurrent() {
  const qc = useQueryClient();
  return (fn: (v: PollView) => PollView) =>
    qc.setQueryData<CurrentPollResponse>(currentKey, (old) => (old?.view ? { ...old, view: fn(old.view) } : old));
}

export function useCurrentPoll() {
  const qc = useQueryClient();
  const patch = usePatchCurrent();
  const q = useQuery({ queryKey: currentKey, queryFn: () => api.get('/api/polls/current', CurrentPollResponseSchema), refetchInterval: 60_000 });
  useLiveEvent('polls.launched', () => void qc.invalidateQueries({ queryKey: currentKey }));
  useLiveEvent('polls.closed', () => {
    void qc.invalidateQueries({ queryKey: currentKey });
    void qc.invalidateQueries({ queryKey: historyKey });
  });
  useLiveEvent('polls.revealed', () => {
    void qc.invalidateQueries({ queryKey: currentKey });
    void qc.invalidateQueries({ queryKey: historyKey });
  });
  useLiveEvent('polls.results', (d) =>
    patch((v) => (v.poll.id !== d.pollId ? v : { ...v, voters: d.voters, results: v.results ? d.results : v.results })),
  );
  return q;
}

export function usePollHistory() {
  return useQuery({ queryKey: historyKey, queryFn: () => api.get('/api/polls/history', PollHistoryResponseSchema), staleTime: 30_000 });
}
