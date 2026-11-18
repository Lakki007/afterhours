// The schedule engine: storage, the "what is happening now" rule, and every organiser action.
//
// THE RULES (tested in schedule.test.ts):
//
// Phase (what phones show), as of `now`:
//   - A row an organiser pressed "start" on is `live` until they press "end" (or start something
//     else). It may overrun its endAt; nothing moves by itself.
//   - While any row is organiser-started, scheduled rows that begin before it count as `ended` (done
//     or skipped) and later ones stay `upcoming` however late they are.
//   - Otherwise it is time driven: a scheduled row is `live` between startAt and endAt, `upcoming`
//     before, `ended` after.
//   - nowId = the live row that started last; nextId = first upcoming row in timeline order.
//
// Start now: every currently live row is ended; the row jumps to now and keeps its length. Rows
//   after it are pushed only as far as needed to stop overlapping (so starting early leaves a
//   gap, starting late delays the rest).
// End now: the row ends, its endAt is pulled in to now if it was still in the future. Nothing else moves.
// Delay +5/+10/+15 on an upcoming row (or a time-live one nobody started): startAt and endAt move
//   later. On an organiser-started live row: only endAt moves later (it is already running).
//   Either way, later rows are pushed only as far as needed to stop overlapping, one after the
//   other, so slack (gaps, breaks) absorbs delays instead of every later row shifting by the full amount.
// Reorder: the body lists exactly the upcoming rows. Durations travel with the rows; the first row
//   starts where the first upcoming row used to (not before a running row ends), and the gaps between
//   slots stay in their positions. Planned times are reset to the new plan.
import {
  type Activity,
  type ActivityInput,
  type ActivityPatch,
  type ActivityStatus,
  type ScheduleChange,
  type ScheduleState,
} from '@afterhours/shared/features/schedule';
import { type FeatureContext, HttpError, all, conflict, notFound, one, run, tx } from '../../core';

export interface Row {
  id: number;
  title: string;
  blurb: string;
  location: string;
  kind: Activity['kind'];
  highlight: number;
  link: string | null;
  start_at: number;
  end_at: number;
  planned_start_at: number;
  status: 'scheduled' | 'live' | 'ended';
  actual_start_at: number | null;
  actual_end_at: number | null;
}

export const MAX_ACTIVITIES = 100;
const MIN = 60_000;

interface Cache {
  rows: Row[] | null;
  lastNowId: number | null;
  lastNextId: number | null;
  primed: boolean;
}
const caches = new WeakMap<FeatureContext, Cache>();
function cache(ctx: FeatureContext): Cache {
  let c = caches.get(ctx);
  if (!c) caches.set(ctx, (c = { rows: null, lastNowId: null, lastNextId: null, primed: false }));
  return c;
}

/** All rows in timeline order. Cached until a write; 300 phones reading state do not touch SQLite. */
export function loadRows(ctx: FeatureContext): Row[] {
  const c = cache(ctx);
  c.rows ??= all<Row>(ctx.db, 'SELECT * FROM schedule_activities ORDER BY start_at, id');
  return c.rows;
}

export function invalidate(ctx: FeatureContext): void {
  cache(ctx).rows = null;
}

export function version(ctx: FeatureContext): number {
  return one<{ value: number }>(ctx.db, "SELECT value FROM schedule_meta WHERE key = 'version'")?.value ?? 0;
}

/** A transaction that also drops the row cache if it rolls back (the cache may hold uncommitted rows). */
function mutate<T>(ctx: FeatureContext, fn: () => T): T {
  try {
    return tx(ctx.db, fn);
  } catch (err) {
    invalidate(ctx);
    throw err;
  }
}

function bump(ctx: FeatureContext): void {
  run(ctx.db, "UPDATE schedule_meta SET value = value + 1 WHERE key = 'version'");
  invalidate(ctx);
}

