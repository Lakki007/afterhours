import { z } from 'zod';
import { AvatarConfigSchema } from './avatar';

/** `source` is the feature (or sub-feature) awarding, `ref` makes it unique per attendee. */
export const AwardSourceSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,39}$/);

export const LedgerEntrySchema = z.object({
  source: z.string(),
  ref: z.string(),
  points: z.number().int(),
  label: z.string().nullable(),
  at: z.number(),
});
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;

export const MyPointsResponseSchema = z.object({
  total: z.number().int(),
  /** 1-based rank, null when you have no points yet. */
  rank: z.number().int().nullable(),
  history: z.array(LedgerEntrySchema),
});
export type MyPointsResponse = z.infer<typeof MyPointsResponseSchema>;

export const LeaderboardEntrySchema = z.object({
  rank: z.number().int(),
  attendeeId: z.number().int(),
  nickname: z.string(),
  avatar: AvatarConfigSchema,
  total: z.number().int(),
});
export type LeaderboardEntry = z.infer<typeof LeaderboardEntrySchema>;

export const LeaderboardResponseSchema = z.object({
  entries: z.array(LeaderboardEntrySchema),
  /** Present when the caller is an attendee. */
  me: z.object({ rank: z.number().int().nullable(), total: z.number().int() }).nullable(),
  players: z.number().int(),
  updatedAt: z.number(),
});
export type LeaderboardResponse = z.infer<typeof LeaderboardResponseSchema>;
