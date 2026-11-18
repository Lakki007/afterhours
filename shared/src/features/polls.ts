// Polls and quiz (spec 5.4).
//
// Six poll kinds modelled as discriminated unions on `kind`, so the
// definition, the public view, the vote payload and the results shape of each
// kind are typed end to end:
//   single | multi | this_or_that | rating | wordcloud | quiz
//
// Lifecycle (organiser driven, one live poll at a time):
//   draft -> live -> closed -> revealed
//
// Quiz secrecy: the correct option exists only in the database and in the
// organiser's console. `PublicPoll.correct` is null for everyone until the
// poll is revealed, and quiz results carry no per-option counts before reveal.
import { z } from 'zod';
import { AvatarConfigSchema } from '../avatar';

// ---- limits (the web app uses these to size inputs) ----------------------

export const POLL_LIMITS = {
  questionMax: 140,
  optionLabelMax: 60,
  optionsMin: 2,
  optionsMax: 8,
  quizOptionsMax: 6,
  wordMaxLen: 24,
  wordMinLen: 2,
  maxWordsPerVote: 3,
  quizDurationMsMin: 5_000,
  quizDurationMsMax: 120_000,
  /** The 3-2-1 lead-in between launching a quiz question and answers opening. */
  quizLeadInMs: 3_000,
  /** Network grace after a quiz deadline before a late answer is rejected. */
  quizGraceMs: 800,
} as const;

// ---- lifecycle -----------------------------------------------------------

export const POLL_KINDS = ['single', 'multi', 'this_or_that', 'rating', 'wordcloud', 'quiz'] as const;
export const PollKindSchema = z.enum(POLL_KINDS);
export type PollKind = z.infer<typeof PollKindSchema>;

export const PollStatusSchema = z.enum(['draft', 'live', 'closed', 'revealed']);
export type PollStatus = z.infer<typeof PollStatusSchema>;

// ---- definitions (organiser creates / edits) ------------------------------

export const PollOptionSchema = z.object({
  label: z.string().trim().min(1).max(POLL_LIMITS.optionLabelMax),
  /** One emoji or short glyph shown beside the label. */
  emoji: z.string().trim().max(8).optional(),
});
export type PollOption = z.infer<typeof PollOptionSchema>;

const question = z.string().trim().min(3).max(POLL_LIMITS.questionMax);
const options = (max: number = POLL_LIMITS.optionsMax) => z.array(PollOptionSchema).min(POLL_LIMITS.optionsMin).max(max);

export const RatingScaleSchema = z
  .object({
    min: z.literal(1).default(1),
    max: z.union([z.literal(5), z.literal(7), z.literal(10)]).default(5),
    style: z.enum(['slider', 'emoji']).default('slider'),
    lowLabel: z.string().trim().max(24).default(''),
    highLabel: z.string().trim().max(24).default(''),
  })
  .default({ min: 1, max: 5, style: 'slider', lowLabel: '', highLabel: '' });
export type RatingScale = z.infer<typeof RatingScaleSchema>;

const SingleDefSchema = z.object({ kind: z.literal('single'), question, options: options() });
const MultiDefSchema = z
  .object({ kind: z.literal('multi'), question, options: options(), maxChoices: z.number().int().min(1).max(POLL_LIMITS.optionsMax).default(3) })
  .refine((d) => d.maxChoices <= d.options.length, { message: 'maxChoices cannot exceed the number of options', path: ['maxChoices'] });
const ThisOrThatDefSchema = z.object({ kind: z.literal('this_or_that'), question, options: z.tuple([PollOptionSchema, PollOptionSchema]) });
const RatingDefSchema = z.object({ kind: z.literal('rating'), question, scale: RatingScaleSchema });
const WordCloudDefSchema = z.object({
  kind: z.literal('wordcloud'),
  question,
  maxWords: z.number().int().min(1).max(POLL_LIMITS.maxWordsPerVote).default(1),
});
const QuizDefSchema = z
  .object({
    kind: z.literal('quiz'),
    question,
    options: options(POLL_LIMITS.quizOptionsMax),
    /** Index into `options`. Never leaves the server except to the console, and to everyone after reveal. */
    correct: z.number().int().min(0),
    durationMs: z.number().int().min(POLL_LIMITS.quizDurationMsMin).max(POLL_LIMITS.quizDurationMsMax).default(20_000),
    basePoints: z.number().int().min(0).max(200).default(20),
    /** Extra points for a perfectly instant answer; scales linearly down to 0 at the deadline. */
    speedBonusMax: z.number().int().min(0).max(200).default(20),
    /** Questions with the same series share a running scoreboard. */
    series: z.string().trim().min(1).max(32).default('quiz'),
  })
  .refine((d) => d.correct < d.options.length, { message: 'correct must point at one of the options', path: ['correct'] });

