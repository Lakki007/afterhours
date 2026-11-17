// Web side of the arcade feature. Stub: replace Soon with your screens (docs/EXTENDING.md).
// The base route /arcade is fixed: the schedule feature deep-links to it.
import { defineFeature } from '../../core/feature';
import { EmptyState } from '../../kit';

function Soon() {
  return <EmptyState title="coming up" hint="this part of the app is still being built." />;
}

export const arcade = defineFeature({
  name: 'arcade',
  routes: [
    { path: 'arcade', Component: Soon },
  ],
});