/** Phase of every row as of `now` (see rules above). */
export function computePhases(rows: Row[], now: number): Map<number, ActivityStatus> {
  // First start time among organiser-started rows: scheduled rows before it were skipped or done.
  let liveFrom = Infinity;
  for (const r of rows) if (r.status === 'live') liveFrom = Math.min(liveFrom, r.start_at);
  const organiserLive = liveFrom !== Infinity;
  const out = new Map<number, ActivityStatus>();
  for (const r of rows) {
    let s: ActivityStatus;
    if (r.status === 'ended') s = 'ended';
    else if (r.status === 'live') s = 'live';
    else if (organiserLive) s = r.start_at < liveFrom ? 'ended' : 'upcoming';
    else if (now >= r.end_at) s = 'ended';
    else if (now >= r.start_at) s = 'live';
    else s = 'upcoming';
    out.set(r.id, s);
  }
  return out;
}

export function nowAndNext(rows: Row[], phases: Map<number, ActivityStatus>): { nowId: number | null; nextId: number | null } {
  let nowRow: Row | null = null;
  for (const r of rows) if (phases.get(r.id) === 'live' && (!nowRow || r.start_at >= nowRow.start_at)) nowRow = r;
  const next = rows.find((r) => phases.get(r.id) === 'upcoming');
  return { nowId: nowRow?.id ?? null, nextId: next?.id ?? null };
}

function toActivity(r: Row, phase: ActivityStatus): Activity {
  return {
    id: r.id,
    title: r.title,
    blurb: r.blurb,
    location: r.location,
    kind: r.kind,
    highlight: r.highlight === 1,
    link: r.link,
    startAt: r.start_at,
    endAt: r.end_at,
    plannedStartAt: r.planned_start_at,
    delayMs: r.start_at - r.planned_start_at,
    status: phase,
    actualStartAt: r.actual_start_at,
    actualEndAt: r.actual_end_at,
  };
}

export function buildState(ctx: FeatureContext): ScheduleState {
  const now = ctx.now();
  const rows = loadRows(ctx);
  const phases = computePhases(rows, now);
  return {
    serverNow: now,
    version: version(ctx),
    ...nowAndNext(rows, phases),
    activities: rows.map((r) => toActivity(r, phases.get(r.id) ?? 'upcoming')),
  };
}

function publish(ctx: FeatureContext, change: ScheduleChange): ScheduleState {
  const state = buildState(ctx);
  const c = cache(ctx);
  c.lastNowId = state.nowId;
  c.lastNextId = state.nextId;
  c.primed = true;
  ctx.live.publish('schedule.changed', { change, state }, 'all');
  return state;
}

/** Tick: tell everyone when time alone changed what is on now or next. */
export function advance(ctx: FeatureContext): void {
  const c = cache(ctx);
  const state = buildState(ctx);
  if (!c.primed) {
    c.lastNowId = state.nowId;
    c.lastNextId = state.nextId;
    c.primed = true;
    return;
  }
  if (state.nowId === c.lastNowId && state.nextId === c.lastNextId) return;
  const previousNowId = c.lastNowId;
  c.lastNowId = state.nowId;
  c.lastNextId = state.nextId;
  ctx.live.publish('schedule.changed', { change: { kind: 'advanced', previousNowId, nowId: state.nowId }, state }, 'all');
}

function getRow(ctx: FeatureContext, id: number): Row {
  const r = loadRows(ctx).find((x) => x.id === id);
  if (!r) throw notFound('No such activity.');
  return r;
}

function setTimes(ctx: FeatureContext, id: number, start: number, end: number): void {
  run(ctx.db, 'UPDATE schedule_activities SET start_at = ?, end_at = ?, updated_at = ? WHERE id = ?', start, end, ctx.now(), id);
}

/**
 * Push rows after `anchorIndex` (in the order they had before the change) later, only as far
 * as needed so none overlaps the one before it. Running and finished rows are left alone.
 */
function cascade(ctx: FeatureContext, order: Row[], anchorId: number, anchorEnd: number, skip: number[] = []): number[] {
  const phases = computePhases(order, ctx.now());
  const idx = order.findIndex((r) => r.id === anchorId);
  const shifted: number[] = [];
  let prevEnd = anchorEnd;
  for (const r of order.slice(idx + 1)) {
    if (r.status === 'live' || phases.get(r.id) === 'ended' || skip.includes(r.id)) continue;
    let { start_at: s, end_at: e } = r;
    if (s < prevEnd) {
      const by = prevEnd - s;
      s += by;
      e += by;
      setTimes(ctx, r.id, s, e);
      shifted.push(r.id);
    }
    prevEnd = Math.max(prevEnd, e);
  }
  return shifted;
}

