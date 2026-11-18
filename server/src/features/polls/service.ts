// Polls: lifecycle, voting and live publishing.
import {
  POLL_LIMITS,
  type PollDefinition,
  type PollView,
  type PublicPoll,
  type QuizResult,
  type VoteRequest,
  type VoteResponse,
} from '@afterhours/shared/features/polls';
import { type FeatureContext, HttpError, RateLimiter, all, badRequest, conflict, notFound, one, run, tx } from '../../core';
import {
  POLL_COLUMNS,
  type PollRow,
  type Tally,
  boardOf,
  buildTally,
  emptyTally,
  getRow,
  liveRow,
  optionCount,
  resultsOf,
  tallyAdd,
  toPublic,
  topWords,
  viewFor,
  voterCount,
} from './store';
import { WORD_REASON_MESSAGE, checkWord, normaliseForHide } from './words';

/** Points for simply taking part in a non-quiz poll (or answering a quiz wrong). */
export const PARTICIPATION_POINTS = 2;
/** Voting in this many polls earns the "opinionated" sticker. */
export const REGULAR_VOTES = 4;
/** A correct answer inside this share of the clock earns "lightning". */
export const LIGHTNING_SHARE = 0.25;

interface State {
  limiter: RateLimiter;
  /** In-memory tally of the live poll. */
  tally: Tally | null;
  /** Results changed since the last broadcast. */
  dirty: boolean;
}

// One state per running app (tests build several apps in one process).
const states = new WeakMap<FeatureContext, State>();
export function state(ctx: FeatureContext): State {
  let s = states.get(ctx);
  if (!s) {
    // A person gets one vote per poll; this only stops scripted hammering.
    s = { limiter: new RateLimiter({ limit: 8, windowMs: 10_000, now: ctx.now }), tally: null, dirty: false };
    states.set(ctx, s);
  }
  return s;
}

/** The tally for any poll: the live one from memory, others built from the database. */
export function tallyFor(ctx: FeatureContext, row: PollRow): Tally {
  const s = state(ctx);
  if (row.status === 'live') {
    if (!s.tally || s.tally.pollId !== row.id) s.tally = buildTally(ctx.db, row);
    return s.tally;
  }
  return buildTally(ctx.db, row);
}

const changed = (ctx: FeatureContext) => ctx.live.publish('polls.changed', { at: ctx.now() }, 'admins');

// ---- authoring -------------------------------------------------------------------

function splitDefinition(def: PollDefinition): { config: unknown; correct: number | null; series: string | null } {
  switch (def.kind) {
    case 'single':
    case 'this_or_that':
      return { config: { options: def.options }, correct: null, series: null };
    case 'multi':
      return { config: { options: def.options, maxChoices: def.maxChoices }, correct: null, series: null };
    case 'rating':
      return { config: { scale: def.scale }, correct: null, series: null };
    case 'wordcloud':
      return { config: { maxWords: def.maxWords }, correct: null, series: null };
    case 'quiz':
      return {
        config: { options: def.options, durationMs: def.durationMs, basePoints: def.basePoints, speedBonusMax: def.speedBonusMax },
        correct: def.correct,
        series: def.series,
      };
  }
}

export function createPoll(ctx: FeatureContext, def: PollDefinition): PollRow {
  const { config, correct, series } = splitDefinition(def);
  const pos = (one<{ p: number | null }>(ctx.db, 'SELECT MAX(position) AS p FROM polls')?.p ?? 0) + 1;
  const r = run(
    ctx.db,
    `INSERT INTO polls (kind, question, config, correct_option, status, position, series, created_at)
     VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)`,
    def.kind,
    def.question,
    JSON.stringify(config),
    correct,
    pos,
    series,
    ctx.now(),
  );
  changed(ctx);
  const row = getRow(ctx.db, r.lastId);
  if (!row) throw new Error('poll vanished after insert');
  return row;
}

export function updatePoll(ctx: FeatureContext, id: number, def: PollDefinition): PollRow {
  const row = getRow(ctx.db, id);
  if (!row) throw notFound('No such poll.');
  if (row.status !== 'draft') throw conflict('Only drafts can be edited. Reset it to draft first if you must.');
  const { config, correct, series } = splitDefinition(def);
  run(
    ctx.db,
    'UPDATE polls SET kind = ?, question = ?, config = ?, correct_option = ?, series = ? WHERE id = ?',
    def.kind,
    def.question,
    JSON.stringify(config),
    correct,
    series,
    id,
  );
  changed(ctx);
  return getRow(ctx.db, id) ?? row;
}

