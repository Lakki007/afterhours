/*
  Polls + quiz (spec 5.4): the takeover overlay (collapsible to a pill), /polls,
  a home card, the console and the projector takeover scene.
  Server side: server/src/features/polls.
*/
import { lazy } from 'react';
import { defineFeature } from '../../core/feature';
import { PollHomeCard, PollOverlay, PollsPage } from './Attendee';
import { usePollSceneStatus } from './status';

export const polls = defineFeature({
  name: 'polls',
  routes: [{ path: 'polls', Component: PollsPage }],
  home: { order: 20, Card: PollHomeCard },
  AttendeeOverlay: PollOverlay,
  console: { order: 30, label: 'polls', path: 'polls', icon: 'bars', Panel: lazy(() => import('./Console')) },
  scenes: [{ id: 'polls', label: 'live poll', Component: lazy(() => import('./Scene')), useStatus: usePollSceneStatus, order: 20, durationMs: 20000 }],
});
