/*
  Attendance (spec 5.2): /checkin (code boxes, QR scan, deep link), a home card
  and banner when a check-in opens, the console panel and the projector code scene.
  Server side: server/src/features/attendance.
*/
import { lazy } from 'react';
import { defineFeature } from '../../core/feature';
import { CheckinCard, CheckinOverlay, CheckinPage } from './Attendee';
import { useCheckinSceneStatus } from './status';

export const attendance = defineFeature({
  name: 'attendance',
  routes: [{ path: 'checkin', Component: CheckinPage }],
  home: { order: 5, Card: CheckinCard },
  AttendeeOverlay: CheckinOverlay,
  console: { order: 20, label: 'check-in', path: 'attendance', icon: 'ticket', Panel: lazy(() => import('./Console')) },
  scenes: [{ id: 'attendance', label: 'check-in code', Component: lazy(() => import('./Scene')), useStatus: useCheckinSceneStatus, order: 5, durationMs: 25000 }],
});