export function deletePoll(ctx: FeatureContext, id: number): void {
  const row = getRow(ctx.db, id);
  if (!row) throw notFound('No such poll.');
  if (row.status === 'live') throw conflict('Close it before deleting.');
  run(ctx.db, 'DELETE FROM poll_votes WHERE poll_id = ?', id);
  run(ctx.db, 'DELETE FROM poll_vote_items WHERE poll_id = ?', id);
  run(ctx.db, 'DELETE FROM poll_hidden_words WHERE poll_id = ?', id);
  run(ctx.db, 'DELETE FROM polls WHERE id = ?', id);
  changed(ctx);
}

export function reorderPolls(ctx: FeatureContext, ids: number[]): void {
  tx(ctx.db, () => {
    ids.forEach((id, i) => run(ctx.db, 'UPDATE polls SET position = ? WHERE id = ?', i + 1, id));
    // Anything not mentioned keeps its relative order after the listed ones.
    const rest = all<{ id: number }>(ctx.db, `SELECT id FROM polls WHERE id NOT IN (${ids.map(() => '?').join(',')}) ORDER BY position, id`, ...ids);
    rest.forEach((r, i) => run(ctx.db, 'UPDATE polls SET position = ? WHERE id = ?', ids.length + i + 1, r.id));
  });
  changed(ctx);
}

/** Wipe votes and put a not-yet-revealed poll back to draft (rehearsals). */
export function resetPoll(ctx: FeatureContext, id: number): PollRow {
  const row = getRow(ctx.db, id);
  if (!row) throw notFound('No such poll.');
  if (row.status === 'live') throw conflict('Close it first.');
  if (row.status === 'revealed') throw conflict('Already revealed and points were paid out. It cannot be reset.');
  tx(ctx.db, () => {
    run(ctx.db, 'DELETE FROM poll_votes WHERE poll_id = ?', id);
    run(ctx.db, 'DELETE FROM poll_vote_items WHERE poll_id = ?', id);
    run(ctx.db, 'DELETE FROM poll_hidden_words WHERE poll_id = ?', id);
    run(
      ctx.db,
      "UPDATE polls SET status = 'draft', opened_at = NULL, starts_at = NULL, deadline_at = NULL, closed_at = NULL, revealed_at = NULL WHERE id = ?",
      id,
    );
  });
  changed(ctx);
  return getRow(ctx.db, id) ?? row;
}

// ---- lifecycle ---------------------------------------------------------------------

export function launchPoll(ctx: FeatureContext, id: number, closeCurrent: boolean): PollRow {
  const row = getRow(ctx.db, id);
  if (!row) throw notFound('No such poll.');
  if (row.status !== 'draft') throw conflict(`That poll is already ${row.status}.`);
  const live = liveRow(ctx.db);
  if (live) {
    if (!closeCurrent) throw conflict(`"${live.question}" is still live. Close it first.`);
    closePoll(ctx, live.id, false);
  }
  const now = ctx.now();
  const quiz = row.kind === 'quiz';
  const cfg = JSON.parse(row.config) as { durationMs?: number };
  const startsAt = quiz ? now + POLL_LIMITS.quizLeadInMs : now;
  const deadlineAt = quiz ? startsAt + (cfg.durationMs ?? 20_000) : null;
  run(
    ctx.db,
    "UPDATE polls SET status = 'live', opened_at = ?, starts_at = ?, deadline_at = ? WHERE id = ? AND status = 'draft'",
    now,
    startsAt,
    deadlineAt,
    id,
  );
  const s = state(ctx);
  const fresh = getRow(ctx.db, id) ?? row;
  s.tally = emptyTally(fresh);
  s.dirty = false;
  ctx.live.publish('polls.launched', { poll: toPublic(fresh, false), startsAt, deadlineAt }, 'all');
  changed(ctx);
  return fresh;
}

/** Publish the throttled results event if anything changed. Called by the tick. */
export function flush(ctx: FeatureContext): void {
  const s = state(ctx);
  if (!s.dirty) return;
  s.dirty = false;
  const row = liveRow(ctx.db);
  if (!row) return;
  const t = tallyFor(ctx, row);
  ctx.live.publish('polls.results', { pollId: row.id, results: resultsOf(ctx.db, row, t, ctx.now()), voters: t.voters }, 'all');
}

