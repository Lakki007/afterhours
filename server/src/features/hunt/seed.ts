// Demo content: a 7 stop campus hunt for a tech afternoon, plus a believable crowd mid-hunt.
// Stickers go where `location` says; adjust the places to the real venue before printing.
import type { HuntStopInput } from '@afterhours/shared/features/hunt';
import { type FeatureContext, all, one, run } from '../../core';
import { getState, loadStops, newCode, newToken, bump, solveStop } from './engine';
import { stopOrder } from './rules';

export const DEMO_STOPS: HuntStopInput[] = [
  {
    title: 'the semicolon',
    clue: "I'm half a comma and half a full stop. Forget me and a compiler writes you twelve pages of tears. Which little key sits just right of the L?",
    answers: ['semicolon', 'semi colon'],
    hints: ['Ends a statement in C, Java and JavaScript.', 'Fun fact: in Greek, this is the question mark.'],
    reveal: 'In Greek, a semicolon is a question mark. Somewhere a student is very confused.',
    location: 'Notice board outside the club room',
    glyph: 'spark',
    color: 'lime',
    points: 10,
  },
  {
    title: 'the keyboard',
    clue: "I have keys but open no locks. I have a space but no room. You can enter but never leave. Find where a hundred of my cousins sit in rows.",
    answers: ['keyboard', 'a keyboard'],
    hints: ['You are probably not holding one right now.', 'Escape, Enter, Space. It has all three.'],
    reveal: 'QWERTY was laid out in 1873 partly so typewriter arms would jam less. Nobody changed it since.',
    location: 'Computer lab door',
    glyph: 'key',
    color: 'sky',
    points: 10,
  },
  {
    title: 'the cache',
    clue: "I remember what you asked for last so you never wait twice. I'm tiny, fast and forgetful. Go where people queue for chai, they reuse the same order all day.",
    answers: ['cache', 'cash'],
    hints: ['A computer keeps hot data close in one of these.', 'Spelled like money, means memory.'],
    reveal: 'Your CPU has caches in three levels. The chai counter has one level: the same four orders.',
    location: 'Canteen chai counter',
    glyph: 'bolt',
    color: 'tangerine',
    points: 10,
  },
  {
    title: 'the answer to everything',
    clue: 'A supercomputer once spent 7.5 million years on the Ultimate Question and answered with this number. Written in binary it is 101010. What is it in plain decimal?',
    answers: ['42', 'forty two', 'forty-two'],
    hints: ['A hitchhiker knows the answer.', 'Four tens and a couple more.'],
    reveal: '101010 in binary is 32 + 8 + 2. The universe was just doing arithmetic.',
    location: 'Staircase landing, first floor',
    glyph: 'robot',
    color: 'grape',
    points: 10,
  },
  {
    title: 'the first bug',
    clue: 'In 1947 engineers found the first literal computer bug stuck in a Harvard Mark II relay. Which insect was it?',
    answers: ['moth', 'a moth'],
    hints: ['It loves lamps.', 'Four letters, starts with M.'],
    reveal: 'They taped it into the logbook with the note: first actual case of bug being found.',
    location: 'Library entrance',
    glyph: 'ghost',
    color: 'pink',
    points: 10,
  },
  {
    title: 'the recursion',
    clue: "To understand me you must first understand me. Our club is named after what I do. What's the word?",
    answers: ['recursion', 'recurse', 'recursive'],
    hints: ['A function that calls itself is doing it.', 'Google it, and see what it suggests next.'],
    reveal: 'Recurse. Recurse. Recurse. Okay we will stop, a stack overflow is a bad look at our own event.',
    location: 'Recurse banner at the club room',
    glyph: 'wave',
    color: 'sun',
    points: 10,
  },
  {
    title: 'the cloud',
    clue: "There is no me, really. I'm just someone else's computer with better marketing. Find the humming box in the corridor that blinks all day, my physical cousin.",
    answers: ['cloud', 'the cloud'],
    hints: ['Your photos live here, apparently.', 'It rains data, not water.'],
    reveal: 'The cloud is a few million computers in a cold warehouse, hoping you keep paying.',
    location: 'Wifi router box, ground floor corridor',
    glyph: 'wave',
    color: 'sky',
    points: 10,
  },
  {
    title: 'hello, world',
    clue: 'Final stop. Every programmer starts with the same two word program. Say it, and then find the main stage to claim your finish.',
    answers: ['hello world', 'hello, world!'],
    hints: ['Two words, the second is where we all live.', 'Comma optional. Enthusiasm mandatory.'],
    reveal: 'Brian Kernighan wrote the first hello world in 1972. You just wrote your own ending.',
    location: 'Main stage next to the projector',
    glyph: 'flag',
    color: 'tangerine',
    points: 15,
  },
];

export function seedHunt(ctx: FeatureContext): void {
  if ((one<{ n: number }>(ctx.db, 'SELECT COUNT(*) AS n FROM hunt_stops')?.n ?? 0) > 0) return;
  DEMO_STOPS.forEach((raw, i) => {
    run(
      ctx.db,
      `INSERT INTO hunt_stops (position, title, clue, clue_image, answers, hints, points, glyph, color, reveal, location, token, code)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      i + 1,
      raw.title,
      raw.clue,
      JSON.stringify(raw.answers ?? []),
      JSON.stringify(raw.hints ?? []),
      raw.points ?? 10,
      raw.glyph ?? 'star',
      raw.color ?? 'tangerine',
      raw.reveal ?? '',
      raw.location ?? '',
      newToken(),
      newCode(ctx),
    );
  });
  const now = ctx.now();
  run(ctx.db, "UPDATE hunt_state SET status = 'open', opened_at = ?, title = ? WHERE id = 1", now - 45 * 60_000, 'the after hours hunt');

  // A crowd part way through, so the board and counters look alive. Demo kits AH-001..006 stay untouched.
  const crowd = all<{ id: number }>(ctx.db, "SELECT id FROM attendees WHERE profile_complete = 1 AND kit_id > 'AH-006' ORDER BY id");
  const stops = loadStops(ctx);
  const seed = getState(ctx).seed;
  crowd.forEach((a, i) => {
    if (i >= 18) return;
    // 3 finish, the rest are spread over the route.
    const progress = i < 3 ? stops.length : (i * 5) % stops.length;
    const startedMin = 40 - i;
    const startedAt = now - startedMin * 60_000;
    run(ctx.db, 'INSERT INTO hunt_players (attendee_id, started_at, last_at) VALUES (?, ?, ?)', a.id, startedAt, startedAt);
    const order = stopOrder(seed, a.id, stops.map((s) => s.id));
    const per = i < 3 ? (14 + i * 5) / stops.length : 4;
    for (let k = 0; k < progress; k++) {
      const stop = stops.find((s) => s.id === order[k]);
      if (stop) solveStop(ctx, a.id, stop, k % 3 === 0 ? 'qr' : 'answer', startedAt + Math.round((k + 1) * per * 60_000));
    }
  });
  bump(ctx);
}
