// Reactions (spec 5.9): the worked example feature. See docs/EXTENDING.md.
import { z } from 'zod';

export const REACTION_KINDS = ['fire', 'clap', 'lol', 'love', 'wow', 'party'] as const;
export const ReactionKindSchema = z.enum(REACTION_KINDS);
export type ReactionKind = z.infer<typeof ReactionKindSchema>;

/** POST /api/reactions */
export const SendReactionRequestSchema = z.object({ kind: ReactionKindSchema });
export type SendReactionRequest = z.infer<typeof SendReactionRequestSchema>;

/** Server batches taps and broadcasts the counts every ~400 ms. */
export const ReactionBurstSchema = z.object({
  counts: z.partialRecord(ReactionKindSchema, z.number().int().min(1)),
});
export type ReactionBurst = z.infer<typeof ReactionBurstSchema>;

/** GET /api/reactions/stats (console) */
export const ReactionStatsSchema = z.object({
  totals: z.partialRecord(ReactionKindSchema, z.number().int()),
  lastMinute: z.number().int(),
});
export type ReactionStats = z.infer<typeof ReactionStatsSchema>;

declare module '../live' {
  interface LiveEvents {
    /** To everyone: a batch of reactions to float up on phones and rain on the projector. */
    'reactions.burst': ReactionBurst;
  }
}
