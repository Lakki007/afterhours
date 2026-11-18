// Arcade mini-games (spec 5.7): three runs of under a minute each.
//   reaction  "lag spike"  5 rounds, hit the button the moment the screen flips
//   hexbin    "base rush"  convert binary/hex/decimal against the clock
//   memory    "echo"       repeat a growing pad pattern (3x3), server checks every level as you go
// The server issues a run (token, seed, start time), generates the content from the seed, checks
// timing and answers, and awards capped points. See server/src/features/arcade.
import { z } from 'zod';
import { AvatarConfigSchema } from '../avatar';

export const GAME_IDS = ['reaction', 'hexbin', 'memory'] as const;
export const GameIdSchema = z.enum(GAME_IDS);
export type GameId = z.infer<typeof GameIdSchema>;

export interface GameInfo {
  id: GameId;
  title: string;
  blurb: string;
  howTo: string;
  /** Hard server-side limit from run start to the last accepted input. */
  durationMs: number;
  /** What the score means on the top list. */
  unit: string;
}

export const ARCADE_GAMES: Record<GameId, GameInfo> = {
  reaction: {
    id: 'reaction',
    title: 'lag spike',
    blurb: 'five rounds. the screen flips, you slap it. no early clicks, no mercy.',
    howTo: 'wait for green, tap as fast as you can. tapping early costs you.',
    durationMs: 45_000,
    unit: 'ms average',
  },
  hexbin: {
    id: 'hexbin',
    title: 'base rush',
    blurb: '45 seconds of binary, hex and decimal flipping. your inner compiler, on the clock.',
    howTo: 'convert the number, answer, next. wrong answers cost points.',
    durationMs: 45_000,
    unit: 'correct',
  },
  memory: {
    id: 'memory',
    title: 'echo',
    blurb: 'the pads light up, you play it back. one slip and the tape stops.',
    howTo: 'watch the pattern, repeat it. every level adds one more pad.',
    durationMs: 60_000,
    unit: 'levels',
  },
};

/** Points the arcade can pay one attendee per event day, across all games. Keeps it a side dish. */
export const ARCADE_DAILY_CAP = 60;
/** The event runs in IST; "per day" resets at midnight IST (UTC+05:30). */
export const ARCADE_DAY_OFFSET_MS = 19_800_000;

export const REACTION_ROUNDS = 5;
/** Below this a reaction time is not humanly possible and the run is rejected. */
export const REACTION_MIN_MS = 100;
export const REACTION_MAX_MS = 5000;
export const HEXBIN_QUESTIONS = 40;
export const MEMORY_PADS = 9;
export const MEMORY_SHOW_MS = 450;
export const MEMORY_MAX_LEVEL = 30;

// Runs ---------------------------------------------------------------------

export const StartRunRequestSchema = z.object({ game: GameIdSchema });
export type StartRunRequest = z.infer<typeof StartRunRequestSchema>;

export const HexbinBaseSchema = z.enum(['bin', 'dec', 'hex']);
export type HexbinBase = z.infer<typeof HexbinBaseSchema>;
export const HexbinQuestionSchema = z.object({
  i: z.number().int(),
  /** The number as displayed, with its prefix: "0b1011", "0x2F", "47". */
  prompt: z.string(),
  from: HexbinBaseSchema,
  /** The base the answer must be in. */
  to: HexbinBaseSchema,
});
export type HexbinQuestion = z.infer<typeof HexbinQuestionSchema>;

const RunBase = {
  /** The single-use token for this run. Treat it like a password. */
  runId: z.string(),
  startedAt: z.number(),
  /** Last moment the server accepts anything for this run. */
  expiresAt: z.number(),
  now: z.number(),
  durationMs: z.number().int(),
};
export const RunStartSchema = z.discriminatedUnion('game', [
  z.object({ ...RunBase, game: z.literal('reaction'), spec: z.object({ rounds: z.number().int(), delaysMs: z.array(z.number().int()) }) }),
  z.object({ ...RunBase, game: z.literal('hexbin'), spec: z.object({ questions: z.array(HexbinQuestionSchema) }) }),
  z.object({
    ...RunBase,
    game: z.literal('memory'),
    spec: z.object({ pads: z.number().int(), showMs: z.number().int(), level: z.number().int(), sequence: z.array(z.number().int()) }),
  }),
]);
export type RunStart = z.infer<typeof RunStartSchema>;

/** POST /api/arcade/runs/:id/submit for reaction: your times in order. 0 is not allowed; report a false start as REACTION_MAX_MS. */
export const ReactionSubmitSchema = z.object({
  reactions: z.array(z.number().int().min(1).max(REACTION_MAX_MS)).length(REACTION_ROUNDS),
});
export type ReactionSubmit = z.infer<typeof ReactionSubmitSchema>;

/** POST /api/arcade/runs/:id/submit for hexbin: your answers in question order, with ms since the run began. */
export const HexbinSubmitSchema = z.object({
  answers: z
    .array(z.object({ a: z.string().trim().max(24), t: z.number().int().min(0).max(120_000) }))
    .min(1)
    .max(HEXBIN_QUESTIONS),
});
export type HexbinSubmit = z.infer<typeof HexbinSubmitSchema>;

