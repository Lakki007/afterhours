// A tiny bus so a local tap and a server burst both make emoji float.
import type { ReactionKind } from '@afterhours/shared/features/reactions';

export const EMOJI: Record<ReactionKind, string> = {
  fire: '\u{1F525}',
  clap: '\u{1F44F}',
  lol: '\u{1F602}',
  love: '\u{1F496}',
  wow: '\u{1F62E}',
  party: '\u{1F389}',
};

type Listener = (kind: ReactionKind, count: number, local: boolean) => void;
const listeners = new Set<Listener>();

export function onFloat(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emitFloat(kind: ReactionKind, count = 1, local = false): void {
  for (const l of listeners) l(kind, count, local);
}
