// Polls: row mapping, tallies and views. Pure data access, no HTTP, no publishing.
//
// SECRECY RULE: `correct_option` is only ever read through toPublic() with
// showAnswer=true (console) or for a revealed poll. Nothing else selects it.
import { AvatarConfigSchema, DEFAULT_AVATAR } from '@afterhours/shared';
import {
  POLL_LIMITS,
  type PollKind,
  type PollOption,
  type PollResults,
  type PollStatus,
  type PollView,
  type PublicPoll,
  type QuizBoardEntry,
  type QuizResult,
  type RatingScale,
  type VoteRequest,
} from '@afterhours/shared/features/polls';
import { type Db, all, one } from '../../core';

export interface PollRow {
  id: number;
  kind: PollKind;
  question: string;
  config: string;
  correct_option: number | null;
  status: PollStatus;
  position: number;
  series: string | null;
  created_at: number;
  opened_at: number | null;
  starts_at: number | null;
  deadline_at: number | null;
  closed_at: number | null;
  revealed_at: number | null;
}

export const POLL_COLUMNS =
  'id, kind, question, config, correct_option, status, position, series, created_at, opened_at, starts_at, deadline_at, closed_at, revealed_at';

export function getRow(db: Db, id: number): PollRow | undefined {
  return one<PollRow>(db, `SELECT ${POLL_COLUMNS} FROM polls WHERE id = ?`, id);
}

export function liveRow(db: Db): PollRow | undefined {
  return one<PollRow>(db, `SELECT ${POLL_COLUMNS} FROM polls WHERE status = 'live'`);
}

/** The poll the home screen / projector should talk about: live, else the latest finished. */
export function currentRow(db: Db): PollRow | undefined {
  return (
    liveRow(db) ??
    one<PollRow>(
      db,
      `SELECT ${POLL_COLUMNS} FROM polls WHERE status IN ('closed', 'revealed')
       ORDER BY COALESCE(revealed_at, closed_at) DESC, id DESC LIMIT 1`,
    )
  );
}

export function voterCount(db: Db, pollId: number): number {
  return one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM poll_votes WHERE poll_id = ?', pollId)?.n ?? 0;
}

// ---- public shape ----------------------------------------------------------

export function toPublic(row: PollRow, showAnswer: boolean): PublicPoll {
  const base = {
    id: row.id,
    question: row.question,
    status: row.status,
    position: row.position,
    openedAt: row.opened_at,
    startsAt: row.starts_at,
    deadlineAt: row.deadline_at,
    closedAt: row.closed_at,
    revealedAt: row.revealed_at,
  };
  const cfg: unknown = JSON.parse(row.config);
  switch (row.kind) {
    case 'single':
      return { ...base, kind: 'single', options: (cfg as { options: PollOption[] }).options };
    case 'multi': {
      const c = cfg as { options: PollOption[]; maxChoices: number };
      return { ...base, kind: 'multi', options: c.options, maxChoices: c.maxChoices };
    }
    case 'this_or_that': {
      const o = (cfg as { options: [PollOption, PollOption] }).options;
      return { ...base, kind: 'this_or_that', options: [o[0], o[1]] };
    }
    case 'rating':
      return { ...base, kind: 'rating', scale: (cfg as { scale: RatingScale }).scale };
    case 'wordcloud':
      return { ...base, kind: 'wordcloud', maxWords: (cfg as { maxWords: number }).maxWords, maxLen: POLL_LIMITS.wordMaxLen };
    case 'quiz': {
      const c = cfg as { options: PollOption[]; durationMs: number; basePoints: number; speedBonusMax: number };
      return {
        ...base,
        kind: 'quiz',
        options: c.options,
        durationMs: c.durationMs,
        basePoints: c.basePoints,
        speedBonusMax: c.speedBonusMax,
        series: row.series ?? 'quiz',
        correct: showAnswer || row.status === 'revealed' ? row.correct_option : null,
      };
    }
  }
}

export function optionCount(row: PollRow): number {
  const cfg = JSON.parse(row.config) as { options?: unknown[] };
  return cfg.options?.length ?? 0;
}

// ---- tallies ---------------------------------------------------------------

/**
 * Running counts for one poll. The live poll keeps one in memory and updates
 * it per vote in O(1) (no rescanning 300 rows 300 times); any other poll gets
 * one built from the database on demand.
 */
export interface Tally {
  pollId: number;
  kind: PollKind;
  voters: number;
  /** choice kinds and quiz: per option. */
  counts: number[];
  /** rating: per value, index = value - min. */
  histogram: number[];
  ratingSum: number;
  ratingMin: number;
  ratingMax: number;
  /** word cloud: normalised word -> people. */
  words: Map<string, number>;
  hidden: Set<string>;
  /** Memoised sorted words; invalidated on change, rebuilt at most every WORDS_TTL_MS. */
  wordsCache: { at: number; list: { word: string; count: number }[] } | null;
}

