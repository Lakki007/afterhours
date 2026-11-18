// Demo content for a KMIT tech-club afternoon. Everything lands as a draft so
// the organiser launches them from the console in whatever order the day wants.
import type { PollDefinitionInput } from '@afterhours/shared/features/polls';
import { PollDefinitionSchema } from '@afterhours/shared/features/polls';
import { type FeatureContext, one } from '../../core';
import { createPoll } from './service';

const o = (label: string, emoji?: string) => (emoji ? { label, emoji } : { label });

export const SEED_POLLS: PollDefinitionInput[] = [
  {
    kind: 'single',
    question: 'your debugging weapon of choice?',
    options: [o('console.log everywhere', '📣'), o('a real debugger', '🔬'), o('explain it to a rubber duck', '🦆'), o('rewrite it and pray', '🙏'), o('paste it into chatgpt', '🤖')],
  },
  { kind: 'this_or_that', question: 'tabs or spaces?', options: [o('tabs', '↹'), o('spaces', '␣')] },
  { kind: 'this_or_that', question: 'dark mode or light mode?', options: [o('dark mode', '🌙'), o('light mode (brave)', '☀️')] },
  {
    kind: 'multi',
    question: 'things you have done at 3am for a deadline (pick up to 3)',
    maxChoices: 3,
    options: [
      o('pushed straight to main'),
      o('fixed it by deleting the test'),
      o('learned a framework overnight'),
      o('blamed the wifi'),
      o('commit message: "final final v2"'),
      o('ate maggi at your desk'),
    ],
  },
  {
    kind: 'rating',
    question: 'how cooked is your semester?',
    scale: { min: 1, max: 10, style: 'slider', lowLabel: 'chilling', highLabel: 'cooked' },
  },
  { kind: 'wordcloud', question: 'one word for placement season', maxWords: 1 },
  { kind: 'wordcloud', question: 'one word for the afternoon so far', maxWords: 1 },
  { kind: 'wordcloud', question: 'name your dream side project in up to 3 words', maxWords: 3 },
  {
    kind: 'single',
    question: 'the correct crunch-time fuel?',
    options: [o('irani chai + osmania biscuit', '☕'), o('canteen samosa', '🥟'), o('maggi at midnight', '🍜'), o('biryani, obviously', '🍛')],
  },
  {
    kind: 'rating',
    question: 'rate this afternoon so far',
    scale: { min: 1, max: 5, style: 'emoji', lowLabel: 'mid', highLabel: 'peak' },
  },
  {
    kind: 'multi',
    question: 'languages you would refuse to write on a weekend (pick up to 2)',
    maxChoices: 2,
    options: [o('C++'), o('Java'), o('JavaScript'), o('PHP'), o('Perl'), o('COBOL')],
  },
];

// Quiz: 7 questions, 20 s each, 20 base + up to 20 speed bonus. Correct answers are spread across slots.
const quiz = (question: string, answers: string[], correct: number): PollDefinitionInput => ({
  kind: 'quiz',
  question,
  options: answers.map((a) => o(a)),
  correct,
  durationMs: 20_000,
  basePoints: 20,
  speedBonusMax: 20,
  series: 'afterhours-quiz',
});

export const SEED_QUIZ: PollDefinitionInput[] = [
  quiz('what does HTTP status 418 mean?', ['not found', 'i am a teapot', 'payment required', 'bad gateway'], 1),
  quiz('in binary, what is 1010 in decimal?', ['6', '12', '8', '10'], 3),
  quiz('who created both Linux and Git?', ['Linus Torvalds', 'Guido van Rossum', 'Dennis Ritchie', 'Bjarne Stroustrup'], 0),
  quiz('the S in HTTPS stands for?', ['simple', 'secure', 'server', 'speedy'], 1),
  quiz('which of these is NOT a JavaScript framework or library?', ['React', 'Svelte', 'Flask', 'Vue'], 2),
  quiz('the first literal computer "bug" (1947, Harvard Mark II) was a?', ['ant', 'spider', 'moth', 'beetle'], 2),
  quiz('binary search on a sorted list of n items takes?', ['O(n)', 'O(log n)', 'O(n squared)', 'O(1)'], 1),
];

/** Idempotent: does nothing if there are already polls. */
export function seedPolls(ctx: FeatureContext): void {
  if ((one<{ n: number }>(ctx.db, 'SELECT COUNT(*) AS n FROM polls')?.n ?? 0) > 0) return;
  for (const def of [...SEED_POLLS, ...SEED_QUIZ]) createPoll(ctx, PollDefinitionSchema.parse(def));
}
