/*
  Arcade (spec 5.7): /arcade hub, /arcade/:game, a home card, the NEW #1 toast,
  the console and the projector scoreboards.
  Server side: server/src/features/arcade.
*/
import { lazy } from 'react';
import { defineFeature } from '../../core/feature';
import { ArcadeGame, ArcadeHomeCard, ArcadeHub, RecordToast } from './Attendee';

export const arcade = defineFeature({
  name: 'arcade',
  routes: [
    { path: 'arcade', Component: ArcadeHub },
    { path: 'arcade/:game', Component: ArcadeGame },
  ],
  home: { order: 50, Card: ArcadeHomeCard },
  AttendeeOverlay: RecordToast,
  console: { order: 60, label: 'arcade', path: 'arcade', icon: 'gamepad', Panel: lazy(() => import('./Console')) },
  scenes: [{ id: 'arcade', label: 'arcade scores', Component: lazy(() => import('./Scene')), order: 60, durationMs: 15000 }],
});
