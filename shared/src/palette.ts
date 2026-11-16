import { z } from 'zod';

/**
 * Named colours that may travel over the wire (sticker art, avatar fill).
 * The actual hex values live in web/src/styles/tokens.css; never send hex.
 */
export const PaletteColorSchema = z.enum(['tangerine', 'lime', 'pink', 'grape', 'sky', 'sun', 'paper', 'ink']);
export type PaletteColor = z.infer<typeof PaletteColorSchema>;

/** Hand-drawn glyphs the web app knows how to draw (web/src/kit/Doodle.tsx). */
export const GlyphSchema = z.enum([
  'star',
  'bolt',
  'heart',
  'eye',
  'key',
  'flag',
  'note',
  'smile',
  'robot',
  'crown',
  'flame',
  'check',
  'spark',
  'wave',
  'arrow',
  'ghost',
  'map',
  'dot',
]);
export type Glyph = z.infer<typeof GlyphSchema>;
