/*
  Schedule (spec 5.1): home "now and next" card (top of home), the /schedule
  timeline, the console run of show and the projector's default now/next scene.
  Server side: server/src/features/schedule.
*/
import { lazy } from 'react';
import { defineFeature } from '../../core/feature';
import { NowNextCard } from './NowNext';
import { Timeline } from './Timeline';

export const schedule = defineFeature({
  name: 'schedule',
  // Order < 10 renders above the points ticket: now/next is the top of home.
  home: { order: 0, Card: NowNextCard },
  routes: [{ path: 'schedule', Component: Timeline }],
  nav: { order: 10, label: 'plan', to: '/schedule', icon: 'clock' },
  console: { order: 10, label: 'run of show', path: 'schedule', icon: 'clock', Panel: lazy(() => import('./Console')) },
  scenes: [{ id: 'schedule', label: 'now and next', Component: lazy(() => import('./Scene')), order: 10, durationMs: 20000 }],
});
