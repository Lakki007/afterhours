import { z } from 'zod';

/** Spec 5.1. The schedule feature owns activities; the kind enum is shared so other features can link to them. */
export const ActivityKindSchema = z.enum(['talk', 'game', 'poll', 'hunt', 'morse', 'break', 'other']);
export type ActivityKind = z.infer<typeof ActivityKindSchema>;
