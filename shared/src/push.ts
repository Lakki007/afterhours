import { z } from 'zod';

export const PushKeyResponseSchema = z.object({
  enabled: z.boolean(),
  publicKey: z.string().nullable(),
});
export type PushKeyResponse = z.infer<typeof PushKeyResponseSchema>;

/** Mirrors PushSubscription.toJSON(). */
export const PushSubscribeRequestSchema = z.object({
  endpoint: z.string().url().max(1000),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
});
export type PushSubscribeRequest = z.infer<typeof PushSubscribeRequestSchema>;

export const PushUnsubscribeRequestSchema = z.object({ endpoint: z.string().url().max(1000) });

/** What the service worker receives in the push event. */
export const PushPayloadSchema = z.object({
  title: z.string().max(80),
  body: z.string().max(200),
  /** In-app path to open on tap, e.g. "/" or "/polls". */
  url: z.string().startsWith('/').default('/'),
  /** Same tag replaces an earlier notification instead of stacking. */
  tag: z.string().max(64).optional(),
});
export type PushPayload = z.input<typeof PushPayloadSchema>;