// ---- organiser actions -------------------------------------------------------------

export function startNow(ctx: FeatureContext, id: number): ScheduleState {
  const now = ctx.now();
  let change!: ScheduleChange;
  mutate(ctx, () => {
    const order = loadRows(ctx);
    const target = getRow(ctx, id);
    if (target.status === 'live') throw conflict('That one is already live.');
    const phases = computePhases(order, now);
    const endedIds: number[] = [];
    for (const r of order) {
      if (r.id !== id && phases.get(r.id) === 'live') {
        run(
          ctx.db,
          'UPDATE schedule_activities SET status = ?, actual_end_at = ?, end_at = MIN(end_at, ?), updated_at = ? WHERE id = ?',
          'ended',
          now,
          Math.max(now, r.start_at + 1),
          now,
          r.id,
        );
        endedIds.push(r.id);
      }
    }
    // A row that was ended early has a trimmed length; give a restart at least 10 minutes (edit the end to taste).
    const length = Math.max(target.end_at - target.start_at, 10 * MIN);
    run(
      ctx.db,
      "UPDATE schedule_activities SET status = 'live', start_at = ?, end_at = ?, actual_start_at = ?, actual_end_at = NULL, updated_at = ? WHERE id = ?",
      now,
      now + length,
      now,
      now,
      id,
    );
    invalidate(ctx);
    const shiftedIds = cascade(ctx, order, id, now + length, endedIds);
    bump(ctx);
    change = { kind: 'started', activityId: id, endedIds, shiftedIds };
  });
  return publish(ctx, change);
}

export function endNow(ctx: FeatureContext, id: number): ScheduleState {
  const now = ctx.now();
  mutate(ctx, () => {
    const r = getRow(ctx, id);
    const phase = computePhases(loadRows(ctx), now).get(id);
    if (phase !== 'live') throw conflict('That one is not live right now.');
    run(
      ctx.db,
      "UPDATE schedule_activities SET status = 'ended', actual_end_at = ?, end_at = MIN(end_at, MAX(?, start_at + 1)), updated_at = ? WHERE id = ?",
      now,
      now,
      now,
      r.id,
    );
    bump(ctx);
  });
  return publish(ctx, { kind: 'ended', activityId: id });
}

export function delay(ctx: FeatureContext, id: number, minutes: 5 | 10 | 15): ScheduleState {
  const now = ctx.now();
  const by = minutes * MIN;
  let shiftedIds: number[] = [];
  mutate(ctx, () => {
    const order = loadRows(ctx);
    const r = getRow(ctx, id);
    const phase = computePhases(order, now).get(id);
    if (phase === 'ended') throw conflict('That one is already over.');
    let end = r.end_at + by;
    if (r.status === 'live') {
      run(ctx.db, 'UPDATE schedule_activities SET end_at = ?, updated_at = ? WHERE id = ?', end, now, id);
    } else {
      setTimes(ctx, id, r.start_at + by, end);
    }
    invalidate(ctx);
    end = getRow(ctx, id).end_at;
    shiftedIds = cascade(ctx, order, id, end);
    bump(ctx);
  });
  return publish(ctx, { kind: 'delayed', activityId: id, minutes, shiftedIds });
}

