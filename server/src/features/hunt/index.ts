// Treasure hunt (spec 5.5). Individual, shuffled order, QR or typed answers.
// Routes (all under /api/hunt):
//   attendee: GET /, POST /start, POST /scan, POST /answer, POST /hint
//   attendee|screen|admin: GET /board
//   admin: GET /admin, PUT /admin/state, POST /admin/stops, PUT|DELETE /admin/stops/:id,
//          POST /admin/stops/:id/rotate-token, PUT /admin/order, GET /admin/stickers,
//          GET /admin/progress, POST /admin/reset
import {
  HuntAdminOrderRequestSchema,
  HuntAdminResetRequestSchema,
  HuntAdminStateRequestSchema,
  type HuntAdmin,
  type HuntAdminProgress,
  type HuntAdminStop,
  type HuntAttemptResult,
  HuntAnswerRequestSchema,
  type HuntBoard,
  HuntHintRequestSchema,
  type HuntHintResult,
  type HuntMe,
  HuntScanRequestSchema,
  type HuntStickerSheet,
  HuntStopInputSchema,
  formatHuntCode,
  huntScanUrl,
  normaliseAnswer,
} from '@afterhours/shared/features/hunt';
import { z } from 'zod';
import {
  type FeatureContext,
  all,
  badRequest,
  conflict,
  defineFeature,
  getAttendee,
  isScreen,
  notFound,
  one,
  parse,
  requireAdmin,
  requireAttendee,
  run,
  tx,
  unauthorized,
} from '../../core';
import { parseAvatar } from '../../core/points/ledger';
import {
  HUNT_SOURCE,
  type Stop,
  answer,
  buildBoard,
  buildMe,
  bump,
  crowdOf,
  getState,
  loadStops,
  newCode,
  newToken,
  revealHint,
  runtime,
  scan,
  startHunt,
} from './engine';
import { seedHunt } from './seed';
import { stopOrder } from './rules';

export const huntStickers = [
  { id: 'hunt-first-stamp', title: 'first stamp', hint: 'collect your first hunt stamp', shape: 'ticket', color: 'lime', glyph: 'map', feature: 'hunt', order: 60 },
  { id: 'hunt-finisher', title: 'hunt done', hint: 'find every stop on the hunt', shape: 'star', color: 'tangerine', glyph: 'flag', feature: 'hunt', order: 61 },
  { id: 'hunt-podium', title: 'top three', hint: 'finish the hunt in the first three', shape: 'burst', color: 'sun', glyph: 'crown', feature: 'hunt', order: 62 },
  { id: 'hunt-clean', title: 'no peeking', hint: 'finish the hunt without a single hint', shape: 'shield', color: 'sky', glyph: 'eye', feature: 'hunt', order: 63 },
] as const;

const IdParam = z.object({ id: z.coerce.number().int().positive() });

function stopToAdmin(ctx: FeatureContext, s: Stop, finale: boolean): HuntAdminStop {
  const cache = crowdOf(ctx);
  return {
    id: s.id,
    position: s.position,
    isFinal: finale,
    title: s.title,
    clue: s.clue,
    clueImage: s.clueImage,
    answers: s.answers,
    hints: s.hints,
    points: s.points,
    glyph: s.glyph as HuntAdminStop['glyph'],
    color: s.color as HuntAdminStop['color'],
    reveal: s.reveal,
    location: s.location,
    token: s.token,
    code: formatHuntCode(s.code),
    url: huntScanUrl(ctx.config.appUrl, s.token),
    solvedBy: cache.solvedBy.get(s.id) ?? 0,
    hereNow: cache.here.get(s.id) ?? 0,
  };
}

function playerCount(ctx: FeatureContext): number {
  return one<{ n: number }>(ctx.db, 'SELECT COUNT(*) AS n FROM hunt_players')?.n ?? 0;
}

function buildAdmin(ctx: FeatureContext): HuntAdmin {
  const st = getState(ctx);
  const stops = loadStops(ctx);
  const crowd = crowdOf(ctx).crowd;
  return {
    status: st.status,
    title: st.title,
    openedAt: st.openedAt,
    closedAt: st.closedAt,
    stops: stops.map((s, i) => stopToAdmin(ctx, s, i === stops.length - 1)),
    players: crowd.players,
    finished: crowd.finished,
    structureLocked: playerCount(ctx) > 0,
    serverNow: ctx.now(),
  };
}

function publishState(ctx: FeatureContext): void {
  const st = getState(ctx);
  const total = one<{ n: number }>(ctx.db, 'SELECT COUNT(*) AS n FROM hunt_stops')?.n ?? 0;
  ctx.live.publish('hunt.state', { status: st.status, title: st.title, total }, 'all');
}

