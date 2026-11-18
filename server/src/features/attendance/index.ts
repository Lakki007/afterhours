// Per-activity check-in (spec 5.2).
// Event attendance is core's first sign-in (attendees.first_signin_at); this feature adds the
// rotating 4-character code per activity, the console controls and the CSV exports.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  type AdminOverview,
  type AdminWindow,
  AdminOverviewSchema,
  type AttendanceList,
  AttendanceListQuerySchema,
  CHECKIN_CODE_ALPHABET,
  CHECKIN_CODE_LENGTH,
  CHECKIN_POINTS,
  CHECKIN_WINDOW_MS,
  type CheckinResponse,
  CheckinRequestSchema,
  CloseCheckinRequestSchema,
  ActivityIdSchema,
  ManualCheckinRequestSchema,
  type MyAttendance,
  OpenCheckinRequestSchema,
  type ScreenCheckin,
  type ScreenCheckins,
} from '@afterhours/shared/features/attendance';
import {
  type Db,
  type FeatureContext,
  HttpError,
  RateLimiter,
  all,
  badRequest,
  defineFeature,
  notFound,
  one,
  parse,
  requireAdmin,
  requireAttendee,
  requireScreen,
  run,
  tx,
} from '../../core';
// Read-only: check-ins belong to schedule activities.
import { loadRows as scheduleRows } from '../schedule/service';

/** Check-ins that earn the bigger stickers. */
export const REGULAR_AT = 3;
export const EVERYWHERE_AT = 5;
/** Wrong codes allowed per attendee per minute before they are told to wait. */
export const FAILS_PER_MIN = 5;

interface WindowRow {
  activity_id: string;
  title: string;
  is_open: number;
  opened_at: number;
  closed_at: number | null;
  closes_at: number | null;
}

interface State {
  limiter: RateLimiter;
  secret: Buffer | null;
  lastWindow: Map<string, number>;
  arrivals: Map<string, string[]>;
  countsDirty: boolean;
}

const states = new WeakMap<FeatureContext, State>();
function state(ctx: FeatureContext): State {
  let s = states.get(ctx);
  if (!s) {
    // Only wrong guesses use up tokens (see checkin): 5 misses a minute is plenty for a fat-fingered human.
    s = {
      limiter: new RateLimiter({ limit: FAILS_PER_MIN, windowMs: 60_000, now: ctx.now }),
      secret: null,
      lastWindow: new Map(),
      arrivals: new Map(),
      countsDirty: false,
    };
    states.set(ctx, s);
  }
  return s;
}

function secretOf(ctx: FeatureContext): Buffer {
  const s = state(ctx);
  if (s.secret) return s.secret;
  const row = one<{ secret: string }>(ctx.db, 'SELECT secret FROM attendance_secret WHERE id = 1');
  if (row) s.secret = Buffer.from(row.secret, 'hex');
  else {
    const fresh = randomBytes(32);
    run(ctx.db, 'INSERT OR IGNORE INTO attendance_secret (id, secret) VALUES (1, ?)', fresh.toString('hex'));
    const again = one<{ secret: string }>(ctx.db, 'SELECT secret FROM attendance_secret WHERE id = 1');
    s.secret = Buffer.from(again?.secret ?? fresh.toString('hex'), 'hex');
  }
  return s.secret;
}

export const windowIndex = (ms: number): number => Math.floor(ms / CHECKIN_WINDOW_MS);

/** The code for an activity in a time window: HMAC(secret, "<activityId>:<window>") mapped onto the alphabet. */
export function codeFor(secret: Buffer, activityId: string, window: number): string {
  const mac = createHmac('sha256', secret).update(`${activityId}:${window}`).digest();
  let out = '';
  for (let i = 0; i < CHECKIN_CODE_LENGTH; i++) out += CHECKIN_CODE_ALPHABET[(mac[i] ?? 0) % CHECKIN_CODE_ALPHABET.length];
  return out;
}

function codeMatches(secret: Buffer, activityId: string, now: number, code: string): boolean {
  const w = windowIndex(now);
  const given = Buffer.from(code);
  let ok = false;
  for (const win of [w, w - 1]) {
    const want = Buffer.from(codeFor(secret, activityId, win));
    // Evaluate both windows unconditionally; no early exit on the first hit.
    if (want.length === given.length && timingSafeEqual(want, given)) ok = true;
  }
  return ok;
}

