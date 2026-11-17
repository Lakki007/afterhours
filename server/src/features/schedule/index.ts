// Run of show / now and next (spec 5.1). Rules live in service.ts; routes are thin.
import {
  ActivityInputSchema,
  ActivityPatchSchema,
  DelayRequestSchema,
  HighlightRequestSchema,
  ReorderRequestSchema,
  ResetScheduleRequestSchema,
  type ScheduleState,
} from '@afterhours/shared/features/schedule';
import { z } from 'zod';
import {
  RateLimiter,
  defineFeature,
  getAttendee,
  isAdmin,
  isScreen,
  parse,
  requireAdmin,
  unauthorized,
} from '../../core';
import { insertDemo } from './seed';
import {
  advance,
  buildState,
  createActivity,
  deleteActivity,
  delay,
  editActivity,
  invalidate,
  endNow,
  reorder,
  resetSchedule,
  setHighlight,
  startNow,
} from './service';

const IdSchema = z.object({ id: z.coerce.number().int().positive() });

export const schedule = defineFeature({
  name: 'schedule',

  routes(app, ctx) {
    // Reconnect storms: 300 phones refetch at once, but one phone should not hammer.
    const readLimiter = new RateLimiter({ limit: 20, windowMs: 10_000, now: ctx.now });
    // Console fat-fingering / scripts with a stolen PIN.
    const writeLimiter = new RateLimiter({ limit: 60, windowMs: 60_000, now: ctx.now });
    const admin = (req: Parameters<typeof requireAdmin>[0]): void => {
      requireAdmin(req);
      writeLimiter.enforce('admin', 'Whoa, slow down on the console.');
    };

    // GET /api/schedule: attendee, projector or console. Cheap: served from an in-memory row cache.
    app.get('/', async (req): Promise<ScheduleState> => {
      const me = getAttendee(req);
      if (!me && !isScreen(req) && !isAdmin(req)) throw unauthorized();
      readLimiter.enforce(me ? `a:${me.attendeeId}` : `ip:${req.ip}`);
      return buildState(ctx);
    });

    // POST /api/schedule  (console) create
    app.post('/', async (req): Promise<ScheduleState> => {
      admin(req);
      return createActivity(ctx, parse(ActivityInputSchema, req.body)).state;
    });

    // POST /api/schedule/reorder (console)
    app.post('/reorder', async (req): Promise<ScheduleState> => {
      admin(req);
      return reorder(ctx, parse(ReorderRequestSchema, req.body).order);
    });

    // POST /api/schedule/reset (console danger zone)
    app.post('/reset', async (req): Promise<ScheduleState> => {
      admin(req);
      const { reseed } = parse(ResetScheduleRequestSchema, req.body);
      return resetSchedule(ctx, reseed, (c) => void insertDemo(c, true));
    });

    app.patch('/:id', async (req): Promise<ScheduleState> => {
      admin(req);
      return editActivity(ctx, parse(IdSchema, req.params).id, parse(ActivityPatchSchema, req.body));
    });

    app.delete('/:id', async (req): Promise<ScheduleState> => {
      admin(req);
      return deleteActivity(ctx, parse(IdSchema, req.params).id);
    });

    app.post('/:id/start', async (req): Promise<ScheduleState> => {
      admin(req);
      return startNow(ctx, parse(IdSchema, req.params).id);
    });

    app.post('/:id/end', async (req): Promise<ScheduleState> => {
      admin(req);
      return endNow(ctx, parse(IdSchema, req.params).id);
    });

    app.post('/:id/delay', async (req): Promise<ScheduleState> => {
      admin(req);
      return delay(ctx, parse(IdSchema, req.params).id, parse(DelayRequestSchema, req.body).minutes);
    });

    app.post('/:id/highlight', async (req): Promise<ScheduleState> => {
      admin(req);
      return setHighlight(ctx, parse(IdSchema, req.params).id, parse(HighlightRequestSchema, req.body).highlight);
    });
  },

  boot: advance,

  // Once a second: if time alone changed what is now/next, tell everyone. Cheap (cached rows).
  tick: { everyMs: 1000, run: advance },

  seed(ctx) {
    insertDemo(ctx);
    invalidate(ctx);
  },
});