export function reorder(ctx: FeatureContext, order: number[]): ScheduleState {
  const now = ctx.now();
  mutate(ctx, () => {
    const rows = loadRows(ctx);
    const phases = computePhases(rows, now);
    const upcoming = rows.filter((r) => phases.get(r.id) === 'upcoming');
    const want = new Set(upcoming.map((r) => r.id));
    if (order.length !== want.size || new Set(order).size !== order.length || order.some((i) => !want.has(i))) {
      throw conflict('The schedule changed under you. Refresh and try again.');
    }
    const byId = new Map(upcoming.map((r) => [r.id, r]));
    // Gaps stay with their slot position; durations travel with the activity.
    const gaps = upcoming.map((r, i) => (i === 0 ? 0 : Math.max(0, r.start_at - (upcoming[i - 1] as Row).end_at)));
    const runningEnd = Math.max(0, ...rows.filter((r) => phases.get(r.id) === 'live').map((r) => r.end_at));
    let cursor = Math.max((upcoming[0] as Row).start_at, runningEnd);
    order.forEach((rid, i) => {
      const r = byId.get(rid) as Row;
      const start = i === 0 ? cursor : cursor + (gaps[i] ?? 0);
      const end = start + (r.end_at - r.start_at);
      run(ctx.db, 'UPDATE schedule_activities SET start_at = ?, end_at = ?, planned_start_at = ?, updated_at = ? WHERE id = ?', start, end, start, now, rid);
      cursor = end;
    });
    bump(ctx);
  });
  return publish(ctx, { kind: 'reordered', order: loadRows(ctx).map((r) => r.id) });
}

export function createActivity(ctx: FeatureContext, input: ActivityInput & Required<Pick<ActivityInput, 'kind'>>): { state: ScheduleState; id: number } {
  const now = ctx.now();
  if (loadRows(ctx).length >= MAX_ACTIVITIES) throw conflict(`That is plenty (${MAX_ACTIVITIES} max). Delete something first.`);
  const { lastId } = run(
    ctx.db,
    `INSERT INTO schedule_activities (title, blurb, location, kind, highlight, link, start_at, end_at, planned_start_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.title,
    input.blurb ?? '',
    input.location ?? '',
    input.kind,
    input.highlight ? 1 : 0,
    input.link ?? null,
    input.startAt,
    input.endAt,
    input.startAt,
    now,
    now,
  );
  bump(ctx);
  return { state: publish(ctx, { kind: 'created', activityId: lastId }), id: lastId };
}

export function editActivity(ctx: FeatureContext, id: number, patch: ActivityPatch): ScheduleState {
  const now = ctx.now();
  mutate(ctx, () => {
    const r = getRow(ctx, id);
    const start = patch.startAt ?? r.start_at;
    const end = patch.endAt ?? r.end_at;
    if (end <= start) throw new HttpError(400, 'bad_request', 'It has to end after it starts.');
    if (end - start > 12 * 3_600_000) throw new HttpError(400, 'bad_request', 'That is over 12 hours long.');
    run(
      ctx.db,
      `UPDATE schedule_activities SET title = ?, blurb = ?, location = ?, kind = ?, highlight = ?, link = ?,
         start_at = ?, end_at = ?, planned_start_at = ?, updated_at = ? WHERE id = ?`,
      patch.title ?? r.title,
      patch.blurb ?? r.blurb,
      patch.location ?? r.location,
      patch.kind ?? r.kind,
      patch.highlight === undefined ? r.highlight : patch.highlight ? 1 : 0,
      patch.link === undefined ? r.link : patch.link,
      start,
      end,
      patch.startAt === undefined ? r.planned_start_at : patch.startAt,
      now,
      id,
    );
    bump(ctx);
  });
  return publish(ctx, { kind: 'edited', activityId: id });
}

export function setHighlight(ctx: FeatureContext, id: number, highlight: boolean): ScheduleState {
  getRow(ctx, id);
  run(ctx.db, 'UPDATE schedule_activities SET highlight = ?, updated_at = ? WHERE id = ?', highlight ? 1 : 0, ctx.now(), id);
  bump(ctx);
  return publish(ctx, { kind: 'highlighted', activityId: id, highlight });
}

export function deleteActivity(ctx: FeatureContext, id: number): ScheduleState {
  getRow(ctx, id);
  run(ctx.db, 'DELETE FROM schedule_activities WHERE id = ?', id);
  bump(ctx);
  return publish(ctx, { kind: 'deleted', activityId: id });
}

export function resetSchedule(ctx: FeatureContext, reseed: boolean, seed: (ctx: FeatureContext) => void): ScheduleState {
  mutate(ctx, () => {
    run(ctx.db, 'DELETE FROM schedule_activities');
    invalidate(ctx);
    if (reseed) seed(ctx);
    invalidate(ctx);
    bump(ctx);
  });
  return publish(ctx, { kind: 'reset' });
}