export function closePoll(ctx: FeatureContext, id: number, auto: boolean): PollRow {
  const row = getRow(ctx.db, id);
  if (!row) throw notFound('No such poll.');
  if (row.status !== 'live') throw conflict(`That poll is ${row.status}, not live.`);
  flush(ctx); // last numbers go out before the closing bell
  const now = ctx.now();
  run(ctx.db, "UPDATE polls SET status = 'closed', closed_at = ? WHERE id = ? AND status = 'live'", now, id);
  const voters = voterCount(ctx.db, id);
  ctx.live.publish('polls.closed', { pollId: id, closedAt: now, auto, voters }, 'all');
  const s = state(ctx);
  s.dirty = false;
  changed(ctx);
  return getRow(ctx.db, id) ?? row;
}

/** Close a quiz whose clock ran out. Safe to call any time. */
export function expire(ctx: FeatureContext): void {
  const row = liveRow(ctx.db);
  if (row?.kind === 'quiz' && row.deadline_at !== null && ctx.now() > row.deadline_at + POLL_LIMITS.quizGraceMs) {
    closePoll(ctx, row.id, true);
  }
}

export function revealPoll(ctx: FeatureContext, id: number): PollRow {
  let row = getRow(ctx.db, id);
  if (!row) throw notFound('No such poll.');
  if (row.status === 'live') row = closePoll(ctx, id, false);
  if (row.status !== 'closed') throw conflict(`That poll is ${row.status}; only a closed poll can be revealed.`);
  run(ctx.db, "UPDATE polls SET status = 'revealed', revealed_at = ? WHERE id = ? AND status = 'closed'", ctx.now(), id);
  const revealed = getRow(ctx.db, id) ?? row;
  const t = tallyFor(ctx, revealed);
  const board = revealed.kind === 'quiz' ? boardOf(ctx.db, revealed.series ?? 'quiz') : null;
  // Revealed first, personal results and points after, so phones flip to the reveal before toasts pop.
  ctx.live.publish('polls.revealed', { poll: toPublic(revealed, false), results: resultsOf(ctx.db, revealed, t, ctx.now()), board }, 'all');
  if (revealed.kind === 'quiz') payOutQuiz(ctx, revealed, false);
  changed(ctx);
  return revealed;
}

interface QuizVoteRow {
  attendee_id: number;
  choice: number;
  correct: number;
  points: number;
  speed_bonus: number;
  elapsed_ms: number;
}

/**
 * Pay a revealed quiz out. Idempotent (points and stickers are keyed), so the
 * boot reconcile can call it again with silent=true after a crash.
 */
export function payOutQuiz(ctx: FeatureContext, row: PollRow, silent: boolean): void {
  const cfg = JSON.parse(row.config) as { durationMs: number };
  const votes = all<QuizVoteRow>(
    ctx.db,
    'SELECT attendee_id, choice, correct, points, speed_bonus, elapsed_ms FROM poll_votes WHERE poll_id = ?',
    row.id,
  );
  const label = `quiz: ${row.question.slice(0, 40)}`;
  for (const v of votes) {
    if (v.correct === 1) {
      ctx.points.award({ attendeeId: v.attendee_id, source: 'polls.quiz', ref: String(row.id), points: v.points, label });
      ctx.stickers.unlock(v.attendee_id, 'polls-quiz-whiz');
      if (v.elapsed_ms <= cfg.durationMs * LIGHTNING_SHARE) ctx.stickers.unlock(v.attendee_id, 'polls-lightning');
    } else {
      ctx.points.award({ attendeeId: v.attendee_id, source: 'polls', ref: `vote:${row.id}`, points: PARTICIPATION_POINTS, label: 'had a go at the quiz' });
    }
    if (!silent) {
      const result: QuizResult = {
        pollId: row.id,
        choice: v.choice,
        correct: v.correct === 1,
        points: v.points,
        speedBonus: v.speed_bonus,
        elapsedMs: v.elapsed_ms,
      };
      ctx.live.publish('polls.quiz-result', result, { attendeeId: v.attendee_id });
    }
  }
}

