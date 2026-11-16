import { defineFeature } from '../../core';

// Web Push schedule + announcements (spec 5.3). Use ctx.push.sendPush; keep sends idempotent in your own table.
// Stub: registered so the owner only edits this folder. See docs/EXTENDING.md
// and ../reactions for a complete example.
export const alerts = defineFeature({
  name: 'alerts',
});
