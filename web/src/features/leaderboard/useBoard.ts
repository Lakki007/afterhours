// The leaderboard query, refreshed by leaderboard.* live events.
import { type BoardResponse, BoardResponseSchema } from '@afterhours/shared/features/leaderboard';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../core/api';
import { useLiveEvent } from '../../core/live';

export const boardKey = (limit: number, peek = false) => ['leaderboard', 'board', limit, peek] as const;

export function useBoard(limit = 10, peek = false) {
  const qc = useQueryClient();
  const key = boardKey(limit, peek);
  const q = useQuery({ queryKey: key, queryFn: () => api.get(`/api/leaderboard?limit=${limit}${peek ? '&peek=1' : ''}`, BoardResponseSchema), refetchInterval: 30_000 });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['leaderboard', 'board'] });
  useLiveEvent('leaderboard.moves', refresh);
  useLiveEvent('leaderboard.rank', refresh);
  useLiveEvent('leaderboard.freeze', refresh);
  useLiveEvent('leaderboard.reveal', (step) => {
    // Uncover the place in place, so every screen flips in step with the server clock.
    qc.setQueryData<BoardResponse>(key, (old) => (old ? { ...old, rows: old.rows.map((r) => (r.rank === step.rank ? step.row : r)) } : old));
    if (step.done) refresh();
  });
  return q;
}