/** Boot: make sure every revealed quiz was paid (covers a crash between reveal and payout). */
export function reconcileQuizPayouts(ctx: FeatureContext): void {
  for (const row of all<PollRow>(ctx.db, `SELECT ${POLL_COLUMNS} FROM polls WHERE kind = 'quiz' AND status = 'revealed'`)) {
    payOutQuiz(ctx, row, true);
  }
}

// ---- word hiding ------------------------------------------------------------------

export function setWordHidden(ctx: FeatureContext, id: number, rawWord: string, hide: boolean): void {
  const row = getRow(ctx.db, id);
  if (!row) throw notFound('No such poll.');
  if (row.kind !== 'wordcloud') throw badRequest('Only word clouds have words.');
  const word = normaliseForHide(rawWord);
  if (!word) throw badRequest('Type the word to hide.');
  if (hide) run(ctx.db, 'INSERT OR IGNORE INTO poll_hidden_words (poll_id, word) VALUES (?, ?)', id, word);
  else run(ctx.db, 'DELETE FROM poll_hidden_words WHERE poll_id = ? AND word = ?', id, word);
  const s = state(ctx);
  if (row.status === 'live') {
    const t = tallyFor(ctx, row);
    if (hide) t.hidden.add(word);
    else t.hidden.delete(word);
    t.wordsCache = null;
    s.dirty = true; // goes out with the next throttled flush (<= 0.5 s)
  } else {
    // Not live: nothing will flush, so tell screens straight away.
    const t = buildTally(ctx.db, row);
    ctx.live.publish('polls.results', { pollId: id, results: resultsOf(ctx.db, row, t, ctx.now()), voters: t.voters }, 'all');
  }
}

// ---- voting ------------------------------------------------------------------------

function rejected(status: number, code: string, message: string): HttpError {
  return new HttpError(status, code, message);
}

interface Prepared {
  choice: number | null;
  value: number | null;
  items: string[];
  correct: number | null;
  points: number;
  speedBonus: number;
  elapsedMs: number | null;
  echo: VoteRequest;
}

function prepare(row: PollRow, body: VoteRequest, now: number): Prepared {
  const empty: Prepared = { choice: null, value: null, items: [], correct: null, points: 0, speedBonus: 0, elapsedMs: null, echo: body };
  switch (body.kind) {
    case 'single':
    case 'this_or_that': {
      if (body.choice >= optionCount(row)) throw badRequest('That option does not exist.');
      return { ...empty, choice: body.choice };
    }
    case 'multi': {
      const cfg = JSON.parse(row.config) as { options: unknown[]; maxChoices: number };
      const uniq = [...new Set(body.choices)];
      if (uniq.length !== body.choices.length) throw badRequest('Pick each option at most once.');
      if (uniq.some((c) => c >= cfg.options.length)) throw badRequest('That option does not exist.');
      if (uniq.length > cfg.maxChoices) throw badRequest(`Pick up to ${cfg.maxChoices}.`);
      const sorted = uniq.sort((a, b) => a - b);
      return { ...empty, items: sorted.map(String), echo: { kind: 'multi', choices: sorted } };
    }
    case 'rating': {
      const cfg = JSON.parse(row.config) as { scale: { min: number; max: number } };
      if (body.value < cfg.scale.min || body.value > cfg.scale.max) throw badRequest(`Pick ${cfg.scale.min} to ${cfg.scale.max}.`);
      return { ...empty, value: body.value };
    }
    case 'wordcloud': {
      const cfg = JSON.parse(row.config) as { maxWords: number };
      if (body.words.length > cfg.maxWords) throw badRequest(cfg.maxWords === 1 ? 'Just one word here.' : `Up to ${cfg.maxWords} words.`);
      const words: string[] = [];
      for (const raw of body.words) {
        const c = checkWord(raw);
        if (!c.ok) throw rejected(422, 'word_rejected', WORD_REASON_MESSAGE[c.reason]);
        if (!words.includes(c.word)) words.push(c.word);
      }
      return { ...empty, items: words, echo: { kind: 'wordcloud', words } };
    }
    case 'quiz': {
      const cfg = JSON.parse(row.config) as { options: unknown[]; durationMs: number; basePoints: number; speedBonusMax: number };
      if (body.choice >= cfg.options.length) throw badRequest('That option does not exist.');
      const startsAt = row.starts_at ?? now;
      const elapsed = Math.min(Math.max(now - startsAt, 0), cfg.durationMs);
      const right = body.choice === row.correct_option;
      const bonus = right ? Math.floor(cfg.speedBonusMax * (1 - elapsed / cfg.durationMs)) : 0;
      return {
        ...empty,
        choice: body.choice,
        correct: right ? 1 : 0,
        points: right ? cfg.basePoints + bonus : 0,
        speedBonus: bonus,
        elapsedMs: elapsed,
      };
    }
  }
}

