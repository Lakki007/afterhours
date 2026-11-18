/*
  Morse challenge (spec 5.6): /morse (ladder, decode, encode, practice, speed
  round), a home card, the console and the projector scene.
  Server side: server/src/features/morse.
*/
import { MorseOverviewSchema } from '@afterhours/shared/features/morse';
import { useQuery } from '@tanstack/react-query';
import { lazy } from 'react';
import { api } from '../../core/api';
import type { SceneStatus } from '../../core/feature';
import { defineFeature } from '../../core/feature';
import { useLiveEvent } from '../../core/live';
import { MorseHomeCard, MorsePage } from './Attendee';

function useMorseSceneStatus(): SceneStatus {
  const q = useQuery({ queryKey: ['morse', 'screen'], queryFn: () => api.get('/api/morse/screen', MorseOverviewSchema), refetchInterval: 10_000 });
  useLiveEvent('morse.state', () => void q.refetch());
  if (!q.data?.enabled) return 'off';
  return q.data.sprint ? 'takeover' : 'available';
}

export const morse = defineFeature({
  name: 'morse',
  routes: [{ path: 'morse', Component: MorsePage }],
  home: { order: 40, Card: MorseHomeCard },
  console: { order: 50, label: 'morse', path: 'morse', icon: 'morse', Panel: lazy(() => import('./Console')) },
  scenes: [{ id: 'morse', label: 'morse ladder', Component: lazy(() => import('./Scene')), useStatus: useMorseSceneStatus, order: 50, durationMs: 15000 }],
});