export const PollDefinitionSchema = z.discriminatedUnion('kind', [
  SingleDefSchema,
  MultiDefSchema,
  ThisOrThatDefSchema,
  RatingDefSchema,
  WordCloudDefSchema,
  QuizDefSchema,
]);
export type PollDefinition = z.output<typeof PollDefinitionSchema>;
export type PollDefinitionInput = z.input<typeof PollDefinitionSchema>;

// ---- public poll (what a phone, the projector or the console receives) ----

const PollBase = {
  id: z.number().int(),
  question: z.string(),
  status: PollStatusSchema,
  /** Order in the console's list. */
  position: z.number().int(),
  /** When the organiser pressed launch. Server epoch ms. */
  openedAt: z.number().nullable(),
  /** When answers open. Equals openedAt except for quiz (which has a 3-2-1 lead-in). */
  startsAt: z.number().nullable(),
  /** Quiz only: when answers stop. Server time, authoritative. */
  deadlineAt: z.number().nullable(),
  closedAt: z.number().nullable(),
  revealedAt: z.number().nullable(),
};

export const PublicPollSchema = z.discriminatedUnion('kind', [
  z.object({ ...PollBase, kind: z.literal('single'), options: z.array(PollOptionSchema) }),
  z.object({ ...PollBase, kind: z.literal('multi'), options: z.array(PollOptionSchema), maxChoices: z.number().int() }),
  z.object({ ...PollBase, kind: z.literal('this_or_that'), options: z.tuple([PollOptionSchema, PollOptionSchema]) }),
  z.object({ ...PollBase, kind: z.literal('rating'), scale: RatingScaleSchema }),
  z.object({ ...PollBase, kind: z.literal('wordcloud'), maxWords: z.number().int(), maxLen: z.number().int() }),
  z.object({
    ...PollBase,
    kind: z.literal('quiz'),
    options: z.array(PollOptionSchema),
    durationMs: z.number().int(),
    basePoints: z.number().int(),
    speedBonusMax: z.number().int(),
    series: z.string(),
    /** null until the poll is revealed (always filled for the console). */
    correct: z.number().int().nullable(),
  }),
]);
export type PublicPoll = z.infer<typeof PublicPollSchema>;
export type PublicPollOf<K extends PollKind> = Extract<PublicPoll, { kind: K }>;

// ---- votes ------------------------------------------------------------------

export const VoteRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('single'), choice: z.number().int().min(0).max(POLL_LIMITS.optionsMax - 1) }),
  z.object({
    kind: z.literal('multi'),
    choices: z.array(z.number().int().min(0).max(POLL_LIMITS.optionsMax - 1)).min(1).max(POLL_LIMITS.optionsMax),
  }),
  z.object({ kind: z.literal('this_or_that'), choice: z.union([z.literal(0), z.literal(1)]) }),
  z.object({ kind: z.literal('rating'), value: z.number().int().min(1).max(10) }),
  z.object({ kind: z.literal('wordcloud'), words: z.array(z.string().max(80)).min(1).max(POLL_LIMITS.maxWordsPerVote) }),
  z.object({ kind: z.literal('quiz'), choice: z.number().int().min(0).max(POLL_LIMITS.quizOptionsMax - 1) }),
]);
export type VoteRequest = z.infer<typeof VoteRequestSchema>;
export type VoteRequestOf<K extends PollKind> = Extract<VoteRequest, { kind: K }>;

/** What I voted, echoed back (same shape as the request; word cloud words are the normalised ones). */
export type MyVote = VoteRequest;

// ---- results ------------------------------------------------------------------

export const WordCountSchema = z.object({ word: z.string(), count: z.number().int() });
export type WordCount = z.infer<typeof WordCountSchema>;

