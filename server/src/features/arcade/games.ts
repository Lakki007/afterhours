// Arcade game rules: pure functions, no db, no clock. Content comes from the run's seed so the server
// can regenerate it at submit time; scoring and plausibility bounds live here too.
import {
  ARCADE_GAMES,
  HEXBIN_QUESTIONS,
  type HexbinBase,
  type HexbinQuestion,
  MEMORY_MAX_LEVEL,
  MEMORY_PADS,
  MEMORY_SHOW_MS,
  REACTION_MIN_MS,
  REACTION_ROUNDS,
} from '@afterhours/shared/features/arcade';

/** Small fast seeded PRNG (mulberry32). Deterministic: the same seed always gives the same run. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Implausible extends Error {}

// reaction ------------------------------------------------------------------

export const reactionDelays = (seed: number): number[] => {
  const r = rng(seed);
  return Array.from({ length: REACTION_ROUNDS }, () => 1200 + Math.floor(r() * 2400));
};

/** Clients may be a little ahead of server time because of latency; reaction rounds also need UI hops between them. */
const LATENCY_SLACK_MS = 1500;

export function scoreReaction(seed: number, reactions: number[], elapsedMs: number) {
  if (reactions.length !== REACTION_ROUNDS) throw new Implausible('wrong number of rounds');
  if (reactions.some((r) => r < REACTION_MIN_MS)) throw new Implausible('faster than a human');
  const delays = reactionDelays(seed);
  const sumDelays = delays.reduce((a, b) => a + b, 0);
  const sumReact = reactions.reduce((a, b) => a + b, 0);
  // The screen cannot flip before the seeded delays have passed, so the run cannot be shorter than this.
  if (elapsedMs + LATENCY_SLACK_MS < sumDelays + sumReact) throw new Implausible('finished before the rounds could have run');
  // Identical times in every round is a script.
  if (new Set(reactions).size === 1) throw new Implausible('no human is that steady');
  const avg = Math.round(sumReact / REACTION_ROUNDS);
  return { score: Math.max(0, 1000 - avg), label: `${avg} ms`, detail: { avgMs: avg, bestMs: Math.min(...reactions) } };
}

export function reactionPoints(avgMs: number): number {
  return avgMs <= 200 ? 10 : avgMs <= 250 ? 8 : avgMs <= 300 ? 6 : avgMs <= 400 ? 4 : 2;
}

// hexbin ----------------------------------------------------------------------

const KINDS: [HexbinBase, HexbinBase][] = [
  ['bin', 'dec'],
  ['dec', 'bin'],
  ['hex', 'dec'],
  ['dec', 'hex'],
  ['hex', 'bin'],
  ['bin', 'hex'],
];
const RADIX: Record<HexbinBase, number> = { bin: 2, dec: 10, hex: 16 };

function show(value: number, base: HexbinBase, bits: number): string {
  if (base === 'bin') return `0b${value.toString(2).padStart(bits, '0')}`;
  if (base === 'hex') return `0x${value.toString(16).toUpperCase().padStart(Math.ceil(bits / 4), '0')}`;
  return String(value);
}

/** The 40 questions for a seed, easy to hard (4, 6 then 8 bit numbers), with answers. Answers never leave the server. */
export function hexbinQuestions(seed: number): { question: HexbinQuestion; answer: string }[] {
  const r = rng(seed);
  return Array.from({ length: HEXBIN_QUESTIONS }, (_, i) => {
    const bits = i < 10 ? 4 : i < 24 ? 6 : 8;
    const value = 2 + Math.floor(r() * ((1 << bits) - 2));
    const [from, to] = KINDS[Math.floor(r() * KINDS.length)] ?? KINDS[0]!;
    return { question: { i, prompt: show(value, from, bits), from, to }, answer: value.toString(RADIX[to]) };
  });
}

/** Lower-case, no prefix, no padding zeros: "0x2f", " 2F " and "02f" are all "2f". */
export function normaliseAnswer(s: string): string {
  const t = s.toLowerCase().replace(/[\s_]/g, '').replace(/^0[xb]/, '');
  const stripped = t.replace(/^0+/, '');
  return stripped === '' ? (t === '' ? '' : '0') : stripped;
}

const HEXBIN_MIN_GAP_MS = 450;
const HEXBIN_FIRST_MS = 700;

export function scoreHexbin(seed: number, answers: { a: string; t: number }[], elapsedMs: number, durationMs: number) {
  const qs = hexbinQuestions(seed);
  if (answers.length > qs.length) throw new Implausible('more answers than questions');
  let prev = 0;
  const gaps: number[] = [];
  answers.forEach((a, i) => {
    const min = i === 0 ? HEXBIN_FIRST_MS : HEXBIN_MIN_GAP_MS;
    if (a.t - prev < min) throw new Implausible('answering faster than a human can read');
    if (a.t > durationMs + 1000) throw new Implausible('answered after time ran out');
    gaps.push(a.t - prev);
    prev = a.t;
  });
  if (prev > elapsedMs + LATENCY_SLACK_MS) throw new Implausible('claims more time than has passed');
  if (gaps.length >= 13 && Math.max(...gaps.slice(1)) - Math.min(...gaps.slice(1)) < 40) throw new Implausible('no human is that steady');
  let correct = 0;
  answers.forEach((a, i) => {
    if (normaliseAnswer(a.a) === qs[i]?.answer) correct++;
  });
  const wrong = answers.length - correct;
  const avgMs = answers.length ? Math.round(prev / answers.length) : 0;
  return { score: Math.max(0, correct * 100 - wrong * 40), label: `${correct} right`, detail: { correct, wrong, answered: answers.length, avgMs } };
}

export function hexbinPoints(correct: number): number {
  return correct >= 24 ? 10 : correct >= 18 ? 8 : correct >= 12 ? 6 : correct >= 6 ? 4 : correct >= 1 ? 2 : 1;
}

// memory ----------------------------------------------------------------------

export const memorySequence = (seed: number): number[] => {
  const r = rng(seed);
  return Array.from({ length: MEMORY_MAX_LEVEL }, () => Math.floor(r() * MEMORY_PADS));
};

/** Quickest a person can watch a level of `level` pads and tap it back, given the show speed we told the client. */
export const memoryMinLevelMs = (level: number): number => Math.round(level * MEMORY_SHOW_MS * 0.85 + level * 110);

export function memoryPoints(levels: number): number {
  return levels >= 12 ? 10 : levels >= 9 ? 8 : levels >= 7 ? 6 : levels >= 5 ? 4 : levels >= 3 ? 2 : 1;
}

export const memoryLabel = (levels: number): string => `level ${levels}`;

export const GAME_DURATION = (game: keyof typeof ARCADE_GAMES): number => ARCADE_GAMES[game].durationMs;
