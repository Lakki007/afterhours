// Web Push + in-app announcements (spec 5.3).
//
// Exactly-once: before anything is sent, a row (activity, kind, startAt-it-was-armed-for) is
// claimed in alerts_claims. Claim first, send second, so a crash can drop an alert but never
// double it, and a restart re-reads the claims and sends nothing twice.
// Re-arm: the claim key includes startAt. A delay moves startAt, so the activity claims again
// for its new time; the second push says it moved and replaces the first (same tag).
import {
  type AlertStatus,
  type AnnounceResponse,
  AnnounceRequestSchema,
  type ArmedState,
  type Banner,
  type PushCounts,
  type RecentBannersResponse,
  type TestPushResponse,
} from '@afterhours/shared/features/alerts';
import { type FeatureContext, RateLimiter, all, defineFeature, one, parse, requireAdmin, requireAttendee, run, tx } from '../../core';
import { type Row, computePhases, loadRows } from '../schedule/service';

export const SOON_LEAD_MS = 15 * 60_000;
/** A "live now" alert is only sent within this long after the start, so a late restart never announces something half over. */
export const LIVE_WINDOW_MS = 10 * 60_000;

const istFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true });
export const istTime = (ms: number): string => istFmt.format(ms).toLowerCase().replace(/\s/g, '');

const clip = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);

interface LogRow {
  id: number;
  kind: Banner['kind'];
  activity_id: number | null;
  title: string;
  body: string;
  url: string;
  at: number;
  push_sent: number | null;
  push_failed: number | null;
  push_removed: number | null;
}

const toBanner = (r: LogRow): Banner => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, url: r.url, activityId: r.activity_id, at: r.at });
const countsOf = (r: LogRow): PushCounts | null =>
  r.push_sent === null ? null : { sent: r.push_sent, failed: r.push_failed ?? 0, removed: r.push_removed ?? 0 };

/** Banner + push for an already-logged alert. Never throws for delivery trouble. */
async function deliver(ctx: FeatureContext, banner: Banner, pushIt: boolean): Promise<PushCounts | null> {
  ctx.live.publish('alerts.banner', banner, 'all');
  if (!pushIt) return null;
  let counts: PushCounts;
  try {
    counts = await ctx.push.sendPush('all', { title: banner.title, body: banner.body, url: banner.url, tag: `ah-${banner.kind}-${banner.activityId ?? banner.id}` });
  } catch (err) {
    ctx.log.error({ err, alert: banner.id }, 'push fan-out failed');
    counts = { sent: 0, failed: 0, removed: 0 };
  }
  run(ctx.db, 'UPDATE alerts_log SET push_sent = ?, push_failed = ?, push_removed = ? WHERE id = ?', counts.sent, counts.failed, counts.removed, banner.id);
  return counts;
}

function insertLog(ctx: FeatureContext, kind: Banner['kind'], activityId: number | null, title: string, body: string, url: string): number {
  return run(ctx.db, 'INSERT INTO alerts_log (kind, activity_id, title, body, url, at) VALUES (?, ?, ?, ?, ?, ?)', kind, activityId, clip(title, 80), clip(body, 200), url, ctx.now()).lastId;
}

function bannerById(ctx: FeatureContext, id: number): Banner {
  return toBanner(one<LogRow>(ctx.db, 'SELECT * FROM alerts_log WHERE id = ?', id) as LogRow);
}

/** Claim (activity, kind, startAt) and log it, atomically. Returns the log id, or null if it was already claimed. */
function claim(ctx: FeatureContext, r: Row, kind: 'soon' | 'live'): number | null {
  const rearmed = (one<{ n: number }>(ctx.db, 'SELECT COUNT(*) AS n FROM alerts_claims WHERE activity_id = ? AND kind = ? AND start_at <> ?', r.id, kind, r.start_at)?.n ?? 0) > 0;
  const url = r.link ?? '/';
  const where = r.location ? `${r.location}. ` : '';
  let title: string;
  let body: string;
  if (kind === 'soon') {
    title = rearmed ? `${r.title} moved to ${istTime(r.start_at)}` : `${r.title} in 15 min`;
    body = `${where}${rearmed ? 'new time, still worth being early for.' : 'grab a seat before the good ones go.'}`;
  } else {
    title = `${r.title} is live`;
    body = `${where}it just started. go go go.`;
  }
  return tx(ctx.db, () => {
    const logId = insertLog(ctx, kind, r.id, title, body, url);
    const res = run(ctx.db, 'INSERT OR IGNORE INTO alerts_claims (activity_id, kind, start_at, log_id, claimed_at) VALUES (?, ?, ?, ?, ?)', r.id, kind, r.start_at, logId, ctx.now());
    if (res.changes === 0) {
      run(ctx.db, 'DELETE FROM alerts_log WHERE id = ?', logId);
      return null;
    }
    return logId;
  });
}

