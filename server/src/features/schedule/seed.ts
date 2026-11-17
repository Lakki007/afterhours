// A believable After Hours afternoon: 21 Nov 2026, 2 pm to 7 pm IST, three highlights.
import type { ActivityInput } from '@afterhours/shared/features/schedule';
import { type FeatureContext, one, run } from '../../core';

const IST_OFFSET_MS = 5.5 * 3_600_000;

/** Epoch ms for h:mm IST on the event date (YYYY-MM-DD). */
export function istOn(date: string, hhmm: string): number {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return Date.UTC(y, mo - 1, d, h, m) - IST_OFFSET_MS;
}

type Demo = Omit<ActivityInput, 'startAt' | 'endAt'> & { from: string; to: string };

export const DEMO_AFTERNOON: Demo[] = [
  { from: '14:00', to: '14:20', title: 'doors open + kit desk', kind: 'other', location: 'main atrium', link: null, highlight: false, blurb: 'grab your entry kit, sign in, pick a face. chai is already out.' },
  { from: '14:20', to: '14:35', title: 'welcome to after hours', kind: 'talk', location: 'seminar hall', link: null, highlight: false, blurb: 'what recurse is up to this semester, and the rules of the afternoon. five minutes, promise.' },
  { from: '14:35', to: '15:15', title: 'what actually happens when you type a url', kind: 'talk', location: 'seminar hall', link: null, highlight: false, blurb: 'dns, tcp, tls, a cdn and a very tired load balancer. live demo, so expect a fail or two.' },
  { from: '15:15', to: '15:30', title: 'chai + arcade break', kind: 'game', location: 'atrium', link: '/arcade', highlight: false, blurb: 'beat the binary game before the biscuits run out. scores count toward the leaderboard.' },
  { from: '15:30', to: '16:00', title: 'hot takes: the big poll', kind: 'poll', location: 'seminar hall', link: '/polls', highlight: true, blurb: 'tabs vs spaces, vim vs everyone, and a quiz where speed pays. phones out, please.' },
  { from: '16:00', to: '16:40', title: 'debugging at 2 am: club war stories', kind: 'talk', location: 'seminar hall', link: null, highlight: false, blurb: 'three seniors, three outages they caused, zero blame. questions welcome.' },
  { from: '16:40', to: '17:00', title: 'arcade break', kind: 'break', location: 'atrium', link: '/arcade', highlight: false, blurb: 'reaction time, hex speed, memory grid. under a minute a run.' },
  { from: '17:00', to: '17:45', title: 'the treasure hunt', kind: 'hunt', location: 'whole campus', link: '/hunt', highlight: true, blurb: 'qr stickers are hiding in plain sight. your clue order is yours alone. first finishers get bonus points.' },
  { from: '17:45', to: '18:15', title: 'morse challenge', kind: 'morse', location: 'seminar hall', link: '/morse', highlight: false, blurb: 'decode it by ear, then tap it back on the telegraph key. headphones optional, nerve required.' },
  { from: '18:15', to: '18:30', title: 'snacks + last arcade scores', kind: 'break', location: 'atrium', link: '/arcade', highlight: false, blurb: 'last chance to climb before the reveal.' },
  { from: '18:30', to: '19:00', title: 'leaderboard reveal + wrap', kind: 'other', location: 'seminar hall', link: '/leaderboard', highlight: true, blurb: 'who ruled the afternoon. stickers, bragging rights, and a group photo.' },
];

/** Insert the demo afternoon if the schedule is empty. Safe to call twice. */
export function insertDemo(ctx: FeatureContext, force = false): number {
  const n = one<{ n: number }>(ctx.db, 'SELECT COUNT(*) AS n FROM schedule_activities')?.n ?? 0;
  if (n > 0 && !force) return 0;
  const now = ctx.now();
  for (const a of DEMO_AFTERNOON) {
    const start = istOn(ctx.config.eventDate, a.from);
    run(
      ctx.db,
      `INSERT INTO schedule_activities (title, blurb, location, kind, highlight, link, start_at, end_at, planned_start_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      a.title,
      a.blurb ?? '',
      a.location ?? '',
      a.kind ?? 'other',
      a.highlight ? 1 : 0,
      a.link ?? null,
      start,
      istOn(ctx.config.eventDate, a.to),
      start,
      now,
      now,
    );
  }
  return DEMO_AFTERNOON.length;
}
