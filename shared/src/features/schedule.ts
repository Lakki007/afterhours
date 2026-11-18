// Schedule / now and next (spec 5.1). The backbone: other features link to activities.
import { z } from 'zod';
import { ActivityKindSchema } from '../activity';

/**
 * Status as of the server's `serverNow`. Clients may recompute from startAt/endAt with their
 * server-time offset to tick the progress ring, but must treat `nowId`/`nextId` as authoritative.
 * - live: started by an organiser, or (when nobody has pressed start) its time window is open
 * - ended: pressed end, or (when nobody has pressed start) its end time passed
 * - upcoming: everything else
 */
export const ActivityStatusSchema = z.enum(['upcoming', 'live', 'ended']);
export type ActivityStatus = z.infer<typeof ActivityStatusSchema>;

/** In-app path of the feature that goes with an activity, e.g. "/polls". */
export const ActivityLinkSchema = z
  .string()
  .regex(/^\/[a-z0-9/_-]{0,58}$/, 'Link must be an in-app path like /polls')
  .nullable();

export const ActivitySchema = z.object({
  id: z.number().int(),
  title: z.string(),
  blurb: z.string(),
  location: z.string(),
  kind: ActivityKindSchema,
  highlight: z.boolean(),
  link: ActivityLinkSchema,
  /** Epoch ms. Current plan: moves when delayed or started. */
  startAt: z.number().int(),
  endAt: z.number().int(),
  /** Where startAt was before delays and early/late starts. delayMs = startAt - plannedStartAt. */
  plannedStartAt: z.number().int(),
  delayMs: z.number().int(),
  status: ActivityStatusSchema,
  /** When an organiser actually pressed start / end. */
  actualStartAt: z.number().int().nullable(),
  actualEndAt: z.number().int().nullable(),
});
export type Activity = z.infer<typeof ActivitySchema>;

/** GET /api/schedule: the whole "current state", small enough for 300 phones to fetch on reconnect. */
export const ScheduleStateSchema = z.object({
  /** Server clock, epoch ms. Clients compute offset = serverNow - (their now at response). */
  serverNow: z.number().int(),
  /** Bumps on every organiser change (not on time passing). Persisted, so it never goes backwards. */
  version: z.number().int(),
  nowId: z.number().int().nullable(),
  nextId: z.number().int().nullable(),
  /** Timeline order (by startAt, then id). */
  activities: z.array(ActivitySchema),
});
export type ScheduleState = z.infer<typeof ScheduleStateSchema>;

// ---- organiser input ---------------------------------------------------------

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    // eslint-disable-next-line no-control-regex
    .refine((s) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s), 'No control characters');
const MAX_ACTIVITY_MS = 12 * 3_600_000;
const epoch = z.number().int().min(1_500_000_000_000).max(4_000_000_000_000);

export const ActivityInputSchema = z
  .object({
    title: text(80).min(1),
    blurb: text(280).default(''),
    location: text(60).default(''),
    kind: ActivityKindSchema.default('other'),
    highlight: z.boolean().default(false),
    link: ActivityLinkSchema.default(null),
    startAt: epoch,
    endAt: epoch,
  })
  .refine((a) => a.endAt > a.startAt, { message: 'It has to end after it starts.', path: ['endAt'] })
  .refine((a) => a.endAt - a.startAt <= MAX_ACTIVITY_MS, { message: 'That is over 12 hours long.', path: ['endAt'] });
/** POST /api/schedule (console) */
export type ActivityInput = z.input<typeof ActivityInputSchema>;

/** PATCH /api/schedule/:id (console). Only the fields sent change. */
export const ActivityPatchSchema = z
  .object({
    title: text(80).min(1),
    blurb: text(280),
    location: text(60),
    kind: ActivityKindSchema,
    highlight: z.boolean(),
    link: ActivityLinkSchema,
    startAt: epoch,
    endAt: epoch,
  })
  .partial()
  .strict()
  .refine((p) => Object.keys(p).length > 0, 'Nothing to change.');
export type ActivityPatch = z.infer<typeof ActivityPatchSchema>;

export const DELAY_MINUTES = [5, 10, 15] as const;
/** POST /api/schedule/:id/delay */
export const DelayRequestSchema = z.object({ minutes: z.union([z.literal(5), z.literal(10), z.literal(15)]) });
export type DelayRequest = z.infer<typeof DelayRequestSchema>;

/** POST /api/schedule/:id/highlight */
export const HighlightRequestSchema = z.object({ highlight: z.boolean() });

/** POST /api/schedule/reorder: every upcoming activity's id, in the new order. */
export const ReorderRequestSchema = z.object({ order: z.array(z.number().int()).min(1).max(100) });
export type ReorderRequest = z.infer<typeof ReorderRequestSchema>;

/** POST /api/schedule/reset (console danger zone) */
export const ResetScheduleRequestSchema = z.object({
  confirm: z.literal('reset schedule'),
  /** Load the demo afternoon again instead of leaving it empty. */
  reseed: z.boolean().default(false),
});

// ---- live event ----------------------------------------------------------------

/** What just happened, so a phone can animate it without diffing. */
export const ScheduleChangeSchema = z.discriminatedUnion('kind', [
  /** An organiser started an activity; `endedIds` were running and are now over; `shiftedIds` were pushed later. */
  z.object({ kind: z.literal('started'), activityId: z.number().int(), endedIds: z.array(z.number().int()), shiftedIds: z.array(z.number().int()) }),
  z.object({ kind: z.literal('ended'), activityId: z.number().int() }),
  /** `shiftedIds` are later activities pushed along to avoid overlap. */
  z.object({ kind: z.literal('delayed'), activityId: z.number().int(), minutes: z.number().int(), shiftedIds: z.array(z.number().int()) }),
  z.object({ kind: z.literal('reordered'), order: z.array(z.number().int()) }),
  z.object({ kind: z.literal('edited'), activityId: z.number().int() }),
  z.object({ kind: z.literal('created'), activityId: z.number().int() }),
  z.object({ kind: z.literal('deleted'), activityId: z.number().int() }),
  z.object({ kind: z.literal('highlighted'), activityId: z.number().int(), highlight: z.boolean() }),
  z.object({ kind: z.literal('reset') }),
  /** Time alone moved things: an activity went live on schedule, or ran out. No organiser involved. */
  z.object({ kind: z.literal('advanced'), previousNowId: z.number().int().nullable(), nowId: z.number().int().nullable() }),
]);
export type ScheduleChange = z.infer<typeof ScheduleChangeSchema>;

export const ScheduleChangedSchema = z.object({ change: ScheduleChangeSchema, state: ScheduleStateSchema });
export type ScheduleChanged = z.infer<typeof ScheduleChangedSchema>;

declare module '../live' {
  interface LiveEvents {
    /**
     * To everyone (phones, projector, console), within a tick of any change. Carries the full new
     * state, so no refetch is needed; `change` says what to animate. Fires on every organiser
     * action and when time alone moves "now" (change.kind === 'advanced').
     */
    'schedule.changed': ScheduleChanged;
  }
}
