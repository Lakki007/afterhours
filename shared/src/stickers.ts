import { z } from 'zod';
import { GlyphSchema, PaletteColorSchema } from './palette';

/**
 * A sticker is pure data: the web app draws it from shape + colour + glyph,
 * so a feature adds a sticker by adding a catalogue entry, not artwork.
 */
export const StickerShapeSchema = z.enum(['circle', 'star', 'blob', 'ticket', 'burst', 'shield', 'heart', 'square']);
export type StickerShape = z.infer<typeof StickerShapeSchema>;

export const StickerDefSchema = z.object({
  /** Globally unique, kebab-case. Prefix with your feature: "hunt-finisher". */
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,47}$/),
  /** Short title on the sticker, 1 to 3 words. */
  title: z.string().min(1).max(24),
  /** How you get it, shown under a locked slot. Club voice. */
  hint: z.string().max(80),
  shape: StickerShapeSchema,
  color: PaletteColorSchema,
  glyph: GlyphSchema,
  /** Owning feature name (or "core"). */
  feature: z.string(),
  /** Sort order in the sticker book. Lower first. */
  order: z.number().int().default(100),
});
export type StickerDef = z.infer<typeof StickerDefSchema>;
export type StickerDefInput = z.input<typeof StickerDefSchema>;

export const StickerBookResponseSchema = z.object({
  catalogue: z.array(StickerDefSchema),
  /** stickerId -> unlocked at (epoch ms) */
  unlocked: z.record(z.string(), z.number()),
});
export type StickerBookResponse = z.infer<typeof StickerBookResponseSchema>;