export const PollResultsSchema = z.union([
  /** single, multi and this_or_that: `counts[i]` is how many people picked option i. */
  z.object({ kind: z.enum(['single', 'multi', 'this_or_that']), total: z.number().int(), counts: z.array(z.number().int()) }),
  z.object({
    kind: z.literal('rating'),
    total: z.number().int(),
    average: z.number().nullable(),
    /** histogram[i] is how many picked value min + i. */
    histogram: z.array(z.number().int()),
    min: z.number().int(),
    max: z.number().int(),
  }),
  z.object({
    kind: z.literal('wordcloud'),
    /** People who submitted. */
    total: z.number().int(),
    /** Top words by count, hidden and filtered words already removed. Max 60. */
    words: z.array(WordCountSchema),
  }),
  /** Quiz while running or closed: only how many have answered. No distribution (people look at the projector). */
  z.object({ kind: z.literal('quiz'), revealed: z.literal(false), total: z.number().int() }),
  /** Quiz after reveal. */
  z.object({
    kind: z.literal('quiz'),
    revealed: z.literal(true),
    total: z.number().int(),
    counts: z.array(z.number().int()),
    correct: z.number().int(),
    /** Answered correctly. */
    right: z.number().int(),
    /** Median time to answer correctly, ms. null if nobody was right. */
    medianRightMs: z.number().nullable(),
  }),
]);
export type PollResults = z.infer<typeof PollResultsSchema>;

/** Quiz outcome for one person, only available after reveal. */
export const QuizResultSchema = z.object({
  pollId: z.number().int(),
  choice: z.number().int(),
  correct: z.boolean(),
  /** Points the answer was worth (0 when wrong). */
  points: z.number().int(),
  /** Of which: speed bonus. */
  speedBonus: z.number().int(),
  /** Time from "go" to your answer, server measured. */
  elapsedMs: z.number().int(),
});
export type QuizResult = z.infer<typeof QuizResultSchema>;

export const QuizBoardEntrySchema = z.object({
  rank: z.number().int(),
  attendeeId: z.number().int(),
  nickname: z.string(),
  avatar: AvatarConfigSchema,
  /** Quiz points across the revealed questions of the series. */
  points: z.number().int(),
  correct: z.number().int(),
});
export type QuizBoardEntry = z.infer<typeof QuizBoardEntrySchema>;

// ---- responses ------------------------------------------------------------------

/** GET /api/polls/current and GET /api/polls/:id */
export const PollViewSchema = z.object({
  /** Server clock, so the client can fix its offset for countdowns. */
  serverNow: z.number(),
  poll: PublicPollSchema,
  myVote: VoteRequestSchema.nullable(),
  /**
   * Null for people who have not voted, until reveal (and always null for a
   * running quiz). The web app shows results only when this is present.
   */
  results: PollResultsSchema.nullable(),
  /** Quiz only, only after reveal, only if I answered. */
  myQuiz: QuizResultSchema.nullable(),
  /** People who have voted so far ("143 voting"). Safe for everyone. */
  voters: z.number().int(),
});
export type PollView = z.infer<typeof PollViewSchema>;

/** GET /api/polls/current: the live poll, else the most recently finished one, else null. */
export const CurrentPollResponseSchema = z.object({ serverNow: z.number(), view: PollViewSchema.nullable() });
export type CurrentPollResponse = z.infer<typeof CurrentPollResponseSchema>;

/** GET /api/polls/history: finished polls, newest first. */
export const PollHistoryResponseSchema = z.object({ serverNow: z.number(), items: z.array(PollViewSchema) });
export type PollHistoryResponse = z.infer<typeof PollHistoryResponseSchema>;

/** POST /api/polls/:id/vote */
export const VoteResponseSchema = z.object({
  accepted: z.literal(true),
  /** Server receipt time (what quiz speed is measured against). */
  receivedAt: z.number(),
  /** Results including my vote so the phone can animate straight in. Quiz: only the answered count. */
  results: PollResultsSchema,
  voters: z.number().int(),
});
export type VoteResponse = z.infer<typeof VoteResponseSchema>;

/** GET /api/polls/screen (projector) */
export const ScreenPollStateSchema = z.object({
  serverNow: z.number(),
  /** Live poll, else the latest finished one, else null. */
  poll: PublicPollSchema.nullable(),
  /** Live results for the projector (quiz: answered count only until reveal). */
  results: PollResultsSchema.nullable(),
  /** Quiz series scoreboard, after a reveal. */
  board: z.array(QuizBoardEntrySchema).nullable(),
});
export type ScreenPollState = z.infer<typeof ScreenPollStateSchema>;

