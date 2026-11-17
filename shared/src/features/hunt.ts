// Treasure hunt (spec 5.5): individual hunt, shuffled order per attendee.
//
// Rules the contract encodes:
// - The client only ever sees ITS current stop's clue and ITS solved stops.
//   Answers, tokens, other clues never appear in an attendee response.
// - A stop is solved by scanning its sticker (a QR carrying a random per-stop
//   token, or the short code printed under it) or by typing an answer.
// - Hint costs and the finish bonus are decided on the server.
import { z } from 'zod';
import { AvatarConfigSchema } from '../avatar';
import { GlyphSchema, PaletteColorSchema } from '../palette';

// ---- constants (shared so the UI can show them; the server enforces them) ----

export const HUNT_MAX_HINTS = 2;
/** Points a hint takes off the stop's reward, by hint number (1, 2). The stop never pays less than 1. */
export const HUNT_HINT_COSTS = [2, 3] as const;
export const HUNT_CONFIRM_RESET = 'RESET HUNT';

// ---- helpers both sides use ----

/** What a typed answer is compared as: case, spaces, accents and punctuation do not matter. "Hello, World!" == "helloworld". */
export function normaliseAnswer(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/** URL a sticker's QR encodes. The web app routes /hunt/s/:token to the scanner flow. */
export function huntScanUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/$/, '')}/hunt/s/${token}`;
}

/**
 * Whatever the camera or the typed-code box produced -> the bare token/code.
 * Accepts the full sticker URL, a bare token, or a code like "abcd-efgh".
 */
export function extractHuntCode(input: string): string {
  let s = input.trim();
  const cut = s.search(/[?#]/);
  if (cut >= 0) s = s.slice(0, cut);
  if (s.includes('/')) s = s.split('/').filter(Boolean).pop() ?? '';
  return s;
}

/** Short code format printed under the QR: XXXX-XXXX. */
export function formatHuntCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

// ---- attendee side ----

export const HuntStatusSchema = z.enum(['draft', 'open', 'closed']);
export type HuntStatus = z.infer<typeof HuntStatusSchema>;

export const HuntSolvedStopSchema = z.object({
  stopId: z.number().int(),
  /** 1-based position in THIS attendee's order. */
  index: z.number().int(),
  title: z.string(),
  /** The fun fact / payoff shown after solving. */
  reveal: z.string(),
  /** Stamp art for the passport. */
  glyph: GlyphSchema,
  color: PaletteColorSchema,
  solvedAt: z.number(),
  via: z.enum(['qr', 'answer']),
  /** Points this stop actually paid (after hint costs). */
  points: z.number().int(),
  hintsUsed: z.number().int(),
  /** How many people (including you) have found this stop so far. */
  solvedBy: z.number().int(),
});
export type HuntSolvedStop = z.infer<typeof HuntSolvedStopSchema>;

export const HuntCurrentStopSchema = z.object({
  stopId: z.number().int(),
  index: z.number().int(),
  total: z.number().int(),
  clue: z.string(),
  clueImage: z.string().nullable(),
  /** Only the hints you already revealed. */
  hints: z.array(z.string()),
  hintsLeft: z.number().int(),
  /** Cost of the next hint, null when there are none left. */
  nextHintCost: z.number().int().nullable(),
  /** What solving it right now pays. Drops as you reveal hints. */
  worth: z.number().int(),
  /** False for sticker-only stops: the UI hides the answer box. */
  canType: z.boolean(),
  /** Epoch ms until which typed answers are refused (0 when free). */
  lockedUntil: z.number(),
  wrongCount: z.number().int(),
  /** How many OTHER people are on this same stop right now. */
  hereNow: z.number().int(),
  isFinal: z.boolean(),
});
export type HuntCurrentStop = z.infer<typeof HuntCurrentStopSchema>;

/** Anonymous crowd counts, safe for everyone to see. */
export const HuntCrowdSchema = z.object({
  /** People currently ON each stop (stop id -> count). Only stops with someone on them. */
  here: z.array(z.object({ stopId: z.number().int(), count: z.number().int() })),
  /** Started and not finished. */
  hunting: z.number().int(),
  finished: z.number().int(),
  /** Everyone who pressed start. */
  players: z.number().int(),
  updatedAt: z.number(),
});
export type HuntCrowd = z.infer<typeof HuntCrowdSchema>;

export const HuntFinisherSchema = z.object({
  rank: z.number().int(),
  attendeeId: z.number().int(),
  nickname: z.string(),
  avatar: AvatarConfigSchema,
  finishedAt: z.number(),
  elapsedMs: z.number().int(),
  /** Rank bonus + speed bonus. */
  bonus: z.number().int(),
});
export type HuntFinisher = z.infer<typeof HuntFinisherSchema>;

export const HuntMyFinishSchema = z.object({
  rank: z.number().int(),
  finishedAt: z.number(),
  elapsedMs: z.number().int(),
  rankBonus: z.number().int(),
  speedBonus: z.number().int(),
  /** Hunters who finished (so far), you included. */
  finishers: z.number().int(),
  usedNoHints: z.boolean(),
});
export type HuntMyFinish = z.infer<typeof HuntMyFinishSchema>;

/** GET /api/hunt (attendee): everything the passport screen needs. */
export const HuntMeSchema = z.object({
  status: HuntStatusSchema,
  title: z.string(),
  total: z.number().int(),
  serverNow: z.number(),
  started: z.boolean(),
  startedAt: z.number().nullable(),
  /** Stamps collected, in the order you got them. */
  solved: z.array(HuntSolvedStopSchema),
  /** Null before you start, once you finish, and whenever the hunt is not open. */
  current: HuntCurrentStopSchema.nullable(),
  finish: HuntMyFinishSchema.nullable(),
  /** All hunt points so far (stamps + bonuses). */
  pointsEarned: z.number().int(),
  crowd: HuntCrowdSchema,
});
export type HuntMe = z.infer<typeof HuntMeSchema>;

/** POST /api/hunt/scan */
export const HuntScanRequestSchema = z.object({
  /** The QR contents (URL), the bare token, or the typed short code. */
  code: z.string().min(1).max(300),
});
export type HuntScanRequest = z.infer<typeof HuntScanRequestSchema>;

/** POST /api/hunt/answer */
export const HuntAnswerRequestSchema = z.object({
  stopId: z.number().int(),
  answer: z.string().max(120),
});
export type HuntAnswerRequest = z.infer<typeof HuntAnswerRequestSchema>;

/** POST /api/hunt/hint. `n` must be the next unrevealed hint (1 or 2); repeating a revealed one is free. */
export const HuntHintRequestSchema = z.object({
  stopId: z.number().int(),
  n: z.number().int().min(1).max(HUNT_MAX_HINTS),
});
export type HuntHintRequest = z.infer<typeof HuntHintRequestSchema>;

/**
 * Scan and answer both answer 200 with one of these (wrong answers are normal, not errors).
 * Errors (not open, not started, rate limited, bad input) use the shared error shape.
 */
export const HuntAttemptResultSchema = z.discriminatedUnion('result', [
  z.object({
    result: z.literal('solved'),
    message: z.string(),
    stop: HuntSolvedStopSchema,
    /** Present when this stamp completed the hunt. */
    finish: HuntMyFinishSchema.nullable(),
    me: HuntMeSchema,
  }),
  z.object({
    result: z.literal('wrong'),
    message: z.string(),
    wrongCount: z.number().int(),
    lockedUntil: z.number(),
    cooldownMs: z.number().int(),
    me: HuntMeSchema,
  }),
  z.object({
    result: z.literal('locked'),
    message: z.string(),
    lockedUntil: z.number(),
    retryAfterMs: z.number().int(),
    me: HuntMeSchema,
  }),
  /** A sticker or stop that is not your current one. Same reply for unknown and for later stops: nothing leaks. */
  z.object({ result: z.literal('not_yours'), message: z.string(), me: HuntMeSchema }),
  /** A stop you already stamped. */
  z.object({ result: z.literal('already'), message: z.string(), me: HuntMeSchema }),
]);
export type HuntAttemptResult = z.infer<typeof HuntAttemptResultSchema>;

export const HuntHintResultSchema = z.object({
  n: z.number().int(),
  hint: z.string(),
  /** Points taken off this stop's reward by this hint (0 when it was already revealed). */
  cost: z.number().int(),
  me: HuntMeSchema,
});
export type HuntHintResult = z.infer<typeof HuntHintResultSchema>;

/** GET /api/hunt/board (attendee, projector, console): the live crowd and finishers. */
export const HuntBoardSchema = z.object({
  status: HuntStatusSchema,
  title: z.string(),
  total: z.number().int(),
  crowd: HuntCrowdSchema,
  /** Fastest first. */
  finishers: z.array(HuntFinisherSchema),
  serverNow: z.number(),
});
export type HuntBoard = z.infer<typeof HuntBoardSchema>;

// ---- console side ----

const StopTextFields = {
  title: z.string().trim().min(1).max(60),
  clue: z.string().trim().min(1).max(400),
  /** Relative path or https URL. */
  clueImage: z
    .string()
    .trim()
    .max(300)
    .regex(/^(https:\/\/|\/)/, 'Use an https:// link or a /path')
    .nullable()
    .default(null),
  /** Accepted typed answers (any one of them). Empty = sticker only. */
  answers: z.array(z.string().trim().min(1).max(60)).max(8).default([]),
  hints: z.array(z.string().trim().min(1).max(200)).max(HUNT_MAX_HINTS).default([]),
  points: z.number().int().min(1).max(50).default(10),
  glyph: GlyphSchema.default('star'),
  color: PaletteColorSchema.default('tangerine'),
  /** Shown after solving. */
  reveal: z.string().trim().max(240).default(''),
  /** Organiser note: where the sticker goes. Never sent to attendees. */
  location: z.string().trim().max(120).default(''),
};
export const HuntStopInputSchema = z.object(StopTextFields);
export type HuntStopInput = z.input<typeof HuntStopInputSchema>;

export const HuntAdminStopSchema = z.object({
  id: z.number().int(),
  position: z.number().int(),
  /** The last stop in order is the finale, the same for everyone. */
  isFinal: z.boolean(),
  title: z.string(),
  clue: z.string(),
  clueImage: z.string().nullable(),
  answers: z.array(z.string()),
  hints: z.array(z.string()),
  points: z.number().int(),
  glyph: GlyphSchema,
  color: PaletteColorSchema,
  reveal: z.string(),
  location: z.string(),
  token: z.string(),
  /** Short typed code, XXXX-XXXX. */
  code: z.string(),
  url: z.string(),
  solvedBy: z.number().int(),
  hereNow: z.number().int(),
});
export type HuntAdminStop = z.infer<typeof HuntAdminStopSchema>;

/** GET /api/hunt/admin */
export const HuntAdminSchema = z.object({
  status: HuntStatusSchema,
  title: z.string(),
  openedAt: z.number().nullable(),
  closedAt: z.number().nullable(),
  stops: z.array(HuntAdminStopSchema),
  players: z.number().int(),
  finished: z.number().int(),
  /** True once anyone pressed start: adding, deleting and reordering stops needs a reset first. */
  structureLocked: z.boolean(),
  serverNow: z.number(),
});
export type HuntAdmin = z.infer<typeof HuntAdminSchema>;

/** PUT /api/hunt/admin/state */
export const HuntAdminStateRequestSchema = z
  .object({ status: HuntStatusSchema, title: z.string().trim().min(1).max(60) })
  .partial()
  .refine((v) => v.status !== undefined || v.title !== undefined, 'Nothing to change');
export type HuntAdminStateRequest = z.infer<typeof HuntAdminStateRequestSchema>;

/** PUT /api/hunt/admin/order: every stop id, in the new order (the last one is the finale). */
export const HuntAdminOrderRequestSchema = z.object({ ids: z.array(z.number().int()).min(1).max(40) });
export type HuntAdminOrderRequest = z.infer<typeof HuntAdminOrderRequestSchema>;

/** GET /api/hunt/admin/stickers: render these as QR stickers (url -> QR, code printed under it). */
export const HuntStickerSheetSchema = z.object({
  title: z.string(),
  stops: z.array(
    z.object({
      stopId: z.number().int(),
      position: z.number().int(),
      title: z.string(),
      location: z.string(),
      token: z.string(),
      code: z.string(),
      url: z.string(),
    }),
  ),
});
export type HuntStickerSheet = z.infer<typeof HuntStickerSheetSchema>;

/** GET /api/hunt/admin/progress */
export const HuntAdminProgressSchema = z.object({
  total: z.number().int(),
  rows: z.array(
    z.object({
      attendeeId: z.number().int(),
      nickname: z.string().nullable(),
      avatar: AvatarConfigSchema.nullable(),
      name: z.string().nullable(),
      roll: z.string().nullable(),
      solved: z.number().int(),
      currentStopId: z.number().int().nullable(),
      currentStopTitle: z.string().nullable(),
      hintsUsed: z.number().int(),
      startedAt: z.number(),
      lastActiveAt: z.number(),
      finishedAt: z.number().nullable(),
      rank: z.number().int().nullable(),
      elapsedMs: z.number().int().nullable(),
    }),
  ),
  /** People on each stop right now, with the stop's title. */
  crowd: z.array(z.object({ stopId: z.number().int(), title: z.string(), count: z.number().int() })),
});
export type HuntAdminProgress = z.infer<typeof HuntAdminProgressSchema>;

/** POST /api/hunt/admin/reset */
export const HuntAdminResetRequestSchema = z.object({ confirm: z.literal(HUNT_CONFIRM_RESET) });

// ---- live events ----

export const HuntStateEventSchema = z.object({ status: HuntStatusSchema, title: z.string(), total: z.number().int() });
export type HuntStateEvent = z.infer<typeof HuntStateEventSchema>;

export const HuntStampEventSchema = z.object({
  nickname: z.string(),
  avatar: AvatarConfigSchema,
  solved: z.number().int(),
  total: z.number().int(),
  at: z.number(),
});
export type HuntStampEvent = z.infer<typeof HuntStampEventSchema>;

export const HuntFinishedEventSchema = z.object({
  finisher: HuntFinisherSchema,
  finishedCount: z.number().int(),
});
export type HuntFinishedEvent = z.infer<typeof HuntFinishedEventSchema>;

declare module '../live' {
  interface LiveEvents {
    /** To everyone: the hunt opened, closed, was renamed or its stop count changed. Refetch GET /api/hunt. */
    'hunt.state': HuntStateEvent;
    /** To everyone: anonymous "where is the crowd" counts. Throttled (about every 1.5 s) and only sent when something moved. */
    'hunt.crowd': HuntCrowd;
    /** To screens and the console: someone collected a stamp (projector ticker). */
    'hunt.stamp': HuntStampEvent;
    /** To everyone: someone just finished. Drives the "first finishers" live moment. */
    'hunt.finished': HuntFinishedEvent;
  }
}