/** POST /api/arcade/runs/:id/step for memory: the pads you tapped for the current level, in order. */
export const MemoryStepSchema = z.object({ taps: z.array(z.number().int().min(0).max(MEMORY_PADS - 1)).min(1).max(MEMORY_MAX_LEVEL) });
export type MemoryStep = z.infer<typeof MemoryStepSchema>;

export const BestSchema = z.object({ score: z.number().int(), label: z.string() });
export type Best = z.infer<typeof BestSchema>;

export const RunResultSchema = z.object({
  runId: z.string(),
  game: GameIdSchema,
  score: z.number().int(),
  /** Human readable: "238 ms", "23 right", "level 9". */
  label: z.string(),
  /** Points actually added to your total (after the daily cap). */
  points: z.number().int(),
  /** Points this run was worth before the cap. */
  rawPoints: z.number().int(),
  capReached: z.boolean(),
  /** Arcade points you can still earn today. */
  capRemaining: z.number().int(),
  newBest: z.boolean(),
  best: BestSchema,
  /** Your place on this game's top list, 1-based, and how many players it has. */
  rank: z.number().int(),
  players: z.number().int(),
  /** Share of players your best beats, 0..100. */
  percentile: z.number().int(),
  detail: z.record(z.string(), z.number()),
});
export type RunResult = z.infer<typeof RunResultSchema>;

/** Memory: level cleared, here is the next (longer) pattern, or the run is over. */
export const MemoryStepResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('continue'), level: z.number().int(), sequence: z.array(z.number().int()), cleared: z.number().int() }),
  z.object({ status: z.literal('over'), result: RunResultSchema }),
]);
export type MemoryStepResponse = z.infer<typeof MemoryStepResponseSchema>;

// Lists --------------------------------------------------------------------

export const ArcadeSettingsSchema = z.object({
  enabled: z.boolean(),
  games: z.record(GameIdSchema, z.boolean()),
});
export type ArcadeSettings = z.infer<typeof ArcadeSettingsSchema>;

export const GamesResponseSchema = z.object({
  settings: ArcadeSettingsSchema,
  games: z.array(z.object({ id: GameIdSchema, best: BestSchema.nullable(), plays: z.number().int(), rank: z.number().int().nullable(), players: z.number().int() })),
  daily: z.object({ cap: z.number().int(), earned: z.number().int(), remaining: z.number().int(), resetsAt: z.number() }),
});
export type GamesResponse = z.infer<typeof GamesResponseSchema>;

export const TopEntrySchema = z.object({
  rank: z.number().int(),
  attendeeId: z.number().int(),
  nickname: z.string(),
  avatar: AvatarConfigSchema,
  score: z.number().int(),
  label: z.string(),
  at: z.number(),
});
export type TopEntry = z.infer<typeof TopEntrySchema>;
export const TopBoardSchema = z.object({
  game: GameIdSchema,
  entries: z.array(TopEntrySchema),
  players: z.number().int(),
  me: z.object({ rank: z.number().int(), score: z.number().int(), label: z.string() }).nullable(),
});
export type TopBoard = z.infer<typeof TopBoardSchema>;
/** GET /api/arcade/top?limit=5 (attendee, projector, console): all three lists in one call. */
export const TopResponseSchema = z.object({ boards: z.array(TopBoardSchema), now: z.number() });
export type TopResponse = z.infer<typeof TopResponseSchema>;
export const TopQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(10) });

// Console ------------------------------------------------------------------

export const ArcadeSettingsRequestSchema = z.object({
  enabled: z.boolean().optional(),
  games: z.partialRecord(GameIdSchema, z.boolean()).optional(),
});
export type ArcadeSettingsRequest = z.infer<typeof ArcadeSettingsRequestSchema>;
export const ArcadeResetRequestSchema = z.object({ confirm: z.literal('RESET ARCADE') });
export const ArcadeStatsSchema = z.object({
  settings: ArcadeSettingsSchema,
  dailyCap: z.number().int(),
  games: z.array(z.object({ id: GameIdSchema, runs: z.number().int(), players: z.number().int(), flagged: z.number().int(), open: z.number().int(), best: BestSchema.nullable() })),
  /** Arcade points paid out so far, all attendees. */
  pointsPaid: z.number().int(),
});
export type ArcadeStats = z.infer<typeof ArcadeStatsSchema>;

// Live events --------------------------------------------------------------

/** To everyone: the console switched the arcade (or one game) on or off. */
export const ArcadeToggledSchema = ArcadeSettingsSchema;
/** To everyone: someone took #1 on a game's top list. Toast on phones, flourish on the projector. */
export const ArcadeRecordSchema = z.object({
  game: GameIdSchema,
  attendeeId: z.number().int(),
  nickname: z.string(),
  avatar: AvatarConfigSchema,
  score: z.number().int(),
  label: z.string(),
  previous: z.object({ nickname: z.string(), score: z.number().int(), label: z.string() }).nullable(),
});
export type ArcadeRecord = z.infer<typeof ArcadeRecordSchema>;
/** To screens, at most once per 2 s: these top lists changed, refetch them. */
export const ArcadeTopChangedSchema = z.object({ games: z.array(GameIdSchema) });
export type ArcadeTopChanged = z.infer<typeof ArcadeTopChangedSchema>;

declare module '../live' {
  interface LiveEvents {
    'arcade.toggled': ArcadeSettings;
    'arcade.record': ArcadeRecord;
    'arcade.top': ArcadeTopChanged;
  }
}
