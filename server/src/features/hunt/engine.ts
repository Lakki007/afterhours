// Hunt engine: data access, views and the rules that decide points.
// Everything that decides a stamp, a hint or a bonus lives here, server side.
import { randomBytes, randomInt } from 'node:crypto';
import { PASSWORD_ALPHABET } from '@afterhours/shared';
import {
  type HuntAttemptResult,
  type HuntBoard,
  type HuntCrowd,
  type HuntCurrentStop,
  type HuntFinisher,
  type HuntHintResult,
  type HuntMe,
  type HuntMyFinish,
  type HuntSolvedStop,
  type HuntStatus,
  extractHuntCode,
  normaliseAnswer,
} from '@afterhours/shared/features/hunt';
import {
  type FeatureContext,
  RateLimiter,
  all,
  badRequest,
  conflict,
  getPublicAttendee,
  one,
  run,
  tx,
} from '../../core';
import { cooldownFor, hintCost, normaliseCode, rankBonus, speedBonus, stopOrder, stopWorth } from './rules';

export const HUNT_SOURCE = 'hunt';

// ---- rows ----

export interface Stop {
  id: number;
  position: number;
  title: string;
  clue: string;
  clueImage: string | null;
  answers: string[];
  hints: string[];
  points: number;
  glyph: string;
  color: string;
  reveal: string;
  location: string;
  token: string;
  code: string;
}

interface StopRow {
  id: number;
  position: number;
  title: string;
  clue: string;
  clue_image: string | null;
  answers: string;
  hints: string;
  points: number;
  glyph: string;
  color: string;
  reveal: string;
  location: string;
  token: string;
  code: string;
}

interface StateRow {
  status: HuntStatus;
  title: string;
  shuffle_seed: string;
  opened_at: number | null;
  closed_at: number | null;
}

interface PlayerRow {
  attendee_id: number;
  started_at: number;
  last_at: number;
  finished_at: number | null;
  finish_rank: number | null;
  elapsed_ms: number | null;
  bonus: number;
}