/** What the tick would fire for this row right now. */
function due(r: Row, phase: string, now: number): 'soon' | 'live' | null {
  if (r.highlight !== 1) return null;
  if (phase === 'live' && now >= r.start_at && now - r.start_at < LIVE_WINDOW_MS) return 'live';
  if (phase === 'upcoming' && r.status === 'scheduled' && now < r.start_at && now >= r.start_at - SOON_LEAD_MS) return 'soon';
  return null;
}

/** One pass: fire whatever is due and not yet claimed. Exported for tests; the tick calls it. */
export async function checkAlerts(ctx: FeatureContext): Promise<number> {
  const now = ctx.now();
  const rows = loadRows(ctx);
  const phases = computePhases(rows, now);
  const jobs: Promise<unknown>[] = [];
  for (const r of rows) {
    const kind = due(r, phases.get(r.id) ?? 'upcoming', now);
    if (!kind) continue;
    const logId = claim(ctx, r, kind);
    if (logId !== null) jobs.push(deliver(ctx, bannerById(ctx, logId), true));
  }
  await Promise.all(jobs);
  return jobs.length;
}

function armedState(ctx: FeatureContext, r: Row, kind: 'soon' | 'live', now: number): ArmedState {
  const sent = one<{ n: number }>(ctx.db, 'SELECT COUNT(*) AS n FROM alerts_claims WHERE activity_id = ? AND kind = ? AND start_at = ?', r.id, kind, r.start_at)?.n;
  if (sent) return 'sent';
  const closes = kind === 'soon' ? r.start_at : r.start_at + LIVE_WINDOW_MS;
  return now >= closes ? 'missed' : 'pending';
}

export const alerts = defineFeature({
  name: 'alerts',

  routes(app, ctx) {
    const announceLimiter = new RateLimiter({ limit: 10, windowMs: 60_000, now: ctx.now });
    const testLimiter = new RateLimiter({ limit: 3, windowMs: 60_000, now: ctx.now });
    const recentLimiter = new RateLimiter({ limit: 10, windowMs: 10_000, now: ctx.now });

    // POST /api/alerts/announce (console): banner for everyone now, push optional.
    app.post('/announce', async (req): Promise<AnnounceResponse> => {
      requireAdmin(req);
      announceLimiter.enforce('admin', 'That is a lot of announcements. Give it a minute.');
      const body = parse(AnnounceRequestSchema, req.body);
      const id = insertLog(ctx, 'announcement', null, body.title, body.body, body.link ?? '/');
      const banner = bannerById(ctx, id);
      const push = await deliver(ctx, banner, body.push);
      return { banner, push };
    });

    // GET /api/alerts/recent (attendee): the last few banners, so a phone that was offline can catch up.
    app.get('/recent', async (req): Promise<RecentBannersResponse> => {
      const me = requireAttendee(req);
      recentLimiter.enforce(`a:${me.attendeeId}`);
      const rows = all<LogRow>(ctx.db, 'SELECT * FROM alerts_log ORDER BY id DESC LIMIT 10');
      return { banners: rows.reverse().map(toBanner) };
    });

    // POST /api/alerts/test (attendee): "send me a test" after they enable alerts.
    app.post('/test', async (req): Promise<TestPushResponse> => {
      const me = requireAttendee(req);
      testLimiter.enforce(`a:${me.attendeeId}`, 'Test alerts are rate limited. Check your notifications.');
      const devices = one<{ n: number }>(ctx.db, 'SELECT COUNT(*) AS n FROM push_subscriptions WHERE attendee_id = ?', me.attendeeId)?.n ?? 0;
      let sent = 0;
      if (ctx.push.enabled && devices > 0) {
        sent = (await ctx.push.sendPush({ attendeeId: me.attendeeId }, { title: 'alerts are on', body: 'we will ping you before the big stuff.', url: '/', tag: 'ah-test' })).sent;
      }
      return { pushEnabled: ctx.push.enabled, devices, sent };
    });

    // GET /api/alerts/status (console)
    app.get('/status', async (req): Promise<AlertStatus> => {
      requireAdmin(req);
      const now = ctx.now();
      const rows = loadRows(ctx);
      const armed = rows
        .filter((r) => r.highlight === 1 && r.status !== 'ended')
        .map((r) => ({
          activityId: r.id,
          title: r.title,
          startAt: r.start_at,
          soon: { dueAt: r.start_at - SOON_LEAD_MS, state: armedState(ctx, r, 'soon', now) },
          live: { dueAt: r.start_at, state: armedState(ctx, r, 'live', now) },
        }));
      const log = all<LogRow>(ctx.db, 'SELECT * FROM alerts_log ORDER BY id DESC LIMIT 30').map((r) => ({ ...toBanner(r), push: countsOf(r) }));
      return { pushEnabled: ctx.push.enabled, subscriptions: ctx.push.count(), serverNow: now, armed, log };
    });
  },

  tick: { everyMs: 2000, run: async (ctx) => void (await checkAlerts(ctx)) },
});