export function emptyTally(row: PollRow): Tally {
  const cfg = JSON.parse(row.config) as { options?: unknown[]; scale?: RatingScale };
  const min = cfg.scale?.min ?? 1;
  const max = cfg.scale?.max ?? 5;
  return {
    pollId: row.id,
    kind: row.kind,
    voters: 0,
    counts: new Array<number>(cfg.options?.length ?? 0).fill(0),
    histogram: row.kind === 'rating' ? new Array<number>(max - min + 1).fill(0) : [],
    ratingSum: 0,
    ratingMin: min,
    ratingMax: max,
    words: new Map(),
    hidden: new Set(),
    wordsCache: null,
  };
}

export function tallyAdd(t: Tally, v: { choice: number | null; value: number | null; items: string[] }): void {
  t.voters++;
  switch (t.kind) {
    case 'single':
    case 'this_or_that':
    case 'quiz':
      if (v.choice !== null && t.counts[v.choice] !== undefined) t.counts[v.choice]!++;
      break;
    case 'multi':
      for (const it of v.items) {
        const i = Number(it);
        if (t.counts[i] !== undefined) t.counts[i]!++;
      }
      break;
    case 'rating':
      if (v.value !== null) {
        t.ratingSum += v.value;
        const i = v.value - t.ratingMin;
        if (t.histogram[i] !== undefined) t.histogram[i]!++;
      }
      break;
    case 'wordcloud':
      for (const w of v.items) t.words.set(w, (t.words.get(w) ?? 0) + 1);
      t.wordsCache = null;
      break;
  }
}

export function buildTally(db: Db, row: PollRow): Tally {
  const t = emptyTally(row);
  const votes = all<{ attendee_id: number; choice: number | null; value: number | null }>(
    db,
    'SELECT attendee_id, choice, value FROM poll_votes WHERE poll_id = ?',
    row.id,
  );
  t.voters = votes.length;
  if (row.kind === 'multi' || row.kind === 'wordcloud') {
    const items = all<{ item: string; n: number }>(db, 'SELECT item, COUNT(*) AS n FROM poll_vote_items WHERE poll_id = ? GROUP BY item', row.id);
    for (const { item, n } of items) {
      if (row.kind === 'multi') {
        if (t.counts[Number(item)] !== undefined) t.counts[Number(item)] = n;
      } else t.words.set(item, n);
    }
  } else {
    for (const v of votes) tallyAdd(t, { choice: v.choice, value: v.value, items: [] });
    t.voters = votes.length;
  }
  for (const h of all<{ word: string }>(db, 'SELECT word FROM poll_hidden_words WHERE poll_id = ?', row.id)) t.hidden.add(h.word);
  return t;
}

const WORDS_TTL_MS = 250;
const TOP_WORDS = 60;

export function topWords(t: Tally, now: number, includeHidden = false): { word: string; count: number }[] {
  if (!includeHidden && t.wordsCache && now - t.wordsCache.at < WORDS_TTL_MS) return t.wordsCache.list;
  const list: { word: string; count: number }[] = [];
  for (const [word, count] of t.words) if (includeHidden || !t.hidden.has(word)) list.push({ word, count });
  list.sort((a, b) => b.count - a.count || (a.word < b.word ? -1 : 1));
  const top = includeHidden ? list : list.slice(0, TOP_WORDS);
  if (!includeHidden) t.wordsCache = { at: now, list: top };
  return top;
}

/** Quiz numbers only the reveal may show. */
function quizRevealStats(db: Db, row: PollRow): { right: number; medianRightMs: number | null } {
  const times = all<{ elapsed_ms: number }>(
    db,
    'SELECT elapsed_ms FROM poll_votes WHERE poll_id = ? AND correct = 1 ORDER BY elapsed_ms',
    row.id,
  ).map((r) => r.elapsed_ms);
  const mid = Math.floor(times.length / 2);
  const median = times.length === 0 ? null : times.length % 2 ? (times[mid] ?? 0) : ((times[mid - 1] ?? 0) + (times[mid] ?? 0)) / 2;
  return { right: times.length, medianRightMs: median };
}

/**
 * What everyone may see. A running or closed quiz yields only the answered
 * count; its distribution and correct answer wait for the reveal.
 */