export function castVote(ctx: FeatureContext, attendeeId: number, pollId: number, body: VoteRequest): VoteResponse {
  const s = state(ctx);
  s.limiter.enforce(`a:${attendeeId}`, 'Easy, one vote per poll. Take a breath.');
  const row = getRow(ctx.db, pollId);
  if (!row || row.status === 'draft') throw notFound('No such poll.');
  if (body.kind !== row.kind) throw badRequest('That vote does not match this poll.');
  // Receipt time: taken once, here, from the server clock. Never from the client.
  const now = ctx.now();
  if (row.status === 'live' && row.kind === 'quiz' && row.deadline_at !== null && now > row.deadline_at + POLL_LIMITS.quizGraceMs) {
    closePoll(ctx, row.id, true);
    throw rejected(409, 'too_late', 'Too late, the clock beat you.');
  }
  if (row.status !== 'live') throw rejected(409, 'poll_closed', 'Voting on this one is over.');
  if (row.starts_at !== null && now < row.starts_at) throw rejected(409, 'too_early', 'Hold on, answers are not open yet.');

  const p = prepare(row, body, now);
  const inserted = tx(ctx.db, () => {
    const r = run(
      ctx.db,
      `INSERT OR IGNORE INTO poll_votes (poll_id, attendee_id, received_at, choice, value, correct, points, speed_bonus, elapsed_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.id,
      attendeeId,
      now,
      p.choice,
      p.value,
      p.correct,
      p.points,
      p.speedBonus,
      p.elapsedMs,
    );
    if (r.changes === 0) return false;
    for (const item of p.items) run(ctx.db, 'INSERT INTO poll_vote_items (poll_id, attendee_id, item) VALUES (?, ?, ?)', row.id, attendeeId, item);
    return true;
  });
  if (!inserted) throw rejected(409, 'already_voted', 'You already voted on this one.');

  const t = tallyFor(ctx, row);
  tallyAdd(t, { choice: p.choice, value: p.value, items: p.items });
  s.dirty = true;

  // Quiz points wait for the reveal (an early "+34" would tell your neighbour you were right).
  if (row.kind !== 'quiz') {
    ctx.points.award({ attendeeId, source: 'polls', ref: `vote:${row.id}`, points: PARTICIPATION_POINTS, label: 'weighed in on a poll' });
  }
  ctx.stickers.unlock(attendeeId, 'polls-first-vote');
  if (row.kind === 'wordcloud') ctx.stickers.unlock(attendeeId, 'polls-wordsmith');
  const n = one<{ n: number }>(ctx.db, 'SELECT COUNT(*) AS n FROM poll_votes WHERE attendee_id = ?', attendeeId)?.n ?? 0;
  if (n >= REGULAR_VOTES) ctx.stickers.unlock(attendeeId, 'polls-regular');

  let results = resultsOf(ctx.db, row, t, now);
  if (p.echo.kind === 'wordcloud' && results.kind === 'wordcloud') {
    // Make sure my own words are on screen even if they are not in the throttled top list yet.
    const listed = new Set(results.words.map((w) => w.word));
    const mine = p.echo.words.filter((w) => !listed.has(w) && !t.hidden.has(w)).map((w) => ({ word: w, count: t.words.get(w) ?? 1 }));
    results = { ...results, words: [...results.words, ...mine] };
  }
  return { accepted: true, receivedAt: now, results, voters: t.voters };
}

// ---- views --------------------------------------------------------------------------

export function viewOf(ctx: FeatureContext, row: PollRow, attendeeId: number | null): PollView {
  return viewFor(ctx.db, row, tallyFor(ctx, row), attendeeId, ctx.now());
}

export function publicOf(row: PollRow, showAnswer: boolean): PublicPoll {
  return toPublic(row, showAnswer);
}

export function adminWords(t: Tally): { word: string; count: number; hidden: boolean }[] {
  return topWords(t, 0, true)
    .slice(0, 300)
    .map((w) => ({ ...w, hidden: t.hidden.has(w.word) }));
}