function jsonArray(s: string): string[] {
  try {
    const v: unknown = JSON.parse(s);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function loadStops(ctx: FeatureContext): Stop[] {
  return all<StopRow>(ctx.db, 'SELECT * FROM hunt_stops ORDER BY position, id').map((r) => ({
    id: r.id,
    position: r.position,
    title: r.title,
    clue: r.clue,
    clueImage: r.clue_image,
    answers: jsonArray(r.answers),
    hints: jsonArray(r.hints),
    points: r.points,
    glyph: r.glyph,
    color: r.color,
    reveal: r.reveal,
    location: r.location,
    token: r.token,
    code: r.code,
  }));
}

export function getState(ctx: FeatureContext) {
  const r = one<StateRow>(ctx.db, 'SELECT status, title, shuffle_seed, opened_at, closed_at FROM hunt_state WHERE id = 1');
  if (!r) throw new Error('hunt_state row missing');
  return { status: r.status, title: r.title, seed: r.shuffle_seed, openedAt: r.opened_at, closedAt: r.closed_at };
}

// ---- per-process runtime ----

/**
 * Live counters, kept in memory and updated incrementally on start and solve so the hot path never
 * rescans every player. Anything structural (stops edited, reset) drops them and they are rebuilt once.
 */
interface CrowdCache {
  here: Map<number, number>;
  solvedBy: Map<number, number>;
  hunting: number;
  finished: number;
  players: number;
}

interface Runtime {
  dirty: boolean;
  crowd: CrowdCache | null;
  /** Typed answers: 8 checks, refilling over 40 s, per attendee. */
  answers: RateLimiter;
  /** Scans that did NOT match your current stop: 10 per minute. */
  scans: RateLimiter;
  hints: RateLimiter;
}

const runtimes = new WeakMap<FeatureContext, Runtime>();
export function runtime(ctx: FeatureContext): Runtime {
  let r = runtimes.get(ctx);
  if (!r) {
    r = {
      dirty: false,
      crowd: null,
      answers: new RateLimiter({ limit: 8, windowMs: 40_000, now: ctx.now }),
      scans: new RateLimiter({ limit: 10, windowMs: 60_000, now: ctx.now }),
      hints: new RateLimiter({ limit: 6, windowMs: 60_000, now: ctx.now }),
    };
    runtimes.set(ctx, r);
  }
  return r;
}

/** Stops or progress changed in a way the counters cannot follow: rebuild them next time, and tell the tick to broadcast. */
export function bump(ctx: FeatureContext): void {
  const rt = runtime(ctx);
  rt.crowd = null;
  rt.dirty = true;
}

// ---- crowd ----

function buildCache(ctx: FeatureContext): CrowdCache {
  const state = getState(ctx);
  const stopIds = loadStops(ctx).map((s) => s.id);
  const players = all<{ attendee_id: number; finished_at: number | null }>(ctx.db, 'SELECT attendee_id, finished_at FROM hunt_players');
  const solvedCount = new Map(
    all<{ attendee_id: number; n: number }>(ctx.db, 'SELECT attendee_id, COUNT(*) AS n FROM hunt_progress GROUP BY attendee_id').map((r) => [r.attendee_id, r.n]),
  );
  const solvedBy = new Map(
    all<{ stop_id: number; n: number }>(ctx.db, 'SELECT stop_id, COUNT(*) AS n FROM hunt_progress GROUP BY stop_id').map((r) => [r.stop_id, r.n]),
  );
  const here = new Map<number, number>();
  let finished = 0;
  for (const p of players) {
    if (p.finished_at !== null) {
      finished++;
      continue;
    }
    // Solving only ever happens on the current stop, so solved stops are a prefix of the order.
    const cur = stopOrder(state.seed, p.attendee_id, stopIds)[solvedCount.get(p.attendee_id) ?? 0];
    if (cur !== undefined) here.set(cur, (here.get(cur) ?? 0) + 1);
  }
  return { here, solvedBy, hunting: players.length - finished, finished, players: players.length };
}

export function crowdOf(ctx: FeatureContext): CrowdCache & { crowd: HuntCrowd } {
  const rt = runtime(ctx);
  const c = (rt.crowd ??= buildCache(ctx));
  const crowd: HuntCrowd = {
    here: [...c.here.entries()]
      .filter(([, count]) => count > 0)
      .map(([stopId, count]) => ({ stopId, count }))
      .sort((a, b) => a.stopId - b.stopId),
    hunting: c.hunting,
    finished: c.finished,
    players: c.players,
    updatedAt: ctx.now(),
  };
  return { ...c, crowd };
}

function bumpMap(m: Map<number, number>, key: number, by: number): void {
  m.set(key, Math.max(0, (m.get(key) ?? 0) + by));
}

/** Follow a start (from = null) or a stamp (to = null when that was the last stop) without rescanning. */
function crowdMove(ctx: FeatureContext, from: number | null, to: number | null, solved: number | null): void {
  const rt = runtime(ctx);
  rt.dirty = true;
  const c = rt.crowd;
  if (!c) return;
  if (from === null) {
    c.players++;
    c.hunting++;
  } else {
    bumpMap(c.here, from, -1);
  }
  if (to !== null) bumpMap(c.here, to, 1);
  else if (from !== null) {
    c.hunting--;
    c.finished++;
  }
  if (solved !== null) bumpMap(c.solvedBy, solved, 1);
}

// ---- attendee views ----

interface ProgressRow {
  stop_id: number;
  solved_at: number;
  via: 'qr' | 'answer';
  points: number;
  hints_used: number;
}

function myFinish(p: PlayerRow, finishers: number, hintsTotal: number): HuntMyFinish | null {
  if (p.finished_at === null || p.finish_rank === null || p.elapsed_ms === null) return null;
  return {
    rank: p.finish_rank,
    finishedAt: p.finished_at,
    elapsedMs: p.elapsed_ms,
    rankBonus: rankBonus(p.finish_rank),
    speedBonus: speedBonus(p.elapsed_ms),
    finishers,
    usedNoHints: hintsTotal === 0,
  };
}

export function buildMe(ctx: FeatureContext, attendeeId: number): HuntMe {
  const state = getState(ctx);
  const stops = loadStops(ctx);
  const cache = crowdOf(ctx);
  const player = one<PlayerRow>(ctx.db, 'SELECT * FROM hunt_players WHERE attendee_id = ?', attendeeId);
  const base = {
    status: state.status,
    title: state.title,
    total: stops.length,
    serverNow: ctx.now(),
    crowd: cache.crowd,
  };
  const pointsEarned = one<{ t: number | null }>(ctx.db, 'SELECT SUM(points) AS t FROM points_ledger WHERE attendee_id = ? AND source = ?', attendeeId, HUNT_SOURCE)?.t ?? 0;
  // Before the hunt opens, or before this person presses start, nothing about the stops is sent.
  if (!player || state.status === 'draft') {
    return { ...base, started: false, startedAt: null, solved: [], current: null, finish: null, pointsEarned };
  }

  const order = stopOrder(state.seed, attendeeId, stops.map((s) => s.id));
  const byId = new Map(stops.map((s) => [s.id, s]));
  const progress = new Map(
    all<ProgressRow>(ctx.db, 'SELECT stop_id, solved_at, via, points, hints_used FROM hunt_progress WHERE attendee_id = ?', attendeeId).map((r) => [r.stop_id, r]),
  );
  const solved: HuntSolvedStop[] = [];
  order.forEach((id, i) => {
    const row = progress.get(id);
    const stop = byId.get(id);
    if (row && stop) solved.push(solvedView(stop, i + 1, row, cache.solvedBy.get(id) ?? 1));
  });
  let hintsTotal = 0;
  for (const r of progress.values()) hintsTotal += r.hints_used;

  let current: HuntCurrentStop | null = null;
  if (state.status === 'open' && player.finished_at === null) {
    const idx = order.findIndex((id) => !progress.has(id));
    const stop = idx >= 0 ? byId.get(order[idx] as number) : undefined;
    if (stop) {
      const ss = one<{ hints_used: number; wrong_count: number; locked_until: number }>(
        ctx.db,
        'SELECT hints_used, wrong_count, locked_until FROM hunt_stop_state WHERE attendee_id = ? AND stop_id = ?',
        attendeeId,
        stop.id,
      );
      const used = Math.min(ss?.hints_used ?? 0, stop.hints.length);
      const now = ctx.now();
      current = {
        stopId: stop.id,
        index: idx + 1,
        total: stops.length,
        clue: stop.clue,
        clueImage: stop.clueImage,
        hints: stop.hints.slice(0, used),
        hintsLeft: stop.hints.length - used,
        nextHintCost: used < stop.hints.length ? hintCost(used + 1) : null,
        worth: stopWorth(stop.points, used),
        canType: stop.answers.length > 0,
        lockedUntil: (ss?.locked_until ?? 0) > now ? (ss?.locked_until ?? 0) : 0,
        wrongCount: ss?.wrong_count ?? 0,
        hereNow: Math.max(0, (cache.here.get(stop.id) ?? 1) - 1),
        isFinal: idx === stops.length - 1,
      };
    }
  }
  return {
    ...base,
    started: true,
    startedAt: player.started_at,
    solved,
    current,
    finish: myFinish(player, cache.crowd.finished, hintsTotal),
    pointsEarned,
  };
}

function solvedView(stop: Stop, index: number, row: ProgressRow, solvedBy: number): HuntSolvedStop {
  return {
    stopId: stop.id,
    index,
    title: stop.title,
    reveal: stop.reveal,
    glyph: stop.glyph as HuntSolvedStop['glyph'],
    color: stop.color as HuntSolvedStop['color'],
    solvedAt: row.solved_at,
    via: row.via,
    points: row.points,
    hintsUsed: row.hints_used,
    solvedBy,
  };
}

export function finishers(ctx: FeatureContext, limit = 50): HuntFinisher[] {
  const rows = all<{ attendee_id: number; finish_rank: number; finished_at: number; elapsed_ms: number; bonus: number }>(
    ctx.db,
    'SELECT attendee_id, finish_rank, finished_at, elapsed_ms, bonus FROM hunt_players WHERE finished_at IS NOT NULL ORDER BY finish_rank LIMIT ?',
    limit,
  );
  const out: HuntFinisher[] = [];
  for (const r of rows) {
    const who = getPublicAttendee(ctx, r.attendee_id);
    if (!who) continue;
    out.push({
      rank: r.finish_rank,
      attendeeId: r.attendee_id,
      nickname: who.nickname,
      avatar: who.avatar,
      finishedAt: r.finished_at,
      elapsedMs: r.elapsed_ms,
      bonus: r.bonus,
    });
  }
  return out;
}

export function buildBoard(ctx: FeatureContext): HuntBoard {
  const state = getState(ctx);
  const total = one<{ n: number }>(ctx.db, 'SELECT COUNT(*) AS n FROM hunt_stops')?.n ?? 0;
  return {
    status: state.status,
    title: state.title,
    total,
    crowd: crowdOf(ctx).crowd,
    finishers: state.status === 'draft' ? [] : finishers(ctx),
    serverNow: ctx.now(),
  };
}

// ---- actions ----

function requireOpen(ctx: FeatureContext): { seed: string } {
  const s = getState(ctx);
  if (s.status === 'draft') throw conflict('The hunt has not opened yet. Hang tight.');
  if (s.status === 'closed') throw conflict('The hunt is closed. Thanks for playing.');
  return { seed: s.seed };
}

function requirePlayer(ctx: FeatureContext, attendeeId: number): PlayerRow {
  const p = one<PlayerRow>(ctx.db, 'SELECT * FROM hunt_players WHERE attendee_id = ?', attendeeId);
  if (!p) throw conflict('Hit start first.');
  return p;
}

export function startHunt(ctx: FeatureContext, attendeeId: number): HuntMe {
  requireOpen(ctx);
  const total = one<{ n: number }>(ctx.db, 'SELECT COUNT(*) AS n FROM hunt_stops')?.n ?? 0;
  if (total === 0) throw conflict('No stops yet.');
  const now = ctx.now();
  const r = run(ctx.db, 'INSERT OR IGNORE INTO hunt_players (attendee_id, started_at, last_at) VALUES (?, ?, ?)', attendeeId, now, now);
  if (r.changes > 0) {
    const first = stopOrder(getState(ctx).seed, attendeeId, loadStops(ctx).map((s) => s.id))[0];
    crowdMove(ctx, null, first ?? null, null);
  }
  return buildMe(ctx, attendeeId);
}

/** The stop this attendee is on, or null when they are done. Also returns the solved ids. */
function currentFor(ctx: FeatureContext, attendeeId: number, seed: string, stops: Stop[]) {
  const order = stopOrder(seed, attendeeId, stops.map((s) => s.id));
  const solved = new Set(all<{ stop_id: number }>(ctx.db, 'SELECT stop_id FROM hunt_progress WHERE attendee_id = ?', attendeeId).map((r) => r.stop_id));
  const id = order.find((x) => !solved.has(x));
  return { current: stops.find((s) => s.id === id) ?? null, solved };
}

const MSG_NOT_YOURS = "That's not the sticker you're after right now. Keep it in mind though.";

function reply(ctx: FeatureContext, attendeeId: number, r: { result: 'not_yours' | 'already'; message: string }): HuntAttemptResult {
  return { ...r, me: buildMe(ctx, attendeeId) };
}

export function scan(ctx: FeatureContext, attendeeId: number, raw: string): HuntAttemptResult {
  const { seed } = requireOpen(ctx);
  const player = requirePlayer(ctx, attendeeId);
  const rt = runtime(ctx);
  if (!rt.scans.allowed(`a:${attendeeId}`)) {
    rt.scans.enforce(`a:${attendeeId}`, 'That is a lot of scanning. Take a breath and read the clue again.');
  }
  if (player.finished_at !== null) return reply(ctx, attendeeId, { result: 'already', message: "You've already finished the whole hunt." });

  const code = extractHuntCode(raw);
  const norm = normaliseCode(code);
  const stops = loadStops(ctx);
  const hit = stops.find((s) => s.token === code || (norm.length === 8 && s.code === norm));
  const { current, solved } = currentFor(ctx, attendeeId, seed, stops);
  if (hit && solved.has(hit.id)) return reply(ctx, attendeeId, { result: 'already', message: 'You already stamped that one.' });
  if (!hit || !current || hit.id !== current.id) {
    // Unknown code and a real sticker for a later stop look exactly the same.
    rt.scans.hit(`a:${attendeeId}`);
    return reply(ctx, attendeeId, { result: 'not_yours', message: MSG_NOT_YOURS });
  }
  return solveStop(ctx, attendeeId, current, 'qr');
}

export function answer(ctx: FeatureContext, attendeeId: number, stopId: number, text: string): HuntAttemptResult {
  const { seed } = requireOpen(ctx);
  const player = requirePlayer(ctx, attendeeId);
  if (player.finished_at !== null) return reply(ctx, attendeeId, { result: 'already', message: "You've already finished the whole hunt." });
  const stops = loadStops(ctx);
  const { current, solved } = currentFor(ctx, attendeeId, seed, stops);
  if (solved.has(stopId)) return reply(ctx, attendeeId, { result: 'already', message: 'You already stamped that one.' });
  if (!current || current.id !== stopId) return reply(ctx, attendeeId, { result: 'not_yours', message: MSG_NOT_YOURS });
  if (current.answers.length === 0) throw badRequest('This one needs its sticker. Go find it.');

  const now = ctx.now();
  const ss = one<{ wrong_count: number; locked_until: number }>(
    ctx.db,
    'SELECT wrong_count, locked_until FROM hunt_stop_state WHERE attendee_id = ? AND stop_id = ?',
    attendeeId,
    stopId,
  );
  if (ss && ss.locked_until > now) {
    return {
      result: 'locked',
      message: 'Cooling down. Use the time to reread the clue.',
      lockedUntil: ss.locked_until,
      retryAfterMs: ss.locked_until - now,
      me: buildMe(ctx, attendeeId),
    };
  }
  const guess = normaliseAnswer(text);
  if (guess.length === 0) throw badRequest('Type an answer first.');
  runtime(ctx).answers.enforce(`a:${attendeeId}`, 'Easy on the typing. Think a little, then try again.');

  if (current.answers.some((a) => normaliseAnswer(a) === guess)) return solveStop(ctx, attendeeId, current, 'answer');

  const wrong = (ss?.wrong_count ?? 0) + 1;
  const cooldownMs = cooldownFor(wrong);
  const lockedUntil = now + cooldownMs;
  run(
    ctx.db,
    `INSERT INTO hunt_stop_state (attendee_id, stop_id, wrong_count, locked_until) VALUES (?, ?, ?, ?)
     ON CONFLICT(attendee_id, stop_id) DO UPDATE SET wrong_count = excluded.wrong_count, locked_until = excluded.locked_until`,
    attendeeId,
    stopId,
    wrong,
    lockedUntil,
  );
  run(ctx.db, 'UPDATE hunt_players SET last_at = ? WHERE attendee_id = ?', now, attendeeId);
  return {
    result: 'wrong',
    message: wrong >= 3 ? 'Nope. A hint might be cheaper than guessing.' : 'Not quite. Have another look.',
    wrongCount: wrong,
    lockedUntil,
    cooldownMs,
    me: buildMe(ctx, attendeeId),
  };
}

export function revealHint(ctx: FeatureContext, attendeeId: number, stopId: number, n: number): HuntHintResult {
  const { seed } = requireOpen(ctx);
  const player = requirePlayer(ctx, attendeeId);
  if (player.finished_at !== null) throw conflict("You've finished. No more hints needed.");
  const stops = loadStops(ctx);
  const { current } = currentFor(ctx, attendeeId, seed, stops);
  if (!current || current.id !== stopId) throw conflict("That's not your stop right now.");
  if (n > current.hints.length) throw badRequest('No more hints for this one.');
  const used =
    one<{ hints_used: number }>(ctx.db, 'SELECT hints_used FROM hunt_stop_state WHERE attendee_id = ? AND stop_id = ?', attendeeId, stopId)?.hints_used ?? 0;
  if (n > used + 1) throw badRequest('Take the hints one at a time.');
  const text = current.hints[n - 1] as string;
  if (n <= used) return { n, hint: text, cost: 0, me: buildMe(ctx, attendeeId) }; // already revealed: free, no double charge
  runtime(ctx).hints.enforce(`a:${attendeeId}`, 'Hints are not a firehose. Give it a minute.');
  run(
    ctx.db,
    `INSERT INTO hunt_stop_state (attendee_id, stop_id, hints_used) VALUES (?, ?, ?)
     ON CONFLICT(attendee_id, stop_id) DO UPDATE SET hints_used = excluded.hints_used`,
    attendeeId,
    stopId,
    n,
  );
  run(ctx.db, 'UPDATE hunt_players SET last_at = ? WHERE attendee_id = ?', ctx.now(), attendeeId);
  return { n, hint: text, cost: hintCost(n), me: buildMe(ctx, attendeeId) };
}

/** Stamp a stop for an attendee (already proven to be their current stop). One transaction; idempotent. */
export function solveStop(ctx: FeatureContext, attendeeId: number, stop: Stop, via: 'qr' | 'answer', at = ctx.now()): HuntAttemptResult {
  const stops = loadStops(ctx);
  const outcome = tx(ctx.db, () => {
    const used = one<{ hints_used: number }>(ctx.db, 'SELECT hints_used FROM hunt_stop_state WHERE attendee_id = ? AND stop_id = ?', attendeeId, stop.id)?.hints_used ?? 0;
    const hintsUsed = Math.min(used, stop.hints.length);
    const points = stopWorth(stop.points, hintsUsed);
    const ins = run(
      ctx.db,
      'INSERT OR IGNORE INTO hunt_progress (attendee_id, stop_id, solved_at, via, points, hints_used) VALUES (?, ?, ?, ?, ?, ?)',
      attendeeId,
      stop.id,
      at,
      via,
      points,
      hintsUsed,
    );
    if (ins.changes === 0) return { fresh: false as const };
    run(ctx.db, 'UPDATE hunt_players SET last_at = ? WHERE attendee_id = ?', at, attendeeId);
    ctx.points.award({ attendeeId, source: HUNT_SOURCE, ref: `stop:${stop.id}`, points, label: `stamp: ${stop.title}` });
    ctx.stickers.unlock(attendeeId, 'hunt-first-stamp');

    const agg = one<{ n: number; h: number | null }>(ctx.db, 'SELECT COUNT(*) AS n, SUM(hints_used) AS h FROM hunt_progress WHERE attendee_id = ?', attendeeId);
    const solvedCount = agg?.n ?? 0;
    let finishInfo: { rank: number; elapsedMs: number; bonus: number; rb: number; sb: number; noHints: boolean } | null = null;
    if (solvedCount >= stops.length) {
      const startedAt = one<{ started_at: number }>(ctx.db, 'SELECT started_at FROM hunt_players WHERE attendee_id = ?', attendeeId)?.started_at ?? at;
      const rank = (one<{ n: number }>(ctx.db, 'SELECT COUNT(*) AS n FROM hunt_players WHERE finished_at IS NOT NULL')?.n ?? 0) + 1;
      const elapsedMs = Math.max(0, at - startedAt);
      const rb = rankBonus(rank);
      const sb = speedBonus(elapsedMs);
      run(
        ctx.db,
        'UPDATE hunt_players SET finished_at = ?, finish_rank = ?, elapsed_ms = ?, bonus = ? WHERE attendee_id = ?',
        at,
        rank,
        elapsedMs,
        rb + sb,
        attendeeId,
      );
      ctx.points.award({ attendeeId, source: HUNT_SOURCE, ref: 'finish-rank', points: rb, label: `finished the hunt #${rank}` });
      if (sb > 0) ctx.points.award({ attendeeId, source: HUNT_SOURCE, ref: 'finish-speed', points: sb, label: 'hunt speed bonus' });
      ctx.stickers.unlock(attendeeId, 'hunt-finisher');
      if (rank <= 3) ctx.stickers.unlock(attendeeId, 'hunt-podium');
      const noHints = (agg?.h ?? 0) === 0;
      if (noHints) ctx.stickers.unlock(attendeeId, 'hunt-clean');
      finishInfo = { rank, elapsedMs, bonus: rb + sb, rb, sb, noHints };
    }
    return { fresh: true as const, points, hintsUsed, solvedCount, finishInfo };
  });

  const me = (): HuntMe => buildMe(ctx, attendeeId);
  if (!outcome.fresh) {
    // Double tap or replay: the stamp is already there and nothing was paid twice.
    return { result: 'already', message: 'You already stamped that one.', me: me() };
  }
  const order = stopOrder(getState(ctx).seed, attendeeId, stops.map((s) => s.id));
  crowdMove(ctx, stop.id, outcome.finishInfo ? null : (order[outcome.solvedCount] ?? null), stop.id);
  const view = me();
  const solvedStop = view.solved.find((s) => s.stopId === stop.id);
  if (!solvedStop) throw new Error('solved stop missing from view');
  const who = getPublicAttendee(ctx, attendeeId);
  if (who) {
    ctx.live.publish('hunt.stamp', { nickname: who.nickname, avatar: who.avatar, solved: outcome.solvedCount, total: stops.length, at }, 'screens');
  }
  let finish: HuntMyFinish | null = null;
  if (outcome.finishInfo) {
    finish = view.finish;
    if (who) {
      ctx.live.publish(
        'hunt.finished',
        {
          finisher: {
            rank: outcome.finishInfo.rank,
            attendeeId,
            nickname: who.nickname,
            avatar: who.avatar,
            finishedAt: at,
            elapsedMs: outcome.finishInfo.elapsedMs,
            bonus: outcome.finishInfo.bonus,
          },
          finishedCount: outcome.finishInfo.rank,
        },
        'all',
      );
    }
  }
  return {
    result: 'solved',
    message: outcome.finishInfo ? 'That is every stop. You did it.' : via === 'qr' ? 'Got it. Stamped.' : 'Correct. Stamped.',
    stop: solvedStop,
    finish,
    me: view,
  };
}

// ---- stop authoring helpers ----

export function newToken(): string {
  return randomBytes(16).toString('base64url');
}

export function newCode(ctx: FeatureContext): string {
  for (;;) {
    let c = '';
    for (let i = 0; i < 8; i++) c += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
    if (!one(ctx.db, 'SELECT 1 AS x FROM hunt_stops WHERE code = ?', c)) return c;
  }
}
