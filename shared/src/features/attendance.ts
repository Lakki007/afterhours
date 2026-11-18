// Per-activity check-in (spec 5.2). Event attendance itself is core's first sign-in.
import { z } from 'zod';

/** Activities belong to the schedule feature; we hold their id as a string ("12"). The server checks it exists. */
export const ActivityIdSchema = z.string().trim().min(1).max(64);

/** Code characters: no 0/O, 1/I/L, 5/S, B/8 confusion. 4 chars, case-insensitive on input. */
export const CHECKIN_CODE_ALPHABET = 'ACDEFGHJKMNPQRTUVWXY2346789';
export const CHECKIN_CODE_LENGTH = 4;
/** The code rotates every 30 s; the server accepts the current and the previous window. */
export const CHECKIN_WINDOW_MS = 30_000;
export const CheckinCodeSchema = z
  .string()
  .transform((s) => s.replace(/[\s-]/g, '').toUpperCase())
  .pipe(
    z
      .string()
      .length(CHECKIN_CODE_LENGTH, 'The code is 4 characters.')
      .regex(new RegExp(`^[${CHECKIN_CODE_ALPHABET}]+$`), 'That code has a character we never use.'),
  );

export const CHECKIN_POINTS = 10;

/** POST /api/attendance/checkin. activityId is optional: the server finds which open check-in the code belongs to. */
export const CheckinRequestSchema = z.object({
  code: CheckinCodeSchema,
  activityId: ActivityIdSchema.optional(),
});
export type CheckinRequest = z.input<typeof CheckinRequestSchema>;

export const CheckinResponseSchema = z.object({
  activityId: z.string(),
  title: z.string(),
  /** false when this person had already checked in (nothing awarded again). */
  newlyCheckedIn: z.boolean(),
  points: z.number().int(),
  /** Your n-th check-in at this activity ("you are #14 in the room"). */
  position: z.number().int(),
  /** People checked in so far. */
  count: z.number().int(),
  /** Activities you have checked in to, in total. */
  myCheckins: z.number().int(),
  at: z.number(),
});
export type CheckinResponse = z.infer<typeof CheckinResponseSchema>;

/** What a phone needs: open check-ins (never the codes) and what you already did. */
export const OpenCheckinSchema = z.object({
  activityId: z.string(),
  title: z.string(),
  openedAt: z.number(),
  closesAt: z.number().nullable(),
  count: z.number().int(),
  checkedIn: z.boolean(),
});
export type OpenCheckin = z.infer<typeof OpenCheckinSchema>;

export const MyAttendanceSchema = z.object({
  /** Event attendance = first sign-in (core). */
  eventSignedInAt: z.number(),
  open: z.array(OpenCheckinSchema),
  checkins: z.array(z.object({ activityId: z.string(), title: z.string(), at: z.number() })),
  here: z.number().int(),
});
export type MyAttendance = z.infer<typeof MyAttendanceSchema>;

/** GET /api/attendance/screen (projector, console preview): codes for every open check-in. */
export const ScreenCheckinSchema = z.object({
  activityId: z.string(),
  title: z.string(),
  code: z.string(),
  /** When this code stops being the current one (epoch ms, server time). It stays valid one more window. */
  rotatesAt: z.number(),
  /** Full URL for the QR: opens the app and checks in with this code. */
  qrUrl: z.string(),
  count: z.number().int(),
  closesAt: z.number().nullable(),
});
export type ScreenCheckin = z.infer<typeof ScreenCheckinSchema>;
export const ScreenCheckinsSchema = z.object({ now: z.number(), windowMs: z.number(), open: z.array(ScreenCheckinSchema) });
export type ScreenCheckins = z.infer<typeof ScreenCheckinsSchema>;

/** Console. */
export const OpenCheckinRequestSchema = z.object({
  activityId: ActivityIdSchema,
  /** Shown on the projector and in exports. Defaults to the schedule activity's title. */
  title: z.string().trim().min(1).max(120).optional(),
  /** Optional auto-close, epoch ms. */
  closesAt: z.number().int().nullable().optional(),
});
export type OpenCheckinRequest = z.infer<typeof OpenCheckinRequestSchema>;
export const CloseCheckinRequestSchema = z.object({ activityId: ActivityIdSchema });
export type CloseCheckinRequest = z.infer<typeof CloseCheckinRequestSchema>;
export const ManualCheckinRequestSchema = z.object({ attendeeId: z.number().int().positive() });
export type ManualCheckinRequest = z.infer<typeof ManualCheckinRequestSchema>;

export const AdminWindowSchema = z.object({
  activityId: z.string(),
  title: z.string(),
  open: z.boolean(),
  openedAt: z.number(),
  closedAt: z.number().nullable(),
  closesAt: z.number().nullable(),
  count: z.number().int(),
});
export type AdminWindow = z.infer<typeof AdminWindowSchema>;
export const AdminOverviewSchema = z.object({
  /** Event attendance: everyone who signed in. */
  eventCount: z.number().int(),
  profileCount: z.number().int(),
  windows: z.array(AdminWindowSchema),
});
export type AdminOverview = z.infer<typeof AdminOverviewSchema>;

export const AttendanceListQuerySchema = z.object({
  q: z.string().trim().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
export const AttendanceRowSchema = z.object({
  attendeeId: z.number().int(),
  name: z.string().nullable(),
  roll: z.string().nullable(),
  nickname: z.string().nullable(),
  kitId: z.string(),
  at: z.number(),
  /** Number of activity check-ins (event list only). */
  checkins: z.number().int().optional(),
});
export type AttendanceRow = z.infer<typeof AttendanceRowSchema>;
export const AttendanceListSchema = z.object({ total: z.number().int(), rows: z.array(AttendanceRowSchema) });
export type AttendanceList = z.infer<typeof AttendanceListSchema>;

// Live events -------------------------------------------------------------

/** To attendees (and console): a check-in opened or closed. Never carries the code. */
export const CheckinStateEventSchema = z.object({
  activityId: z.string(),
  title: z.string(),
  open: z.boolean(),
  closesAt: z.number().nullable(),
});
export type CheckinStateEvent = z.infer<typeof CheckinStateEventSchema>;

/** To screens (and console): the code for an open check-in rotated (also sent when it opens). */
export const CheckinCodeEventSchema = z.object({
  activityId: z.string(),
  code: z.string(),
  rotatesAt: z.number(),
  qrUrl: z.string(),
});
export type CheckinCodeEvent = z.infer<typeof CheckinCodeEventSchema>;

/** To everyone, coalesced to about 1 per second: live counters ("143 checked in"). */
export const CheckinCountsEventSchema = z.object({ counts: z.record(z.string(), z.number().int()) });
export type CheckinCountsEvent = z.infer<typeof CheckinCountsEventSchema>;

/** To screens: nicknames that just checked in, for a "welcome, x" ticker. At most 5 names per event. */
export const CheckinArrivalsEventSchema = z.object({
  activityId: z.string(),
  names: z.array(z.string()),
});
export type CheckinArrivalsEvent = z.infer<typeof CheckinArrivalsEventSchema>;

declare module '../live' {
  interface LiveEvents {
    'attendance.state': CheckinStateEvent;
    'attendance.code': CheckinCodeEvent;
    'attendance.counts': CheckinCountsEvent;
    'attendance.arrivals': CheckinArrivalsEvent;
  }
}