/** The schedule activity behind a check-in id, or a 404. */
function scheduleActivity(ctx: FeatureContext, activityId: string): { id: number; title: string } {
  const row = /^\d+$/.test(activityId) ? scheduleRows(ctx).find((r) => r.id === Number(activityId)) : undefined;
  if (!row) throw notFound("That activity isn't on the schedule.");
  return row;
}

const countFor = (db: Db, activityId: string): number =>
  one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM attendance_checkins WHERE activity_id = ?', activityId)?.n ?? 0;

const openWindows = (db: Db): WindowRow[] => all<WindowRow>(db, 'SELECT * FROM attendance_windows WHERE is_open = 1 ORDER BY opened_at, activity_id');

function qrUrl(ctx: FeatureContext, activityId: string, code: string): string {
  return `${ctx.config.appUrl}/checkin?a=${encodeURIComponent(activityId)}&code=${code}`;
}

function toAdminWindow(db: Db, w: WindowRow): AdminWindow {
  return {
    activityId: w.activity_id,
    title: w.title,
    open: w.is_open === 1,
    openedAt: w.opened_at,
    closedAt: w.closed_at,
    closesAt: w.closes_at,
    count: countFor(db, w.activity_id),
  };
}

function publishCode(ctx: FeatureContext, w: WindowRow): void {
  const win = windowIndex(ctx.now());
  const code = codeFor(secretOf(ctx), w.activity_id, win);
  state(ctx).lastWindow.set(w.activity_id, win);
  ctx.live.publish('attendance.code', { activityId: w.activity_id, code, rotatesAt: (win + 1) * CHECKIN_WINDOW_MS, qrUrl: qrUrl(ctx, w.activity_id, code) }, 'screens');
}

function closeWindow(ctx: FeatureContext, w: WindowRow): void {
  run(ctx.db, 'UPDATE attendance_windows SET is_open = 0, closed_at = ? WHERE activity_id = ?', ctx.now(), w.activity_id);
  state(ctx).lastWindow.delete(w.activity_id);
  ctx.live.publish('attendance.state', { activityId: w.activity_id, title: w.title, open: false, closesAt: w.closes_at }, 'all');
}

/** Record a check-in (code or manual). Idempotent: one row, one award per attendee per activity. */
export function recordCheckin(ctx: FeatureContext, attendeeId: number, w: WindowRow, method: 'code' | 'manual'): CheckinResponse {
  const at = ctx.now();
  const { fresh, rowId } = tx(ctx.db, () => {
    const r = run(ctx.db, 'INSERT OR IGNORE INTO attendance_checkins (attendee_id, activity_id, at, method) VALUES (?, ?, ?, ?)', attendeeId, w.activity_id, at, method);
    const row = one<{ id: number; at: number }>(ctx.db, 'SELECT id, at FROM attendance_checkins WHERE attendee_id = ? AND activity_id = ?', attendeeId, w.activity_id);
    return { fresh: r.changes === 1, rowId: row?.id ?? 0 };
  });
  const mine = one<{ n: number }>(ctx.db, 'SELECT COUNT(*) AS n FROM attendance_checkins WHERE attendee_id = ?', attendeeId)?.n ?? 0;
  const position = one<{ n: number }>(ctx.db, 'SELECT COUNT(*) AS n FROM attendance_checkins WHERE activity_id = ? AND id <= ?', w.activity_id, rowId)?.n ?? 1;
  let points = 0;
  if (fresh) {
    const a = ctx.points.award({ attendeeId, source: 'attendance', ref: `checkin:${w.activity_id}`, points: CHECKIN_POINTS, label: `checked in: ${w.title}` });
    points = a.awarded ? CHECKIN_POINTS : 0;
    ctx.stickers.unlock(attendeeId, 'attendance-first');
    if (mine >= REGULAR_AT) ctx.stickers.unlock(attendeeId, 'attendance-regular');
    if (mine >= EVERYWHERE_AT) ctx.stickers.unlock(attendeeId, 'attendance-everywhere');
    const s = state(ctx);
    s.countsDirty = true;
    const nick = one<{ nickname: string | null }>(ctx.db, 'SELECT nickname FROM attendees WHERE id = ?', attendeeId)?.nickname;
    if (nick) {
      const list = s.arrivals.get(w.activity_id) ?? [];
      if (list.length < 40) list.push(nick);
      s.arrivals.set(w.activity_id, list);
    }
  }
  const at2 = one<{ at: number }>(ctx.db, 'SELECT at FROM attendance_checkins WHERE id = ?', rowId)?.at ?? at;
  return {
    activityId: w.activity_id,
    title: w.title,
    newlyCheckedIn: fresh,
    points,
    position,
    count: countFor(ctx.db, w.activity_id),
    myCheckins: mine,
    at: at2,
  };
}

