import type { LeaderboardResponse, MyPointsResponse, StickerBookResponse } from '@afterhours/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getAttendee, isScreen, requireAttendee } from '../auth/guards';
import type { AppContext } from '../context';
import { unauthorized } from '../errors';
import { parse } from '../validate';

const LeaderboardQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) });

export function registerPointsRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/points/me', async (req): Promise<MyPointsResponse> => {
    const me = requireAttendee(req, { allowIncompleteProfile: true });
    return {
      total: ctx.points.total(me.attendeeId),
      rank: ctx.points.rankOf(me.attendeeId),
      history: ctx.points.history(me.attendeeId),
    };
  });

  /** Attendees (with "you are #N"), projector and console. */
  app.get('/api/points/leaderboard', async (req): Promise<LeaderboardResponse> => {
    const me = getAttendee(req);
    if (!me && !isScreen(req)) throw unauthorized();
    const { limit } = parse(LeaderboardQuery, req.query);
    return ctx.points.leaderboard(limit, me?.attendeeId ?? null);
  });

  /** Full catalogue + which ones you have. */
  app.get('/api/stickers', async (req): Promise<StickerBookResponse> => {
    const me = requireAttendee(req, { allowIncompleteProfile: true });
    return { catalogue: ctx.stickers.list(), unlocked: ctx.stickers.unlockedBy(me.attendeeId) };
  });
}
