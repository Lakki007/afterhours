import { type AppConfig, type Presence, ScreenPinRequestSchema, type ScreenState, type TimeResponse } from '@afterhours/shared';
import type { FastifyInstance } from 'fastify';
import { attendanceCount } from './auth/attendees';
import { requireAdmin, requireScreen } from './auth/guards';
import type { AppContext } from './context';
import { one, run } from './db';
import { parse } from './validate';

export const VERSION = '0.1.0';

export function presence(ctx: AppContext): Presence {
  return { here: attendanceCount(ctx), online: ctx.live.onlineCount() };
}

export function getScreenState(ctx: AppContext): ScreenState {
  const row = one<{ value: string }>(ctx.db, "SELECT value FROM core_kv WHERE key = 'screen.pinned'");
  return { pinned: row ? (JSON.parse(row.value) as string | null) : null };
}

export function registerMiscRoutes(app: FastifyInstance, ctx: AppContext) {
  const started = ctx.now();

  /** Clients sample this a few times and keep the lowest-latency offset. */
  app.get('/api/time', async (_req, reply): Promise<TimeResponse> => {
    void reply.header('cache-control', 'no-store');
    return { now: ctx.now() };
  });

  app.get('/api/health', async () => {
    one(ctx.db, 'SELECT 1 AS ok');
    return { ok: true, uptime: Math.round((ctx.now() - started) / 1000), version: VERSION };
  });

  app.get('/api/config', async (): Promise<AppConfig> => ({
    appUrl: ctx.config.appUrl,
    eventName: ctx.config.eventName,
    eventDate: ctx.config.eventDate,
  }));

  app.get('/api/presence', async (): Promise<Presence> => presence(ctx));

  app.get('/api/screen/state', async (req): Promise<ScreenState> => {
    requireScreen(req);
    return getScreenState(ctx);
  });

  app.post('/api/admin/screen/pin', async (req): Promise<ScreenState> => {
    requireAdmin(req);
    const { sceneId } = parse(ScreenPinRequestSchema, req.body);
    run(
      ctx.db,
      "INSERT INTO core_kv (key, value) VALUES ('screen.pinned', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      JSON.stringify(sceneId),
    );
    const state = { pinned: sceneId };
    ctx.live.publish('screen.pinned', state, 'screens');
    return state;
  });
}
