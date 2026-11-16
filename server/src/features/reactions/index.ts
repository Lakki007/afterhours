// Reactions (spec 5.9): the worked example feature.
// Shows: routes under /api/reactions, a guard, Zod parsing with shared
// schemas, a per-attendee rate limit, a migration, a sticker, an idempotent
// award, a tick that batches, and a typed live event.
import {
  REACTION_KINDS,
  type ReactionKind,
  type ReactionStats,
  SendReactionRequestSchema,
} from '@afterhours/shared/features/reactions';
import type { Ok } from '@afterhours/shared';
import {
  type FeatureContext,
  RateLimiter,
  all,
  defineFeature,
  one,
  parse,
  requireAdmin,
  requireAttendee,
  run,
} from '../../core';

/** Taps needed for the "hype machine" sticker. */
export const HYPE_TAPS = 25;

interface State {
  pending: Partial<Record<ReactionKind, number>>;
  recent: number[]; // timestamps of taps in the last minute, for the console
  limiter: RateLimiter;
}

// One state per running app (tests build several apps in one process).
const states = new WeakMap<FeatureContext, State>();
function state(ctx: FeatureContext): State {
  let s = states.get(ctx);
  if (!s) {
    // 12 taps burst, refills over 6 s: mashing is fun, flooding is not.
    s = { pending: {}, recent: [], limiter: new RateLimiter({ limit: 12, windowMs: 6000, now: ctx.now }) };
    states.set(ctx, s);
  }
  return s;
}

/** Send whatever piled up since the last tick as one 'reactions.burst'. */
export function flush(ctx: FeatureContext): void {
  const s = state(ctx);
  const counts = s.pending;
  if (Object.keys(counts).length === 0) return;
  s.pending = {};
  ctx.live.publish('reactions.burst', { counts }, 'all');
}

export const reactions = defineFeature({
  name: 'reactions',

  stickers: [
    { id: 'reactions-hype', title: 'hype machine', hint: `send ${HYPE_TAPS} reactions`, shape: 'burst', color: 'tangerine', glyph: 'flame', feature: 'reactions', order: 50 },
  ],

  routes(app, ctx) {
    // POST /api/reactions
    app.post('/', async (req): Promise<Ok> => {
      const me = requireAttendee(req);
      const { kind } = parse(SendReactionRequestSchema, req.body);
      const s = state(ctx);
      s.limiter.enforce(`a:${me.attendeeId}`, 'Easy, your thumb needs a break.');

      s.pending[kind] = (s.pending[kind] ?? 0) + 1;
      const now = ctx.now();
      s.recent.push(now);
      if (s.recent.length > 5000) s.recent.splice(0, s.recent.length - 5000);

      run(ctx.db, 'INSERT INTO reactions_totals (kind, count) VALUES (?, 1) ON CONFLICT(kind) DO UPDATE SET count = count + 1', kind);
      run(
        ctx.db,
        'INSERT INTO reactions_by_attendee (attendee_id, count) VALUES (?, 1) ON CONFLICT(attendee_id) DO UPDATE SET count = count + 1',
        me.attendeeId,
      );
      const mine = one<{ count: number }>(ctx.db, 'SELECT count FROM reactions_by_attendee WHERE attendee_id = ?', me.attendeeId)?.count ?? 0;
      if (mine >= HYPE_TAPS) {
        // Both calls are idempotent, so it is fine that this runs on every tap past 25.
        ctx.stickers.unlock(me.attendeeId, 'reactions-hype');
        ctx.points.award({ attendeeId: me.attendeeId, source: 'reactions', ref: 'hype', points: 5, label: 'hype machine' });
      }
      return { ok: true };
    });

    // GET /api/reactions/stats (console)
    app.get('/stats', async (req): Promise<ReactionStats> => {
      requireAdmin(req);
      const rows = all<{ kind: ReactionKind; count: number }>(ctx.db, 'SELECT kind, count FROM reactions_totals');
      const totals: ReactionStats['totals'] = {};
      for (const r of rows) if ((REACTION_KINDS as readonly string[]).includes(r.kind)) totals[r.kind] = r.count;
      const cutoff = ctx.now() - 60_000;
      const s = state(ctx);
      s.recent = s.recent.filter((t) => t >= cutoff);
      return { totals, lastMinute: s.recent.length };
    });
  },

  tick: { everyMs: 400, run: flush },
});
