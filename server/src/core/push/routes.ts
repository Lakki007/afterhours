import { type Ok, type PushKeyResponse, PushSubscribeRequestSchema, PushUnsubscribeRequestSchema } from '@afterhours/shared';
import type { FastifyInstance } from 'fastify';
import { requireAttendee } from '../auth/guards';
import type { AppContext } from '../context';
import { HttpError } from '../errors';
import { RateLimiter } from '../ratelimit';
import { parse } from '../validate';

export function registerPushRoutes(app: FastifyInstance, ctx: AppContext) {
  const limiter = new RateLimiter({ limit: 10, windowMs: 60_000, now: ctx.now });

  app.get('/api/push/key', async (): Promise<PushKeyResponse> => ({ enabled: ctx.push.enabled, publicKey: ctx.push.publicKey }));

  app.post('/api/push/subscribe', async (req): Promise<Ok> => {
    const me = requireAttendee(req, { allowIncompleteProfile: true });
    limiter.enforce(`a:${me.attendeeId}`);
    if (!ctx.push.enabled) throw new HttpError(409, 'conflict', 'Alerts are switched off on the server right now.');
    ctx.push.subscribe(me.attendeeId, parse(PushSubscribeRequestSchema, req.body), ctx.now());
    return { ok: true };
  });

  app.post('/api/push/unsubscribe', async (req): Promise<Ok> => {
    requireAttendee(req, { allowIncompleteProfile: true });
    ctx.push.unsubscribe(parse(PushUnsubscribeRequestSchema, req.body).endpoint);
    return { ok: true };
  });
}
