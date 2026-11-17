// Web side of the morse feature. Stub: replace Soon with your screens (docs/EXTENDING.md).
// The base route /morse is fixed: the schedule feature deep-links to it.
import { defineFeature } from '../../core/feature';
import { EmptyState } from '../../kit';

function Soon() {
  return <EmptyState title="coming up" hint="this part of the app is still being built." />;
}

export const morse = defineFeature({
  name: 'morse',
  routes: [
    { path: 'morse', Component: Soon },
  ],
});
