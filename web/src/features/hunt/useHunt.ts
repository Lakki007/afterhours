// Hunt state on the phone (GET /api/hunt) kept fresh by hunt.* live events, plus the shared board.
import { type HuntBoard, HuntBoardSchema, type HuntMe, HuntMeSchema } from '@afterhours/shared/features/hunt';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../core/api';
import { useLiveEvent } from '../../core/live';

export const huntKey = ['hunt', 'me'] as const;
export const boardKey = ['hunt', 'board'] as const;

export function useHunt() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: huntKey, queryFn: () => api.get('/api/hunt', HuntMeSchema), refetchInterval: 45_000 });
  useLiveEvent('hunt.state', () => void qc.invalidateQueries({ queryKey: huntKey }));
  useLiveEvent('hunt.crowd', (crowd) => qc.setQueryData<HuntMe>(huntKey, (old) => (old ? { ...old, crowd } : old)));
  return q;
}

export function useSetHunt() {
  const qc = useQueryClient();
  return (me: HuntMe) => qc.setQueryData(huntKey, me);
}

export function useHuntBoard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: boardKey, queryFn: () => api.get('/api/hunt/board', HuntBoardSchema), refetchInterval: 30_000 });
  useLiveEvent('hunt.finished', () => void qc.invalidateQueries({ queryKey: boardKey }));
  useLiveEvent('hunt.state', () => void qc.invalidateQueries({ queryKey: boardKey }));
  useLiveEvent('hunt.crowd', (crowd) => qc.setQueryData<HuntBoard>(boardKey, (old) => (old ? { ...old, crowd } : old)));
  return q;
}
