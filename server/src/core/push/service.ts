import { type PushPayload, PushPayloadSchema, type PushSubscribeRequest } from '@afterhours/shared';
import { sendNotification } from 'web-push';
import type { Config } from '../../config';
import { type Db, all, run } from '../db';

export type PushAudience = 'all' | { attendeeId: number } | { attendeeIds: number[] };

export interface PushResult {
  sent: number;
  failed: number;
  removed: number;
}

interface SubRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Sends one notification; throws an error with `statusCode` on failure (web-push's shape). */
export type PushSender = (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, body: string) => Promise<unknown>;

/**
 * Web Push plumbing. This service only knows HOW to send. WHEN to send is the
 * alerts/schedule feature's job (and its job to stay idempotent across restarts).
 */
export class PushService {
  readonly enabled: boolean;
  readonly publicKey: string | null;
  private readonly sender: PushSender | null;

  constructor(
    private readonly db: Db,
    config: Config,
    sender?: PushSender,
    private readonly concurrency = 16,
  ) {
    if (sender) {
      this.sender = sender;
    } else if (config.vapid) {
      const { publicKey, privateKey, subject } = config.vapid;
      this.sender = (sub, body) => sendNotification(sub, body, { TTL: 15 * 60, urgency: 'high', vapidDetails: { subject, publicKey, privateKey } });
    } else {
      this.sender = null;
    }
    this.enabled = this.sender !== null;
    this.publicKey = config.vapid?.publicKey ?? null;
  }

  subscribe(attendeeId: number | null, sub: PushSubscribeRequest, now = Date.now()): void {
    run(
      this.db,
      `INSERT INTO push_subscriptions (endpoint, attendee_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET attendee_id = excluded.attendee_id, p256dh = excluded.p256dh, auth = excluded.auth`,
      sub.endpoint,
      attendeeId,
      sub.keys.p256dh,
      sub.keys.auth,
      now,
    );
  }

  unsubscribe(endpoint: string): void {
    run(this.db, 'DELETE FROM push_subscriptions WHERE endpoint = ?', endpoint);
  }

  count(): number {
    return all<{ n: number }>(this.db, 'SELECT COUNT(*) AS n FROM push_subscriptions')[0]?.n ?? 0;
  }

  private targets(audience: PushAudience): SubRow[] {
    const cols = 'SELECT endpoint, p256dh, auth FROM push_subscriptions';
    if (audience === 'all') return all<SubRow>(this.db, cols);
    if ('attendeeId' in audience) return all<SubRow>(this.db, `${cols} WHERE attendee_id = ?`, audience.attendeeId);
    if (audience.attendeeIds.length === 0) return [];
    const ids = audience.attendeeIds.filter((n) => Number.isInteger(n));
    return all<SubRow>(this.db, `${cols} WHERE attendee_id IN (${ids.map(() => '?').join(',')})`, ...ids);
  }

  /** Fan out a notification. Dead subscriptions (404/410) are deleted. Never throws for delivery errors. */
  async sendPush(audience: PushAudience, payload: PushPayload): Promise<PushResult> {
    const result: PushResult = { sent: 0, failed: 0, removed: 0 };
    if (!this.sender) return result;
    const body = JSON.stringify(PushPayloadSchema.parse(payload));
    const queue = this.targets(audience);
    const sender = this.sender;
    const worker = async () => {
      for (let sub = queue.shift(); sub; sub = queue.shift()) {
        try {
          await sender({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, body);
          result.sent++;
        } catch (err) {
          const status = typeof err === 'object' && err && 'statusCode' in err ? Number(err.statusCode) : 0;
          if (status === 404 || status === 410) {
            this.unsubscribe(sub.endpoint);
            result.removed++;
          } else {
            result.failed++;
          }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, queue.length) }, worker));
    return result;
  }
}
