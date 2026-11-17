// Web side of the polls feature. Stub: replace Soon with your screens (docs/EXTENDING.md).
// The base route /polls is fixed: the schedule feature deep-links to it.
import { defineFeature } from '../../core/feature';
import { EmptyState } from '../../kit';

function Soon() {
  return <EmptyState title="coming up" hint="this part of the app is still being built." />;
}

export const polls = defineFeature({
  name: 'polls',
  routes: [
    { path: 'polls', Component: Soon },
  ],
});
