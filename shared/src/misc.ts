import { z } from 'zod';

export const TimeResponseSchema = z.object({ now: z.number() });
export type TimeResponse = z.infer<typeof TimeResponseSchema>;

export const HealthResponseSchema = z.object({ ok: z.boolean(), uptime: z.number(), version: z.string() });

/** "people are here": attendance count + phones connected to the live stream right now. */
export const PresenceSchema = z.object({ here: z.number().int(), online: z.number().int() });
export type Presence = z.infer<typeof PresenceSchema>;

/** Projector state that the console controls. */
export const ScreenStateSchema = z.object({ pinned: z.string().nullable() });
export type ScreenState = z.infer<typeof ScreenStateSchema>;
export const ScreenPinRequestSchema = z.object({ sceneId: z.string().max(64).nullable() });

/** Public bits of config the web app needs before sign-in. */
export const AppConfigSchema = z.object({
  /** Public URL of the attendee app, used in QR codes. */
  appUrl: z.string(),
  eventName: z.string(),
  eventDate: z.string(),
});
export type AppConfig = z.infer<typeof AppConfigSchema>;
