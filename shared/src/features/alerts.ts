// Web Push + in-app announcements (spec 5.3)
import { z } from 'zod';
import { ActivityLinkSchema } from './schedule';

export const ALERT_KINDS = ['soon', 'live', 'announcement'] as const;
export const AlertKindSchema = z.enum(ALERT_KINDS);
export type AlertKind = z.infer<typeof AlertKindSchema>;

/** One in-app banner/toast. Same content as the push, delivered whether or not push is on. */
export const BannerSchema = z.object({
  id: z.number().int(),
  kind: AlertKindSchema,
  title: z.string(),
  body: z.string(),
  /** In-app path to open on tap. */
  url: z.string(),
  activityId: z.number().int().nullable(),
  at: z.number().int(),
});
export type Banner = z.infer<typeof BannerSchema>;

/** POST /api/alerts/announce (console) */
export const AnnounceRequestSchema = z.object({
  title: z.string().trim().min(1).max(60).default('announcement'),
  body: z.string().trim().min(1).max(200),
  link: ActivityLinkSchema.optional(),
  /** Also send a Web Push to everyone subscribed. */
  push: z.boolean().default(true),
});
export type AnnounceRequest = z.input<typeof AnnounceRequestSchema>;

export const PushCountsSchema = z.object({ sent: z.number().int(), failed: z.number().int(), removed: z.number().int() });
export type PushCounts = z.infer<typeof PushCountsSchema>;

export const AnnounceResponseSchema = z.object({ banner: BannerSchema, push: PushCountsSchema.nullable() });
export type AnnounceResponse = z.infer<typeof AnnounceResponseSchema>;

/** GET /api/alerts/recent: banners missed while offline, oldest first. */
export const RecentBannersResponseSchema = z.object({ banners: z.array(BannerSchema) });
export type RecentBannersResponse = z.infer<typeof RecentBannersResponseSchema>;

/** POST /api/alerts/test: push a test notification to the caller's own devices. */
export const TestPushResponseSchema = z.object({ pushEnabled: z.boolean(), devices: z.number().int(), sent: z.number().int() });
export type TestPushResponse = z.infer<typeof TestPushResponseSchema>;

export const ArmedStateSchema = z.enum(['pending', 'sent', 'missed']);
export type ArmedState = z.infer<typeof ArmedStateSchema>;

/** GET /api/alerts/status (console): what is armed, what went out. */
export const AlertStatusSchema = z.object({
  pushEnabled: z.boolean(),
  subscriptions: z.number().int(),
  serverNow: z.number().int(),
  armed: z.array(
    z.object({
      activityId: z.number().int(),
      title: z.string(),
      startAt: z.number().int(),
      soon: z.object({ dueAt: z.number().int(), state: ArmedStateSchema }),
      live: z.object({ dueAt: z.number().int(), state: ArmedStateSchema }),
    }),
  ),
  log: z.array(BannerSchema.extend({ push: PushCountsSchema.nullable() })),
});
export type AlertStatus = z.infer<typeof AlertStatusSchema>;

declare module '../live' {
  interface LiveEvents {
    /**
     * To everyone (phones, projector, console): show a toast/banner. Fired once per alert
     * ("starts in 15", "live now", organiser announcement), in step with the Web Push.
     */
    'alerts.banner': Banner;
  }
}
