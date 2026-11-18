/*
  Treasure hunt (spec 5.5): /hunt passport + clue, /hunt/s/:token sticker landing,
  a home card, the console and the projector map.
  Server side: server/src/features/hunt.
*/
import { lazy } from 'react';
import type { SceneStatus } from '../../core/feature';
import { defineFeature } from '../../core/feature';
import { HuntHomeCard, HuntScanLanding, TrailPage, TrailsPage } from './Attendee';
import { useHuntBoard } from './useHunt';

function useHuntSceneStatus(): SceneStatus {
  const b = useHuntBoard();
  return b.data?.status === 'open' || (b.data?.finishers.length ?? 0) > 0 ? 'available' : 'off';
}

export const hunt = defineFeature({
  name: 'hunt',
  routes: [
    { path: 'hunt', Component: TrailsPage },
    { path: 'hunt/t/:trailId', Component: TrailPage },
    { path: 'hunt/s/:token', Component: HuntScanLanding },
  ],
  home: { order: 30, Card: HuntHomeCard },
  nav: { order: 20, label: 'trails', to: '/hunt', icon: 'map' },
  console: { order: 40, label: 'hunt', path: 'hunt', icon: 'map', Panel: lazy(() => import('./Console')) },
  scenes: [{ id: 'hunt', label: 'hunt map', Component: lazy(() => import('./Scene')), useStatus: useHuntSceneStatus, order: 30, durationMs: 15000 }],
});