// ---- console ---------------------------------------------------------------------

export const AdminPollSchema = z.object({
  poll: PublicPollSchema,
  voters: z.number().int(),
});
export type AdminPoll = z.infer<typeof AdminPollSchema>;

export const AdminPollListSchema = z.object({ serverNow: z.number(), polls: z.array(AdminPollSchema) });
export type AdminPollList = z.infer<typeof AdminPollListSchema>;

/** The definition's input form, used to prefill the editor. Same shape as PollDefinition. */
export const AdminWordSchema = z.object({ word: z.string(), count: z.number().int(), hidden: z.boolean() });
export type AdminWord = z.infer<typeof AdminWordSchema>;

/** GET /api/polls/admin/:id/results. Always the full picture, even for a running quiz. */
export const AdminResultsSchema = z.object({
  poll: PublicPollSchema,
  voters: z.number().int(),
  /** Full counts (quiz included). */
  counts: z.array(z.number().int()).nullable(),
  /** Word cloud: every word including hidden ones so the organiser can hide/unhide. */
  words: z.array(AdminWordSchema).nullable(),
  results: PollResultsSchema,
  board: z.array(QuizBoardEntrySchema).nullable(),
});
export type AdminResults = z.infer<typeof AdminResultsSchema>;

export const LaunchPollRequestSchema = z.object({
  /** If another poll is live, close it first instead of refusing. */
  closeCurrent: z.boolean().default(false),
});
export type LaunchPollRequest = z.infer<typeof LaunchPollRequestSchema>;

export const ReorderPollsRequestSchema = z.object({ ids: z.array(z.number().int()).min(1).max(200) });
export type ReorderPollsRequest = z.infer<typeof ReorderPollsRequestSchema>;

export const HideWordRequestSchema = z.object({ word: z.string().min(1).max(80) });
export type HideWordRequest = z.infer<typeof HideWordRequestSchema>;

// ---- live events -----------------------------------------------------------------

/** The big moment. Takes over the attendee home screen. */
export const PollLaunchedSchema = z.object({
  poll: PublicPollSchema,
  /** When answers open (quiz: after the 3-2-1). Same as poll.startsAt. */
  startsAt: z.number(),
  deadlineAt: z.number().nullable(),
});
export type PollLaunched = z.infer<typeof PollLaunchedSchema>;

/** Throttled to at most ~2 per second while votes are flowing. */
export const PollResultsEventSchema = z.object({
  pollId: z.number().int(),
  results: PollResultsSchema,
  voters: z.number().int(),
});
export type PollResultsEvent = z.infer<typeof PollResultsEventSchema>;

export const PollClosedSchema = z.object({
  pollId: z.number().int(),
  closedAt: z.number(),
  /** The deadline passed on its own (quiz) rather than the organiser pressing close. */
  auto: z.boolean(),
  voters: z.number().int(),
});
export type PollClosed = z.infer<typeof PollClosedSchema>;

export const PollRevealedSchema = z.object({
  poll: PublicPollSchema,
  /** Full results; for a quiz this finally includes the distribution and the correct answer. */
  results: PollResultsSchema,
  /** Quiz series scoreboard (top 10) after this question. */
  board: z.array(QuizBoardEntrySchema).nullable(),
});
export type PollRevealed = z.infer<typeof PollRevealedSchema>;

declare module '../live' {
  interface LiveEvents {
    /** To everyone: a poll just went live. Phones take over the home screen; the projector switches scene. */
    'polls.launched': PollLaunched;
    /** To everyone: aggregated results, throttled. Phones show them only after voting. Quiz: answered count only. */
    'polls.results': PollResultsEvent;
    /** To everyone: voting is over. */
    'polls.closed': PollClosed;
    /** To everyone: reveal. Quiz: correct answer, distribution and scoreboard. */
    'polls.revealed': PollRevealed;
    /** To one attendee, at quiz reveal: how you did. */
    'polls.quiz-result': QuizResult;
    /** To the console: a poll was created, edited, reordered or deleted. Refetch the list. */
    'polls.changed': { at: number };
  }
}
