import { z } from 'zod';

/**
 * An avatar is a small config, not an image. The web app renders it with
 * <Avatar config={...} />, on phones and on the projector alike.
 */
export const AVATAR_OPTIONS = {
  shape: ['blob', 'square', 'tv', 'bean', 'cloud', 'flower'],
  color: ['tangerine', 'lime', 'pink', 'grape', 'sky', 'sun'],
  eyes: ['dots', 'wide', 'sleepy', 'wink', 'stars', 'visor', 'cyclops', 'specs'],
  mouth: ['grin', 'flat', 'oh', 'teeth', 'tongue', 'smirk', 'wobble', 'cat'],
  top: ['none', 'antenna', 'cap', 'beanie', 'crown', 'sprout', 'horns', 'headphones'],
  extra: ['none', 'blush', 'freckles', 'bandaid', 'mustache', 'scar', 'sweat', 'earring'],
} as const;

export const AvatarConfigSchema = z.object({
  shape: z.enum(AVATAR_OPTIONS.shape),
  color: z.enum(AVATAR_OPTIONS.color),
  eyes: z.enum(AVATAR_OPTIONS.eyes),
  mouth: z.enum(AVATAR_OPTIONS.mouth),
  top: z.enum(AVATAR_OPTIONS.top),
  extra: z.enum(AVATAR_OPTIONS.extra),
});
export type AvatarConfig = z.infer<typeof AvatarConfigSchema>;
export type AvatarPart = keyof AvatarConfig;

export const DEFAULT_AVATAR: AvatarConfig = {
  shape: 'blob',
  color: 'tangerine',
  eyes: 'dots',
  mouth: 'grin',
  top: 'antenna',
  extra: 'none',
};

/** Deterministic pseudo-random avatar, e.g. from an attendee id, for previews and seeds. */
export function avatarFromSeed(seed: number): AvatarConfig {
  let s = (seed * 2654435761) >>> 0;
  const pick = <T>(arr: readonly T[]): T => {
    s = (s * 1103515245 + 12345) >>> 0;
    return arr[s % arr.length] as T;
  };
  return {
    shape: pick(AVATAR_OPTIONS.shape),
    color: pick(AVATAR_OPTIONS.color),
    eyes: pick(AVATAR_OPTIONS.eyes),
    mouth: pick(AVATAR_OPTIONS.mouth),
    top: pick(AVATAR_OPTIONS.top),
    extra: pick(AVATAR_OPTIONS.extra),
  };
}