// CSV ---------------------------------------------------------------------

/** Quote a cell; neutralise spreadsheet formulas (=, +, -, @) that attendee-typed names could smuggle in. */
export function csvCell(v: string | number | null | undefined): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const csvLine = (cells: (string | number | null | undefined)[]): string => cells.map(csvCell).join(',');
const iso = (ms: number): string => new Date(ms).toISOString();

const likeEscape = (q: string): string => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const SEARCH = "(a.name LIKE ? ESCAPE '\\' OR a.roll LIKE ? ESCAPE '\\' OR a.nickname LIKE ? ESCAPE '\\' OR a.kit_id LIKE ? ESCAPE '\\')";

interface Row {
  id: number;
  name: string | null;
  roll: string | null;
  nickname: string | null;
  kit_id: string;
  at: number;
  checkins?: number;
}
const toRow = (r: Row) => ({ attendeeId: r.id, name: r.name, roll: r.roll, nickname: r.nickname, kitId: r.kit_id, at: r.at, ...(r.checkins === undefined ? {} : { checkins: r.checkins }) });

function eventRows(db: Db, q: string | undefined, limit: number, offset: number): AttendanceList {
  const where = q ? `WHERE ${SEARCH}` : '';
  const args = q ? Array(4).fill(likeEscape(q)) : [];
  const total = one<{ n: number }>(db, `SELECT COUNT(*) AS n FROM attendees a ${where}`, ...args)?.n ?? 0;
  const rows = all<Row>(
    db,
    `SELECT a.id, a.name, a.roll, a.nickname, a.kit_id, a.first_signin_at AS at,
            (SELECT COUNT(*) FROM attendance_checkins c WHERE c.attendee_id = a.id) AS checkins
       FROM attendees a ${where} ORDER BY a.first_signin_at, a.id LIMIT ? OFFSET ?`,
    ...args,
    limit,
    offset,
  );
  return { total, rows: rows.map(toRow) };
}

function activityRows(db: Db, activityId: string, q: string | undefined, limit: number, offset: number): AttendanceList {
  const where = `WHERE c.activity_id = ?${q ? ` AND ${SEARCH}` : ''}`;
  const args = q ? [activityId, ...Array(4).fill(likeEscape(q))] : [activityId];
  const total = one<{ n: number }>(db, `SELECT COUNT(*) AS n FROM attendance_checkins c JOIN attendees a ON a.id = c.attendee_id ${where}`, ...args)?.n ?? 0;
  const rows = all<Row>(
    db,
    `SELECT a.id, a.name, a.roll, a.nickname, a.kit_id, c.at AS at
       FROM attendance_checkins c JOIN attendees a ON a.id = c.attendee_id ${where} ORDER BY c.id LIMIT ? OFFSET ?`,
    ...args,
    limit,
    offset,
  );
  return { total, rows: rows.map(toRow) };
}

// Tick --------------------------------------------------------------------

export function tick(ctx: FeatureContext): void {
  const s = state(ctx);
  const now = ctx.now();
  const open = openWindows(ctx.db);
  for (const w of open) {
    if (w.closes_at !== null && w.closes_at <= now) {
      closeWindow(ctx, w);
      s.countsDirty = true;
      continue;
    }
    if (s.lastWindow.get(w.activity_id) !== windowIndex(now)) publishCode(ctx, w);
  }
  if (s.countsDirty) {
    s.countsDirty = false;
    const counts: Record<string, number> = {};
    for (const r of all<{ activity_id: string; n: number }>(ctx.db, 'SELECT activity_id, COUNT(*) AS n FROM attendance_checkins GROUP BY activity_id')) counts[r.activity_id] = r.n;
    ctx.live.publish('attendance.counts', { counts }, 'all');
  }
  if (s.arrivals.size > 0) {
    for (const [activityId, names] of s.arrivals) ctx.live.publish('attendance.arrivals', { activityId, names: names.slice(-5) }, 'screens');
    s.arrivals.clear();
  }
}

