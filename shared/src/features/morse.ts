// Morse challenge (spec 5.6): shared contract, the Morse table and the timing maths.
//
// Everything pure lives here so the server judges taps with exactly the rules
// the phone uses for practice mode and for local "feel" feedback.
import { z } from 'zod';
import { AvatarConfigSchema } from '../avatar';

// ---------------------------------------------------------------------------
// The code
// ---------------------------------------------------------------------------

export const MORSE_TABLE: Readonly<Record<string, string>> = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---',
  K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-',
  U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
  '0': '-----', '1': '.----', '2': '..---', '3': '...--', '4': '....-',
  '5': '.....', '6': '-....', '7': '--...', '8': '---..', '9': '----.',
};

const REVERSE: Readonly<Record<string, string>> = Object.fromEntries(Object.entries(MORSE_TABLE).map(([k, v]) => [v, k]));

/** Practice chart order: letters then digits. */
export const MORSE_CHART: readonly { char: string; code: string }[] = Object.entries(MORSE_TABLE).map(([char, code]) => ({ char, code }));

/** '.-' -> 'A', unknown -> '?'. */
export function decodePattern(pattern: string): string {
  return REVERSE[pattern] ?? '?';
}

/** Normalise attendee text: upper case, only A-Z 0-9. */
export function normaliseWord(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** 'cat' -> ['-.-.', '.-', '-']. Throws on characters outside the table. */
export function wordToPatterns(word: string): string[] {
  return [...normaliseWord(word)].map((c) => {
    const p = MORSE_TABLE[c];
    if (!p) throw new Error(`No Morse for "${c}"`);
    return p;
  });
}

// ---------------------------------------------------------------------------
// Timing (PARIS standard: unit = 1200 / wpm ms)
// dit 1u, dah 3u, gap inside a letter 1u, between letters 3u, between words 7u
// ---------------------------------------------------------------------------

export const unitMsForWpm = (wpm: number): number => 1200 / wpm;
export const wpmForUnitMs = (unitMs: number): number => 1200 / unitMs;

/** Silence before the first beep so the phone has time to get ready (ms). */
export const SIGNAL_LEAD_IN_MS = 700;

export interface MorseSignal {
  /** Length of one unit in ms at this round's speed. */
  unitMs: number;
  /** Alternating durations in ms: on, off, on, off, ... starting and ending with ON. */
  segments: number[];
  /** Sum of segments. Playback finishes this long after the lead-in. */
  totalMs: number;
  /** Silence before the first beep. */
  leadInMs: number;
}

/** The on/off sequence for a word at a speed. This is all a decode round ever sends. */
export function wordToSignal(word: string, wpm: number): MorseSignal {
  const u = unitMsForWpm(wpm);
  const segments: number[] = [];
  const letters = wordToPatterns(word);
  letters.forEach((pattern, li) => {
    if (li > 0) segments.push(Math.round(3 * u)); // letter gap
    [...pattern].forEach((el, ei) => {
      if (ei > 0) segments.push(Math.round(u)); // gap inside the letter
      segments.push(Math.round(el === '.' ? u : 3 * u));
    });
  });
  return { unitMs: Math.round(u), segments, totalMs: segments.reduce((a, b) => a + b, 0), leadInMs: SIGNAL_LEAD_IN_MS };
}

/** Same thing in dit/dah units, for drawing the chart animation. */
export function patternToUnits(pattern: string): number[] {
  const out: number[] = [];
  [...pattern].forEach((el, i) => {
    if (i > 0) out.push(1);
    out.push(el === '.' ? 1 : 3);
  });
  return out;
}

// ---------------------------------------------------------------------------
// The ladder
// ---------------------------------------------------------------------------

export const MORSE_MODES = ['decode', 'encode'] as const;
export const MorseModeSchema = z.enum(MORSE_MODES);
export type MorseMode = z.infer<typeof MorseModeSchema>;

export const LEVEL_COUNT = 5;
export const LevelSchema = z.number().int().min(1).max(LEVEL_COUNT);

export interface LevelDef {
  level: number;
  title: string;
  /** Word length range (letters). */
  minLen: number;
  maxLen: number;
  /** Speed the phone plays decode rounds at. */
  decodeWpm: number;
  /** Speed we would like encode rounds sent at (speed bonus is measured against it). */
  encodeWpm: number;
  /** Points at a perfect (100) score, per mode. Lower scores pay proportionally. */
  basePoints: number;
}

export const LADDER: readonly LevelDef[] = [
  { level: 1, title: 'dit dit', minLen: 2, maxLen: 3, decodeWpm: 6, encodeWpm: 5, basePoints: 10 },
  { level: 2, title: 'getting the rhythm', minLen: 4, maxLen: 4, decodeWpm: 8, encodeWpm: 6, basePoints: 15 },
  { level: 3, title: 'dah dah dah', minLen: 5, maxLen: 5, decodeWpm: 11, encodeWpm: 8, basePoints: 20 },
  { level: 4, title: 'telegraph clerk', minLen: 6, maxLen: 6, decodeWpm: 14, encodeWpm: 10, basePoints: 30 },
  { level: 5, title: 'wire wizard', minLen: 7, maxLen: 9, decodeWpm: 18, encodeWpm: 12, basePoints: 40 },
];

export const levelDef = (level: number): LevelDef => LADDER[Math.min(LEVEL_COUNT, Math.max(1, level)) - 1] as LevelDef;

/** Bonus for clearing the whole ladder in one mode. */
export const LADDER_BONUS = 20;

/** Round time limits (ms after issue; decode adds the playback time on top). */
export const DECODE_ANSWER_MS = 60_000;
export const ENCODE_ROUND_MS = 90_000;
export const MAX_ATTEMPTS: Record<MorseMode, number> = { decode: 2, encode: 3 };

// ---------------------------------------------------------------------------
// Scoring (server decides; exported so the UI can preview and tests pin it)
// ---------------------------------------------------------------------------

/** Par time (ms) to type a decoded word after the playback ends. */
export const decodeParMs = (letters: number): number => 1500 + 900 * letters;

/** 1 = blazing, 0 = slow. Full marks at half of par or quicker, nothing at 2.5x par. */
export function decodeSpeed(elapsedAfterPlaybackMs: number, letters: number): number {
  const r = Math.max(0, elapsedAfterPlaybackMs) / decodeParMs(letters);
  return clamp01(1 - (r - 0.5) / 2);
}

/** A passed decode round scores 60..100. A miss scores 0. */
export const decodeScore = (speed: number): number => Math.round(60 + 40 * clamp01(speed));

/** speed 0..1 from the measured wpm against the level's target (1.25x target is full marks). */
export const encodeSpeed = (wpm: number, targetWpm: number): number => clamp01(wpm / targetWpm / 1.25);

/** A passed encode round scores 40..100 from rhythm (how even) and speed. */
export const encodeScore = (rhythm: number, speed: number): number => Math.round(40 + 35 * clamp01(rhythm) + 25 * clamp01(speed));

export const pointsForScore = (basePoints: number, score: number): number => Math.round((basePoints * score) / 100);

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

// ---------------------------------------------------------------------------
// Judging taps (the tolerance model)
// ---------------------------------------------------------------------------

/** One key press: ms since the FIRST press of the sequence (the first press starts at 0). */
export type Press = readonly [downMs: number, upMs: number];

/** Fastest/slowest unit we will believe a human tapping a phone: ~40 wpm down to ~3 wpm. */
export const UNIT_MIN_MS = 30;
export const UNIT_MAX_MS = 400;
/** A press shorter than this is a glitch, not a human. */
export const PRESS_MIN_MS = 15;

export type TapVerdict = 'ok' | 'wrong' | 'empty' | 'invalid' | 'too_fast' | 'too_slow' | 'robotic' | 'sloppy';

export interface PressDetail {
  /** What the server read this press as. */
  got: 'dit' | 'dah';
  /** Duration over the ideal for that kind at the attendee's own unit. 1 = perfect. */
  ratio: number;
}

export interface TapJudgement {
  verdict: TapVerdict;
  /** What the server decoded: letters, '?' for a pattern that is not a letter, ' ' for a word gap. */
  decoded: string;
  /** The attendee's own measured unit (ms) and the speed that implies. 0 when unknown. */
  unitMs: number;
  wpm: number;
  /** 0..1, how even the rhythm was relative to the attendee's own unit. */
  rhythm: number;
  /** Per expected letter: was it sent right. */
  letterOk: boolean[];
  /** Per press, for the UI to animate. */
  presses: PressDetail[];
  /** Span from first press down to last release, ms. */
  spanMs: number;
}

const EMPTY: Omit<TapJudgement, 'verdict'> = { decoded: '', unitMs: 0, wpm: 0, rhythm: 0, letterOk: [], presses: [], spanMs: 0 };

/** Letter gap / word gap boundary and the dit/dah, intra/letter boundaries, in the attendee's units. */
const DIT_DAH = 2;
const INTRA_LETTER = 2;
const LETTER_WORD = 5;
/** Below this mean log-deviation score the taps are too uneven to count even if they decode. */
const MIN_RHYTHM = 0.15;
/** Humans are never this exact. */
const SPACING_LENIENCY = 2.2;
const ROBOTIC_MAX_DEVIATION = 0.02;
const ROBOTIC_MIN_ELEMENTS = 6;

/**
 * Judge a tapped word against the expected one.
 *
 * 1. Validate shape (monotonic, plausible durations).
 * 2. Fit the attendee's own unit u: the value that best explains every press
 *    as 1u or 3u and every gap as 1u, 3u or 7u (in log space, so a slow
 *    consistent tapper is judged exactly like a fast one). If two units fit
 *    equally (e.g. a word that is all dits) prefer the one that reads as the
 *    expected word.
 * 3. Classify presses (dit < 2u <= dah) and gaps (intra < 2u <= letter < 5u <= word).
 * 4. Decode, compare to the expected word, then measure rhythm against a
 *    refined unit (median of the attendee's own dits and dahs/3).
 * 5. Reject physically implausible units (too fast / too slow) and machine
 *    perfect timing.
 *
 * It does NOT know about wall-clock time: the server separately checks that
 * the sequence could have been tapped in the time since the round began.
 */
export function judgeTaps(expectedWord: string, presses: readonly Press[]): TapJudgement {
  const expected = normaliseWord(expectedWord);
  const expectedLetters = [...expected];

  if (presses.length === 0) return { verdict: 'empty', ...EMPTY, letterOk: expectedLetters.map(() => false) };

  // 1. shape
  const durs: number[] = [];
  const gaps: number[] = [];
  let prevUp = -Infinity;
  for (const [down, up] of presses) {
    if (!Number.isFinite(down) || !Number.isFinite(up) || down < prevUp || up - down < PRESS_MIN_MS) {
      return { verdict: 'invalid', ...EMPTY, letterOk: expectedLetters.map(() => false) };
    }
    if (prevUp !== -Infinity) gaps.push(down - prevUp);
    durs.push(up - down);
    prevUp = up;
  }
  const spanMs = (presses[presses.length - 1] as Press)[1] - (presses[0] as Press)[0];

  // 2. fit the unit
  const candidates = new Set<number>();
  for (const d of durs) {
    candidates.add(clampUnit(d));
    candidates.add(clampUnit(d / 3));
  }
  const scored = [...candidates].map((u) => ({ u, score: fitScore(u, durs, gaps) }));
  scored.sort((a, b) => a.score - b.score);
  const best = scored[0] as { u: number; score: number };
  const near = scored.filter((c) => c.score <= best.score + 0.04);
  // 3 + 4. classify, decode, measure (per candidate unit, full pipeline)
  const analyse = (u0: number) => {
    let r = decodeWith(u0, durs, gaps);
    // Refine the unit from the attendee's own classified presses.
    const refinedUnit = median(r.kinds.map((k, i) => (k === 'dah' ? (durs[i] as number) / 3 : (durs[i] as number))));
    r = decodeWith(refinedUnit, durs, gaps);
    let gk: number[] = classifyGaps(refinedUnit, gaps);
    let dec = r.decoded;
    // Spacing is the hardest thing to get right on a glass screen. If every press is
    // the right dit/dah for the expected word and every gap is within 2.2x of what the
    // word wants, a slightly rushed or lazy letter gap does not make the word wrong.
    if (dec !== expected) {
      const want = expectedGapUnits(expected);
      const expectedKinds = wordToPatterns(expected).join('');
      const gotKinds = r.kinds.map((k) => (k === 'dit' ? '.' : '-')).join('');
      if (want && gotKinds === expectedKinds && gaps.every((g, i) => Math.abs(Math.log(g / ((want[i] as number) * refinedUnit))) <= Math.log(SPACING_LENIENCY))) {
        dec = expected;
        gk = want;
      }
    }
    return { decoded: dec, kinds: r.kinds, refined: refinedUnit, gapKinds: gk };
  };
  let result = analyse(best.u);
  for (const c of near) {
    const a = analyse(c.u);
    if (a.decoded === expected) {
      result = a;
      break;
    }
  }
  const { kinds, refined, gapKinds, decoded } = result;

  const detail: PressDetail[] = durs.map((d, i) => ({ got: kinds[i] as 'dit' | 'dah', ratio: round2(d / ((kinds[i] === 'dah' ? 3 : 1) * refined)) }));
  const devs: number[] = detail.map((p) => Math.abs(Math.log(p.ratio)));
  gaps.forEach((g, i) => devs.push(Math.min(1, Math.abs(Math.log(g / ((gapKinds[i] as number) * refined))))));
  const meanDev = devs.reduce((a, b) => a + b, 0) / devs.length;
  const rhythm = round2(clamp(1 - meanDev / 0.6, 0, 1));

  const decodedLetters = [...decoded];
  const letterOk = expectedLetters.map((c, i) => decodedLetters[i] === c);
  const base = { decoded, unitMs: Math.round(refined), wpm: round2(1200 / refined), rhythm, letterOk, presses: detail, spanMs };

  // 5. plausibility
  if (refined < UNIT_MIN_MS) return { verdict: 'too_fast', ...base };
  if (refined > UNIT_MAX_MS) return { verdict: 'too_slow', ...base };
  if (decoded !== expected) return { verdict: 'wrong', ...base };
  if (devs.length >= ROBOTIC_MIN_ELEMENTS && meanDev < ROBOTIC_MAX_DEVIATION && Math.max(...devs) < 0.06) return { verdict: 'robotic', ...base };
  if (rhythm < MIN_RHYTHM) return { verdict: 'sloppy', ...base };
  return { verdict: 'ok', ...base };
}

/** Ideal gap length in units after each press of the word: 1 inside a letter, 3 between letters. */
function expectedGapUnits(word: string): number[] | null {
  try {
    const out: number[] = [];
    wordToPatterns(word).forEach((p, li, all) => {
      for (let i = 0; i < p.length - 1; i++) out.push(1);
      if (li < all.length - 1) out.push(3);
    });
    return out;
  } catch {
    return null;
  }
}

function clampUnit(u: number): number {
  return Math.min(UNIT_MAX_MS * 2, Math.max(UNIT_MIN_MS / 2, u));
}

/** Lower is better. Mean capped log-distance of every press/gap to its nearest ideal length. */
function fitScore(u: number, durs: number[], gaps: number[]): number {
  let total = 0;
  for (const d of durs) total += Math.min(Math.abs(Math.log(d / u)), Math.abs(Math.log(d / (3 * u))));
  for (const g of gaps) {
    const e = Math.min(Math.abs(Math.log(g / u)), Math.abs(Math.log(g / (3 * u))), Math.abs(Math.log(g / (7 * u))));
    total += 0.5 * Math.min(1.2, e);
  }
  return total / (durs.length + 0.5 * gaps.length);
}

function classifyGaps(u: number, gaps: number[]): (1 | 3 | 7)[] {
  return gaps.map((g) => (g < INTRA_LETTER * u ? 1 : g < LETTER_WORD * u ? 3 : 7));
}

function decodeWith(u: number, durs: number[], gaps: number[]): { decoded: string; kinds: ('dit' | 'dah')[] } {
  const kinds = durs.map((d) => (d < DIT_DAH * u ? 'dit' : 'dah') as 'dit' | 'dah');
  const gk = classifyGaps(u, gaps);
  let out = '';
  let cur = '';
  kinds.forEach((k, i) => {
    cur += k === 'dit' ? '.' : '-';
    const g = gk[i]; // gap after press i
    if (g === undefined || g !== 1) {
      out += decodePattern(cur);
      cur = '';
      if (g === 7) out += ' ';
    }
  });
  return { decoded: out, kinds };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const round2 = (x: number) => Math.round(x * 100) / 100;

/** Edit distance, used for decode feedback ("so close"). */
export function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) (dp[0] as number[])[j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      (dp[i] as number[])[j] = Math.min(
        (dp[i - 1] as number[])[j]! + 1,
        (dp[i] as number[])[j - 1]! + 1,
        (dp[i - 1] as number[])[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return (dp[a.length] as number[])[b.length] as number;
}

// ---------------------------------------------------------------------------
// Wire contract
// ---------------------------------------------------------------------------

export const MORSE_MAX_PRESSES = 120;

export const PressSchema = z.tuple([z.number().int().min(0).max(300_000), z.number().int().min(0).max(300_000)]);

/** POST /api/morse/rounds */
export const StartRoundRequestSchema = z.object({
  mode: MorseModeSchema,
  level: LevelSchema,
  /** Play the organiser's running speed round instead of the ladder. Mode and level are then forced. */
  sprint: z.boolean().optional(),
});
export type StartRoundRequest = z.infer<typeof StartRoundRequestSchema>;

/** POST /api/morse/rounds/:id/guess (decode) */
export const GuessRequestSchema = z.object({ guess: z.string().min(1).max(24) });
export type GuessRequest = z.infer<typeof GuessRequestSchema>;

/** POST /api/morse/rounds/:id/taps (encode). Times are ms since the first press, client monotonic clock. */
export const TapsRequestSchema = z.object({ presses: z.array(PressSchema).min(1).max(MORSE_MAX_PRESSES) });
export type TapsRequest = z.infer<typeof TapsRequestSchema>;

export const MorseSignalSchema = z.object({
  unitMs: z.number(),
  segments: z.array(z.number().int()),
  totalMs: z.number().int(),
  leadInMs: z.number().int(),
});

export const RoundSchema = z.object({
  id: z.string(),
  mode: MorseModeSchema,
  level: LevelSchema,
  sprint: z.boolean(),
  /** Number of letters, so the UI can draw the blanks. */
  letters: z.number().int(),
  /** Encode rounds: the word to send. Decode rounds: null, never readable before submission. */
  word: z.string().nullable(),
  /** Decode rounds: what to play (beeps, flashes, buzzes). Encode rounds: null. */
  signal: MorseSignalSchema.nullable(),
  /** The speed the round plays at (decode) or hopes for (encode). */
  wpm: z.number(),
  /** Server epoch ms. Never trust the phone clock; compute offset from `serverNow`. */
  startedAt: z.number(),
  serverNow: z.number(),
  /** Hard deadline for answering. */
  expiresAt: z.number(),
  attemptsLeft: z.number().int(),
  /** Decode: epoch ms when the playback ends (speed clock starts here). */
  answerClockStartsAt: z.number().nullable(),
});
export type Round = z.infer<typeof RoundSchema>;

export const TapVerdictSchema = z.enum(['ok', 'wrong', 'empty', 'invalid', 'too_fast', 'too_slow', 'robotic', 'sloppy']);

export const RoundResultSchema = z.object({
  roundId: z.string(),
  mode: MorseModeSchema,
  level: LevelSchema,
  passed: z.boolean(),
  /** 'ok' | 'wrong' | 'too_early' | 'too_quick' | 'expired' | ... (encode uses the TapVerdict values plus 'too_quick') */
  verdict: z.string(),
  /** This attempt, 0..100 (0 on a miss). */
  score: z.number().int(),
  /** Points paid by THIS attempt (only a new personal best pays, and only the difference). */
  pointsAwarded: z.number().int(),
  bestScore: z.number().int(),
  newBest: z.boolean(),
  /** A level cleared for the first time with this attempt. */
  firstClear: z.boolean(),
  /** 0..1 */
  speed: z.number(),
  rhythm: z.number().nullable(),
  /** Encode: the attendee's own measured speed. */
  wpm: z.number().nullable(),
  /** Per letter, in order. Revealed only once the round is over. */
  letterOk: z.array(z.boolean()),
  /** Encode: what the server read from the taps. */
  decoded: z.string().nullable(),
  presses: z.array(z.object({ got: z.enum(['dit', 'dah']), ratio: z.number() })).nullable(),
  attemptsLeft: z.number().int(),
  /** Round is finished (passed, out of attempts or expired). */
  over: z.boolean(),
  /** The word, once the round is over (decode) so the phone can show "it was ...". */
  word: z.string().nullable(),
  /** Highest level playable in this mode now. */
  unlockedLevel: z.number().int(),
  /** Sprint rounds: the attendee's running sprint total after this. */
  sprintScore: z.number().int().nullable(),
  message: z.string(),
  serverNow: z.number(),
});
export type RoundResult = z.infer<typeof RoundResultSchema>;

export const LevelProgressSchema = z.object({
  level: LevelSchema,
  unlocked: z.boolean(),
  cleared: z.boolean(),
  bestScore: z.number().int(),
  bestWpm: z.number().nullable(),
  attempts: z.number().int(),
  /** How many attendees have cleared it ("143 of you cleared this"). */
  clearedByOthers: z.number().int(),
});
export type LevelProgress = z.infer<typeof LevelProgressSchema>;

export const SprintPublicSchema = z.object({
  id: z.number().int(),
  mode: MorseModeSchema,
  level: LevelSchema,
  startedAt: z.number(),
  endsAt: z.number(),
});
export type SprintPublic = z.infer<typeof SprintPublicSchema>;

export const SprintRowSchema = z.object({
  rank: z.number().int(),
  attendeeId: z.number().int(),
  nickname: z.string(),
  avatar: AvatarConfigSchema,
  score: z.number().int(),
  rounds: z.number().int(),
});
export type SprintRow = z.infer<typeof SprintRowSchema>;

export const SprintBoardSchema = z.object({
  sprint: SprintPublicSchema,
  top: z.array(SprintRowSchema),
  players: z.number().int(),
  serverNow: z.number(),
});
export type SprintBoard = z.infer<typeof SprintBoardSchema>;

/** GET /api/morse/state */
export const MorseStateSchema = z.object({
  enabled: z.boolean(),
  ladder: z.array(
    z.object({
      level: LevelSchema,
      title: z.string(),
      minLen: z.number().int(),
      maxLen: z.number().int(),
      decodeWpm: z.number(),
      encodeWpm: z.number(),
      basePoints: z.number().int(),
    }),
  ),
  decode: z.array(LevelProgressSchema),
  encode: z.array(LevelProgressSchema),
  /** Points this attendee has earned from Morse. */
  morsePoints: z.number().int(),
  /** A round still open (page refresh / app switch). Decode rounds come back with their signal again. */
  openRound: RoundSchema.nullable(),
  sprint: SprintBoardSchema.nullable(),
  /** People who have tried anything in Morse. */
  players: z.number().int(),
  serverNow: z.number(),
});
export type MorseState = z.infer<typeof MorseStateSchema>;

/** GET /api/morse/board: who is best at Morse overall (any signed-in surface). */
export const MorseBoardRowSchema = z.object({
  rank: z.number().int(),
  attendeeId: z.number().int(),
  nickname: z.string(),
  avatar: AvatarConfigSchema,
  points: z.number().int(),
  decodeCleared: z.number().int(),
  encodeCleared: z.number().int(),
  bestWpm: z.number().nullable(),
});
export type MorseBoardRow = z.infer<typeof MorseBoardRowSchema>;
export const MorseBoardSchema = z.object({
  top: z.array(MorseBoardRowSchema),
  me: MorseBoardRowSchema.nullable(),
  players: z.number().int(),
});
export type MorseBoard = z.infer<typeof MorseBoardSchema>;

export const ClearFeedItemSchema = z.object({
  nickname: z.string(),
  avatar: AvatarConfigSchema,
  mode: MorseModeSchema,
  level: LevelSchema,
  wpm: z.number().nullable(),
  score: z.number().int(),
  firstClear: z.boolean(),
  at: z.number(),
});
export type ClearFeedItem = z.infer<typeof ClearFeedItemSchema>;

/** GET /api/morse/screen (projector) and GET /api/morse/admin (console) */
export const MorseOverviewSchema = z.object({
  enabled: z.boolean(),
  players: z.number().int(),
  activeRounds: z.number().int(),
  /** Per mode, per level 1..5: how many attendees cleared it. */
  clears: z.object({ decode: z.array(z.number().int()), encode: z.array(z.number().int()) }),
  recent: z.array(ClearFeedItemSchema),
  sprint: SprintBoardSchema.nullable(),
  /** The last finished sprint, so the projector can keep showing the podium. */
  lastSprint: z.object({ sprint: SprintPublicSchema, top: z.array(SprintRowSchema) }).nullable(),
  serverNow: z.number(),
});
export type MorseOverview = z.infer<typeof MorseOverviewSchema>;

/** PUT /api/morse/admin/enabled */
export const SetEnabledRequestSchema = z.object({ enabled: z.boolean() });
/** POST /api/morse/admin/sprint */
export const StartSprintRequestSchema = z.object({
  mode: MorseModeSchema,
  level: LevelSchema,
  durationSec: z.number().int().min(30).max(600),
});
export type StartSprintRequest = z.infer<typeof StartSprintRequestSchema>;
/** POST /api/morse/admin/reset (typed confirmation, spec 5.10) */
export const MORSE_RESET_PHRASE = 'RESET MORSE';
export const ResetRequestSchema = z.object({ confirm: z.literal(MORSE_RESET_PHRASE) });

/** Sprint prizes (points). */
export const SPRINT_PRIZES = { first: 30, second: 20, third: 10, played: 5 } as const;

declare module '../live' {
  interface LiveEvents {
    /** To everyone: the console switched Morse on/off, or a speed round started/ended. */
    'morse.state': { enabled: boolean; sprint: SprintPublic | null };
    /** To projector and console: someone cleared a level (or beat their best). Drives the feed. */
    'morse.cleared': ClearFeedItem;
    /** To everyone, ~1/s while a speed round runs: live top 5. */
    'morse.sprint-board': SprintBoard;
    /** To everyone: speed round finished, final podium (top 10). */
    'morse.sprint-ended': { sprint: SprintPublic; top: SprintRow[]; players: number };
  }
}