/** Answers must contain letters or digits to be matchable; duplicates (after normalising) are dropped. */
function cleanAnswers(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of list) {
    const n = normaliseAnswer(a);
    if (n.length === 0) throw badRequest(`"${a}" has no letters or numbers to match. Spell it out (";" becomes "semicolon").`);
    if (!seen.has(n)) {
      seen.add(n);
      out.push(a);
    }
  }
  return out;
}

function requireUnlockedStructure(ctx: FeatureContext): void {
  if (playerCount(ctx) > 0) throw conflict('People already started. Reset the hunt before adding, removing or reordering stops.');
}

function insertStop(ctx: FeatureContext, input: z.output<typeof HuntStopInputSchema>): number {
  const pos = (one<{ m: number | null }>(ctx.db, 'SELECT MAX(position) AS m FROM hunt_stops')?.m ?? 0) + 1;
  return run(
    ctx.db,
    `INSERT INTO hunt_stops (position, title, clue, clue_image, answers, hints, points, glyph, color, reveal, location, token, code)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    pos,
    input.title,
    input.clue,
    input.clueImage,
    JSON.stringify(cleanAnswers(input.answers)),
    JSON.stringify(input.hints),
    input.points,
    input.glyph,
    input.color,
    input.reveal,
    input.location,
    newToken(),
    newCode(ctx),
  ).lastId;
}

export const hunt = defineFeature({
  name: 'hunt',
  stickers: [...huntStickers],

  routes(app, ctx) {
    // ---------- attendee ----------

    // GET /api/hunt  -> HuntMe
    app.get('/', async (req): Promise<HuntMe> => {
      const me = requireAttendee(req);
      return buildMe(ctx, me.attendeeId);
    });

    // POST /api/hunt/start  -> HuntMe (starts the clock; repeating it changes nothing)
    app.post('/start', async (req): Promise<HuntMe> => {
      const me = requireAttendee(req);
      return startHunt(ctx, me.attendeeId);
    });

    // POST /api/hunt/scan { code }  -> HuntAttemptResult
    app.post('/scan', async (req): Promise<HuntAttemptResult> => {
      const me = requireAttendee(req);
      const { code } = parse(HuntScanRequestSchema, req.body);
      return scan(ctx, me.attendeeId, code);
    });

    // POST /api/hunt/answer { stopId, answer }  -> HuntAttemptResult
    app.post('/answer', async (req): Promise<HuntAttemptResult> => {
      const me = requireAttendee(req);
      const body = parse(HuntAnswerRequestSchema, req.body);
      return answer(ctx, me.attendeeId, body.stopId, body.answer);
    });

    // POST /api/hunt/hint { stopId, n }  -> HuntHintResult
    app.post('/hint', async (req): Promise<HuntHintResult> => {
      const me = requireAttendee(req);
      const body = parse(HuntHintRequestSchema, req.body);
      return revealHint(ctx, me.attendeeId, body.stopId, body.n);
    });

    // GET /api/hunt/board (attendee, projector or console)  -> HuntBoard
    app.get('/board', async (req): Promise<HuntBoard> => {
      if (!getAttendee(req) && !isScreen(req)) throw unauthorized('Sign in first.');
      return buildBoard(ctx);
    });

    // ---------- console ----------

    // GET /api/hunt/admin  -> HuntAdmin (includes answers and tokens: console only)
    app.get('/admin', async (req): Promise<HuntAdmin> => {
      requireAdmin(req);
      return buildAdmin(ctx);
    });

    // PUT /api/hunt/admin/state { status?, title? }  -> HuntAdmin
    app.put('/admin/state', async (req): Promise<HuntAdmin> => {
      requireAdmin(req);
      const body = parse(HuntAdminStateRequestSchema, req.body);
      const st = getState(ctx);
      const now = ctx.now();
      if (body.title !== undefined) run(ctx.db, 'UPDATE hunt_state SET title = ? WHERE id = 1', body.title);
      if (body.status !== undefined && body.status !== st.status) {
        const stops = loadStops(ctx);
        if (body.status === 'open') {
          if (stops.length < 2) throw conflict('Add at least two stops before opening.');
          run(ctx.db, 'UPDATE hunt_state SET status = ?, opened_at = COALESCE(opened_at, ?), closed_at = NULL WHERE id = 1', 'open', now);
        } else if (body.status === 'closed') {
          run(ctx.db, 'UPDATE hunt_state SET status = ?, closed_at = ? WHERE id = 1', 'closed', now);
        } else {
          if (playerCount(ctx) > 0) throw conflict('People already started, so it cannot go back to draft. Close it, or reset.');
          run(ctx.db, 'UPDATE hunt_state SET status = ?, opened_at = NULL, closed_at = NULL WHERE id = 1', 'draft');
        }
      }
      bump(ctx);
      publishState(ctx);
      return buildAdmin(ctx);
    });

    // POST /api/hunt/admin/stops  -> HuntAdmin. The new stop becomes the finale (last in order).
    app.post('/admin/stops', async (req): Promise<HuntAdmin> => {
      requireAdmin(req);
      const input = parse(HuntStopInputSchema, req.body);
      requireUnlockedStructure(ctx);
      insertStop(ctx, input);
      bump(ctx);
      publishState(ctx);
      return buildAdmin(ctx);
    });

    // PUT /api/hunt/admin/stops/:id  -> HuntAdmin. Wording, answers, hints, points can change any time.
    app.put('/admin/stops/:id', async (req): Promise<HuntAdmin> => {
      requireAdmin(req);
      const { id } = parse(IdParam, req.params);
      const input = parse(HuntStopInputSchema, req.body);
      const r = run(
        ctx.db,
        `UPDATE hunt_stops SET title = ?, clue = ?, clue_image = ?, answers = ?, hints = ?, points = ?, glyph = ?, color = ?, reveal = ?, location = ?
          WHERE id = ?`,
        input.title,
        input.clue,
        input.clueImage,
        JSON.stringify(cleanAnswers(input.answers)),
        JSON.stringify(input.hints),
        input.points,
        input.glyph,
        input.color,
        input.reveal,
        input.location,
        id,
      );
      if (r.changes === 0) throw notFound('No such stop.');
      bump(ctx);
      return buildAdmin(ctx);
    });

    // DELETE /api/hunt/admin/stops/:id  -> HuntAdmin
    app.delete('/admin/stops/:id', async (req): Promise<HuntAdmin> => {
      requireAdmin(req);
      const { id } = parse(IdParam, req.params);
      requireUnlockedStructure(ctx);
      tx(ctx.db, () => {
        if (run(ctx.db, 'DELETE FROM hunt_stops WHERE id = ?', id).changes === 0) throw notFound('No such stop.');
        loadStops(ctx).forEach((s, i) => run(ctx.db, 'UPDATE hunt_stops SET position = ? WHERE id = ?', i + 1, s.id));
      });
      bump(ctx);
      publishState(ctx);
      return buildAdmin(ctx);
    });

    // POST /api/hunt/admin/stops/:id/rotate-token  -> HuntAdmin. Use if a sticker photo leaked: old QR/code stop working.
    app.post('/admin/stops/:id/rotate-token', async (req): Promise<HuntAdmin> => {
      requireAdmin(req);
      const { id } = parse(IdParam, req.params);
      const r = run(ctx.db, 'UPDATE hunt_stops SET token = ?, code = ? WHERE id = ?', newToken(), newCode(ctx), id);
      if (r.changes === 0) throw notFound('No such stop.');
      bump(ctx);
      return buildAdmin(ctx);
    });

    // PUT /api/hunt/admin/order { ids }  -> HuntAdmin. Authoring order; the last stop is the finale.
    app.put('/admin/order', async (req): Promise<HuntAdmin> => {
      requireAdmin(req);
      const { ids } = parse(HuntAdminOrderRequestSchema, req.body);
      requireUnlockedStructure(ctx);
      const current = loadStops(ctx).map((s) => s.id);
      if (ids.length !== current.length || new Set(ids).size !== ids.length || !ids.every((i) => current.includes(i))) {
        throw badRequest('Send every stop id exactly once.');
      }
      tx(ctx.db, () => ids.forEach((id, i) => run(ctx.db, 'UPDATE hunt_stops SET position = ? WHERE id = ?', i + 1, id)));
      bump(ctx);
      return buildAdmin(ctx);
    });

    // GET /api/hunt/admin/stickers  -> HuntStickerSheet (the web renders url as a QR and prints the code under it)
    app.get('/admin/stickers', async (req): Promise<HuntStickerSheet> => {
      requireAdmin(req);
      return {
        title: getState(ctx).title,
        stops: loadStops(ctx).map((s) => ({
          stopId: s.id,
          position: s.position,
          title: s.title,
          location: s.location,
          token: s.token,
          code: formatHuntCode(s.code),
          url: huntScanUrl(ctx.config.appUrl, s.token),
        })),
      };
    });

    // GET /api/hunt/admin/progress  -> HuntAdminProgress
    app.get('/admin/progress', async (req): Promise<HuntAdminProgress> => {
      requireAdmin(req);
      return buildProgress(ctx);
    });

    // POST /api/hunt/admin/reset { confirm: 'RESET HUNT' }  -> HuntAdmin
    // Wipes progress, hint/lock state, finish order, hunt points and hunt stickers. Keeps the stops. New shuffle seed.
    app.post('/admin/reset', async (req): Promise<HuntAdmin> => {
      requireAdmin(req);
      parse(HuntAdminResetRequestSchema, req.body);
      tx(ctx.db, () => {
        run(ctx.db, 'DELETE FROM hunt_progress');
        run(ctx.db, 'DELETE FROM hunt_stop_state');
        run(ctx.db, 'DELETE FROM hunt_players');
        run(ctx.db, 'DELETE FROM points_ledger WHERE source = ?', HUNT_SOURCE);
        run(ctx.db, "DELETE FROM sticker_unlocks WHERE sticker_id LIKE 'hunt-%'");
        run(ctx.db, "UPDATE hunt_state SET status = 'draft', opened_at = NULL, closed_at = NULL, shuffle_seed = lower(hex(randomblob(16))) WHERE id = 1");
      });
      const rt = runtime(ctx);
      rt.answers.sweep();
      ctx.points.invalidate();
      bump(ctx);
      publishState(ctx);
      ctx.live.publish('leaderboard.changed', { at: ctx.now() }, 'all');
      return buildAdmin(ctx);
    });
  },

  // Broadcast the anonymous crowd counts at most every 1.5 s, and only if something moved.
  tick: {
    everyMs: 1500,
    run(ctx) {
      const rt = runtime(ctx);
      if (!rt.dirty) return;
      rt.dirty = false;
      if (getState(ctx).status === 'draft') return;
      ctx.live.publish('hunt.crowd', crowdOf(ctx).crowd, 'all');
    },
  },

  async seed(ctx) {
    seedHunt(ctx);
  },
});

function buildProgress(ctx: FeatureContext): HuntAdminProgress {
  const st = getState(ctx);
  const stops = loadStops(ctx);
  const ids = stops.map((s) => s.id);
  const titles = new Map(stops.map((s) => [s.id, s.title]));
  const solvedCount = new Map(
    all<{ attendee_id: number; n: number }>(ctx.db, 'SELECT attendee_id, COUNT(*) AS n FROM hunt_progress GROUP BY attendee_id').map((r) => [r.attendee_id, r.n]),
  );
  const hints = new Map(
    all<{ attendee_id: number; n: number }>(ctx.db, 'SELECT attendee_id, SUM(hints_used) AS n FROM hunt_stop_state GROUP BY attendee_id').map((r) => [r.attendee_id, r.n]),
  );
  const rows = all<{
    attendee_id: number;
    nickname: string | null;
    avatar: string | null;
    name: string | null;
    roll: string | null;
    started_at: number;
    last_at: number;
    finished_at: number | null;
    finish_rank: number | null;
    elapsed_ms: number | null;
  }>(
    ctx.db,
    `SELECT p.attendee_id, a.nickname, a.avatar, a.name, a.roll, p.started_at, p.last_at, p.finished_at, p.finish_rank, p.elapsed_ms
       FROM hunt_players p JOIN attendees a ON a.id = p.attendee_id
      ORDER BY p.finish_rank IS NULL, p.finish_rank, p.started_at`,
  );
  return {
    total: stops.length,
    rows: rows.map((r) => {
      const solved = solvedCount.get(r.attendee_id) ?? 0;
      const curId = r.finished_at === null ? (stopOrder(st.seed, r.attendee_id, ids)[solved] ?? null) : null;
      return {
        attendeeId: r.attendee_id,
        nickname: r.nickname,
        avatar: r.avatar ? parseAvatar(r.avatar) : null,
        name: r.name,
        roll: r.roll,
        solved,
        currentStopId: curId,
        currentStopTitle: curId === null ? null : (titles.get(curId) ?? null),
        hintsUsed: hints.get(r.attendee_id) ?? 0,
        startedAt: r.started_at,
        lastActiveAt: r.last_at,
        finishedAt: r.finished_at,
        rank: r.finish_rank,
        elapsedMs: r.elapsed_ms,
      };
    }),
    crowd: crowdOf(ctx).crowd.here.map((h) => ({ stopId: h.stopId, title: titles.get(h.stopId) ?? '', count: h.count })),
  };
}
