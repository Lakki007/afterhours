// Web side of the hunt feature. Stub: replace Soon with your screens (docs/EXTENDING.md).
// The base route /hunt is fixed: the schedule feature deep-links to it.
import { defineFeature } from '../../core/feature';
import { EmptyState } from '../../kit';

function Soon() {
  return <EmptyState title="coming up" hint="this part of the app is still being built." />;
}

export const hunt = defineFeature({
  name: 'hunt',
  routes: [
    { path: 'hunt', Component: Soon },
    { path: 'hunt/s/:token', Component: Soon },
  ],
});