// Feature ---------------------------------------------------------------

export const attendance = defineFeature({
  name: 'attendance',

  stickers: [
    { id: 'attendance-first', title: 'in the room', hint: 'check in to an activity', shape: 'ticket', color: 'lime', glyph: 'check', feature: 'attendance', order: 10 },
    { id: 'attendance-regular', title: 'regular', hint: `check in to ${REGULAR_AT} activities`, shape: 'star', color: 'sky', glyph: 'star', feature: 'attendance', order: 11 },
    { id: 'attendance-everywhere', title: 'everywhere', hint: `check in to ${EVERYWHERE_AT} activities`, shape: 'burst', color: 'pink', glyph: 'crown', feature: 'attendance', order: 12 },
  ],

  boot(ctx) {
    secretOf(ctx);
  },

  routes(app, ctx) {
    // GET /api/attendance/me: open check-ins (no codes) and what I have done.
    app.get('/me', async (req): Promise<MyAttendance> => {
      const me = requireAttendee(req);
      const signedIn = one<{ t: number }>(ctx.db, 'SELECT first_signin_at AS t FROM attendees WHERE id = ?', me.attendeeId)?.t ?? 0;
      const mine = all<{ activity_id: string; at: number }>(ctx.db, 'SELECT activity_id, at FROM attendance_checkins WHERE attendee_id = ? ORDER BY at', me.attendeeId);
      const done = new Set(mine.map((m) => m.activity_id));
      const titles = new Map(all<{ activity_id: string; title: string }>(ctx.db, 'SELECT activity_id, title FROM attendance_windows').map((r) => [r.activity_id, r.title]));
      return {
        eventSignedInAt: signedIn,
        open: openWindows(ctx.db).map((w) => ({
          activityId: w.activity_id,
          title: w.title,
          openedAt: w.opened_at,
          closesAt: w.closes_at,
          count: countFor(ctx.db, w.activity_id),
          checkedIn: done.has(w.activity_id),
        })),
        checkins: mine.map((m) => ({ activityId: m.activity_id, title: titles.get(m.activity_id) ?? m.activity_id, at: m.at })),
        here: one<{ n: number }>(ctx.db, 'SELECT COUNT(*) AS n FROM attendees')?.n ?? 0,
      };
    });

    // POST /api/attendance/checkin { code, activityId? }
    app.post('/checkin', async (req): Promise<CheckinResponse> => {
      const me = requireAttendee(req);
      const body = parse(CheckinRequestSchema, req.body);
      const s = state(ctx);
      const key = `a:${me.attendeeId}`;
      if (!s.limiter.allowed(key)) {
        throw new HttpError(429, 'rate_limited', 'Too many wrong codes. Look at the screen, breathe, try again in a bit.', {
          retryAfter: Math.max(1, s.limiter.retryAfter(key)),
        });
      }
      const candidates = openWindows(ctx.db).filter((w) => !body.activityId || w.activity_id === body.activityId);
      const secret = secretOf(ctx);
      const now = ctx.now();
      const hit = candidates.find((w) => (w.closes_at === null || w.closes_at > now) && codeMatches(secret, w.activity_id, now, body.code));
      if (!hit) {
        s.limiter.hit(key); // only misses cost tokens
        throw new HttpError(400, 'bad_code', candidates.length === 0 ? 'No check-in is open right now.' : 'Not the right code. It changes every 30 seconds, check the screen.');
      }
      return recordCheckin(ctx, me.attendeeId, hit, 'code');
    });

    // GET /api/attendance/screen (projector / console preview): codes + counts for every open check-in.
    app.get('/screen', async (req): Promise<ScreenCheckins> => {
      requireScreen(req);
      const now = ctx.now();
      const win = windowIndex(now);
      const secret = secretOf(ctx);
      const open: ScreenCheckin[] = openWindows(ctx.db).map((w) => {
        const code = codeFor(secret, w.activity_id, win);
        return { activityId: w.activity_id, title: w.title, code, rotatesAt: (win + 1) * CHECKIN_WINDOW_MS, qrUrl: qrUrl(ctx, w.activity_id, code), count: countFor(ctx.db, w.activity_id), closesAt: w.closes_at };
      });
      return { now, windowMs: CHECKIN_WINDOW_MS, open };
    });

    // ---- console ----

    // GET /api/attendance/admin/overview
    app.get('/admin/overview', async (req): Promise<AdminOverview> => {
      requireAdmin(req);
      const windows = all<WindowRow>(ctx.db, 'SELECT * FROM attendance_windows ORDER BY is_open DESC, opened_at DESC').map((w) => toAdminWindow(ctx.db, w));
      return AdminOverviewSchema.parse({
        eventCount: one<{ n: number }>(ctx.db, 'SELECT COUNT(*) AS n FROM attendees')?.n ?? 0,
        profileCount: one<{ n: number }>(ctx.db, 'SELECT COUNT(*) AS n FROM attendees WHERE profile_complete = 1')?.n ?? 0,
        windows,
      });
    });

    // POST /api/attendance/admin/open { activityId, title, closesAt? }  (re-opening a closed one keeps its check-ins)
    app.post('/admin/open', async (req): Promise<AdminWindow> => {
      requireAdmin(req);
      const b = parse(OpenCheckinRequestSchema, req.body);
      const activity = scheduleActivity(ctx, b.activityId);
      const title = b.title ?? activity.title;
      const now = ctx.now();
      if (b.closesAt != null && b.closesAt <= now) throw badRequest('The auto-close time is already past.');
      run(
        ctx.db,
        `INSERT INTO attendance_windows (activity_id, title, is_open, opened_at, closed_at, closes_at) VALUES (?, ?, 1, ?, NULL, ?)
         ON CONFLICT(activity_id) DO UPDATE SET title = excluded.title, is_open = 1, opened_at = excluded.opened_at, closed_at = NULL, closes_at = excluded.closes_at`,
        b.activityId,
        title,
        now,
        b.closesAt ?? null,
      );
      const w = one<WindowRow>(ctx.db, 'SELECT * FROM attendance_windows WHERE activity_id = ?', b.activityId);
      if (!w) throw notFound();
      ctx.live.publish('attendance.state', { activityId: w.activity_id, title: w.title, open: true, closesAt: w.closes_at }, 'all');
      publishCode(ctx, w);
      return toAdminWindow(ctx.db, w);
    });

    // POST /api/attendance/admin/close { activityId }
    app.post('/admin/close', async (req): Promise<AdminWindow> => {
      requireAdmin(req);
      const b = parse(CloseCheckinRequestSchema, req.body);
      const w = one<WindowRow>(ctx.db, 'SELECT * FROM attendance_windows WHERE activity_id = ?', b.activityId);
      if (!w) throw notFound('That check-in was never opened.');
      if (w.is_open === 1) closeWindow(ctx, w);
      return toAdminWindow(ctx.db, one<WindowRow>(ctx.db, 'SELECT * FROM attendance_windows WHERE activity_id = ?', b.activityId) ?? w);
    });

    // GET /api/attendance/admin/event?q=&limit=&offset=  (everyone who signed in)
    app.get('/admin/event', async (req): Promise<AttendanceList> => {
      requireAdmin(req);
      const q = parse(AttendanceListQuerySchema, req.query);
      return eventRows(ctx.db, q.q || undefined, q.limit, q.offset);
    });

    // GET /api/attendance/admin/activity/:id?q=&limit=&offset=
    app.get('/admin/activity/:id', async (req): Promise<AttendanceList> => {
      requireAdmin(req);
      const id = parse(ActivityIdSchema, (req.params as { id: string }).id);
      const q = parse(AttendanceListQuerySchema, req.query);
      return activityRows(ctx.db, id, q.q || undefined, q.limit, q.offset);
    });

    // POST /api/attendance/admin/activity/:id/checkin { attendeeId }  (dead phone at the door)
    app.post('/admin/activity/:id/checkin', async (req): Promise<CheckinResponse> => {
      requireAdmin(req);
      const id = parse(ActivityIdSchema, (req.params as { id: string }).id);
      const b = parse(ManualCheckinRequestSchema, req.body);
      const w = one<WindowRow>(ctx.db, 'SELECT * FROM attendance_windows WHERE activity_id = ?', id);
      if (!w) throw notFound('Open the check-in for that activity first.');
      if (!one(ctx.db, 'SELECT 1 AS x FROM attendees WHERE id = ?', b.attendeeId)) throw notFound('No such attendee.');
      return recordCheckin(ctx, b.attendeeId, w, 'manual');
    });

    // GET /api/attendance/admin/export/event.csv
    app.get('/admin/export/event.csv', async (req, reply): Promise<string> => {
      requireAdmin(req);
      const rows = eventRows(ctx.db, undefined, 100_000, 0).rows;
      const lines = [csvLine(['kit_id', 'name', 'roll', 'nickname', 'signed_in_at', 'activity_checkins'])];
      for (const r of rows) lines.push(csvLine([r.kitId, r.name, r.roll, r.nickname, iso(r.at), r.checkins ?? 0]));
      return sendCsv(reply, 'attendance-event.csv', lines);
    });

    // GET /api/attendance/admin/export/activity/:id.csv
    app.get('/admin/export/activity/:id.csv', async (req, reply): Promise<string> => {
      requireAdmin(req);
      const id = parse(ActivityIdSchema, (req.params as { id: string }).id);
      const w = one<WindowRow>(ctx.db, 'SELECT * FROM attendance_windows WHERE activity_id = ?', id);
      if (!w) throw notFound('That check-in was never opened.');
      const rows = activityRows(ctx.db, id, undefined, 100_000, 0).rows;
      const lines = [csvLine(['activity_id', 'activity', 'kit_id', 'name', 'roll', 'nickname', 'checked_in_at'])];
      for (const r of rows) lines.push(csvLine([id, w.title, r.kitId, r.name, r.roll, r.nickname, iso(r.at)]));
      return sendCsv(reply, `attendance-${id.replace(/[^A-Za-z0-9_-]/g, '_')}.csv`, lines);
    });
  },

  tick: { everyMs: 1000, run: tick },

  // Check-ins hang off real schedule activities, so the schedule seeds first.
  seedAfter: ['schedule'],

  seed(ctx) {
    const crowd = all<{ id: number }>(ctx.db, 'SELECT id FROM attendees WHERE profile_complete = 1 ORDER BY id');
    const now = ctx.now();
    // The first three activities of the demo afternoon: two closed check-ins and one still open.
    const shape = [
      { share: 0.95, ago: 38 },
      { share: 0.7, ago: 20 },
      { share: 0.4, ago: 6 },
    ];
    const plan = scheduleRows(ctx)
      .slice(0, shape.length)
      .map((r, i) => ({ id: String(r.id), title: r.title, ...shape[i]! }));
    const lastId = plan.at(-1)?.id;
    for (const p of plan) {
      const t0 = now - p.ago * 60_000;
      run(ctx.db, 'INSERT OR IGNORE INTO attendance_windows (activity_id, title, is_open, opened_at, closed_at, closes_at) VALUES (?, ?, ?, ?, ?, NULL)', p.id, p.title, p.id === lastId ? 1 : 0, t0, p.id === lastId ? null : t0 + 8 * 60_000);
      const n = Math.round(crowd.length * p.share);
      crowd.slice(0, n).forEach((c, i) => {
        run(ctx.db, "INSERT OR IGNORE INTO attendance_checkins (attendee_id, activity_id, at, method) VALUES (?, ?, ?, 'code')", c.id, p.id, t0 + 20_000 + i * 15_000);
        ctx.points.award({ attendeeId: c.id, source: 'attendance', ref: `checkin:${p.id}`, points: CHECKIN_POINTS, label: `checked in: ${p.title}` });
        ctx.stickers.unlock(c.id, 'attendance-first');
      });
    }
    for (const c of crowd) {
      const k = one<{ n: number }>(ctx.db, 'SELECT COUNT(*) AS n FROM attendance_checkins WHERE attendee_id = ?', c.id)?.n ?? 0;
      if (k >= REGULAR_AT) ctx.stickers.unlock(c.id, 'attendance-regular');
    }
  },
});

function sendCsv(reply: { header: (k: string, v: string) => unknown }, filename: string, lines: string[]): string {
  void reply.header('content-type', 'text/csv; charset=utf-8');
  void reply.header('content-disposition', `attachment; filename="${filename}"`);
  void reply.header('cache-control', 'no-store');
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