export function resultsOf(db: Db, row: PollRow, t: Tally, now: number): PollResults {
  switch (row.kind) {
    case 'single':
    case 'multi':
    case 'this_or_that':
      return { kind: row.kind, total: t.voters, counts: [...t.counts] };
    case 'rating':
      return {
        kind: 'rating',
        total: t.voters,
        average: t.voters === 0 ? null : Math.round((t.ratingSum / t.voters) * 100) / 100,
        histogram: [...t.histogram],
        min: t.ratingMin,
        max: t.ratingMax,
      };
    case 'wordcloud':
      return { kind: 'wordcloud', total: t.voters, words: topWords(t, now) };
    case 'quiz': {
      if (row.status !== 'revealed' || row.correct_option === null) return { kind: 'quiz', revealed: false, total: t.voters };
      const s = quizRevealStats(db, row);
      return { kind: 'quiz', revealed: true, total: t.voters, counts: [...t.counts], correct: row.correct_option, ...s };
    }
  }
}

// ---- my vote / views ---------------------------------------------------------

export function myVoteOf(db: Db, row: PollRow, attendeeId: number): VoteRequest | null {
  const v = one<{ choice: number | null; value: number | null }>(
    db,
    'SELECT choice, value FROM poll_votes WHERE poll_id = ? AND attendee_id = ?',
    row.id,
    attendeeId,
  );
  if (!v) return null;
  switch (row.kind) {
    case 'single':
      return { kind: 'single', choice: v.choice ?? 0 };
    case 'quiz':
      return { kind: 'quiz', choice: v.choice ?? 0 };
    case 'this_or_that':
      return { kind: 'this_or_that', choice: v.choice === 1 ? 1 : 0 };
    case 'rating':
      return { kind: 'rating', value: v.value ?? 1 };
    case 'multi':
    case 'wordcloud': {
      const items = all<{ item: string }>(
        db,
        'SELECT item FROM poll_vote_items WHERE poll_id = ? AND attendee_id = ? ORDER BY item',
        row.id,
        attendeeId,
      ).map((r) => r.item);
      return row.kind === 'multi' ? { kind: 'multi', choices: items.map(Number) } : { kind: 'wordcloud', words: items };
    }
  }
}

export function myQuizOf(db: Db, row: PollRow, attendeeId: number): QuizResult | null {
  if (row.kind !== 'quiz' || row.status !== 'revealed') return null;
  const v = one<{ choice: number; correct: number; points: number; speed_bonus: number; elapsed_ms: number }>(
    db,
    'SELECT choice, correct, points, speed_bonus, elapsed_ms FROM poll_votes WHERE poll_id = ? AND attendee_id = ?',
    row.id,
    attendeeId,
  );
  if (!v) return null;
  return { pollId: row.id, choice: v.choice, correct: v.correct === 1, points: v.points, speedBonus: v.speed_bonus, elapsedMs: v.elapsed_ms };
}

/**
 * A viewer sees results once they have voted (not for a running quiz) or the
 * poll is revealed. `tally` is passed in so the live poll uses its memory.
 */
export function viewFor(db: Db, row: PollRow, tally: Tally, attendeeId: number | null, now: number): PollView {
  const myVote = attendeeId === null ? null : myVoteOf(db, row, attendeeId);
  const mayLook = row.status === 'revealed' || (myVote !== null && row.kind !== 'quiz');
  return {
    serverNow: now,
    poll: toPublic(row, false),
    myVote,
    results: mayLook ? resultsOf(db, row, tally, now) : null,
    myQuiz: attendeeId === null ? null : myQuizOf(db, row, attendeeId),
    voters: tally.voters,
  };
}

// ---- quiz scoreboard ---------------------------------------------------------

export function boardOf(db: Db, series: string, limit = 10): QuizBoardEntry[] {
  const rows = all<{ attendee_id: number; nickname: string | null; avatar: string | null; pts: number; n_right: number }>(
    db,
    `SELECT v.attendee_id, a.nickname, a.avatar, SUM(v.points) AS pts, SUM(v.correct) AS n_right
       FROM poll_votes v
       JOIN polls p ON p.id = v.poll_id AND p.kind = 'quiz' AND p.status = 'revealed' AND p.series = ?
       JOIN attendees a ON a.id = v.attendee_id
      GROUP BY v.attendee_id
     HAVING pts > 0
      ORDER BY pts DESC, SUM(CASE WHEN v.correct = 1 THEN v.elapsed_ms ELSE 0 END) ASC, v.attendee_id ASC
      LIMIT ?`,
    series,
    limit,
  );
  return rows.map((r, i) => {
    let avatar = DEFAULT_AVATAR;
    if (r.avatar) {
      try {
        const parsed = AvatarConfigSchema.safeParse(JSON.parse(r.avatar));
        if (parsed.success) avatar = parsed.data;
      } catch {
        /* keep default */
      }
    }
    return { rank: i + 1, attendeeId: r.attendee_id, nickname: r.nickname ?? 'someone', avatar, points: r.pts, correct: r.n_right };
  });
}
