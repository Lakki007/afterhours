// Word cloud text: normalise, validate, filter. The blocklist is in
// profanity-list.ts; this file is only logic.
import { POLL_LIMITS } from '@afterhours/shared/features/polls';
import { PROFANITY_CONTAINS, PROFANITY_EXACT } from './profanity-list';

export type WordCheck = { ok: true; word: string } | { ok: false; reason: 'empty' | 'too_short' | 'too_long' | 'link' | 'profane' };

// Built from escapes so no invisible characters live in this source file.
const MARKS = new RegExp('[\\u0300-\\u036f]', 'g');
const ZERO_WIDTH = new RegExp('[\\u200b-\\u200f\\u2060\\ufeff]', 'g');

const squeeze =(s: string) => s.replace(/(.)\1+/g, '$1');
const collapse3 = (s: string) => s.replace(/(.)\1{2,}/g, '$1');

const EXACT = new Set(PROFANITY_EXACT.map(collapse3));
const CONTAINS = PROFANITY_CONTAINS.map(collapse3);
// Squeezed entries (fuuuck -> fuk) only for entries long enough not to hit innocent words (shiitake).
const CONTAINS_SQUEEZED = PROFANITY_CONTAINS.filter((e) => e.length >= 5).map(squeeze);

const LEET: Record<string, string> = { '0': 'o', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's', '!': 'i', '+': 't', '8': 'b', '9': 'g' };

/** Lowercase, strip accents and zero-width tricks. */
function base(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(MARKS, '')
    .replace(ZERO_WIDTH, '')
    .toLowerCase();
}

/** Variants of the text with leetspeak undone; '*' tried as each vowel; '1' as i or l. */
function variants(raw: string): string[] {
  const t = base(raw);
  const out = new Set<string>();
  for (const one of ['i', 'l']) {
    let s = '';
    for (const ch of t) s += ch === '1' ? one : (LEET[ch] ?? ch);
    const stars = (s.match(/\*/g) ?? []).length;
    if (stars === 0) out.add(s);
    else if (stars <= 3) {
      let acc = [s];
      for (let i = 0; i < stars; i++) acc = acc.flatMap((x) => ['a', 'e', 'i', 'o', 'u'].map((v) => x.replace('*', v)));
      for (const x of acc) out.add(x);
    } else out.add(s.replaceAll('*', ''));
  }
  return [...out];
}

function profaneVariant(s: string): boolean {
  // letters and spaces only; separators inside a word (m.c, b-c) vanish, spaces stay as token breaks
  const cleaned = collapse3(s.replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim());
  if (!cleaned) return false;
  const tokens = cleaned.split(' ');
  const joined = tokens.join('');
  for (const tk of tokens) {
    if (EXACT.has(tk)) return true;
    if (CONTAINS.some((e) => tk.includes(e))) return true;
    const sq = squeeze(tk);
    if (CONTAINS_SQUEEZED.some((e) => sq.includes(e))) return true;
  }
  // "f u c k": spaced-out letters. Only when every piece is tiny, so "pass hole" is safe.
  if (tokens.length > 1 && tokens.every((tk) => tk.length <= 3)) {
    if (EXACT.has(joined) || CONTAINS.some((e) => joined.includes(e))) return true;
  }
  return false;
}

/** Does this text contain something we never want on the big screen? */
export function isProfane(raw: string): boolean {
  return variants(raw).some(profaneVariant);
}

/**
 * Normalise one word/short phrase for counting: NFKC, lower case, letters,
 * digits and a few tech characters (c++, c#, node.js, what's-up), single
 * spaces, 2..24 chars. Returns the reason when it cannot be used.
 */
export function checkWord(raw: string): WordCheck {
  const lowered = raw.normalize('NFKC').toLowerCase();
  if (/(https?:|www\.|\.com\b|\.in\b|\.io\b|@\w+\.\w+)/.test(lowered)) return { ok: false, reason: 'link' };
  if (isProfane(raw)) return { ok: false, reason: 'profane' };
  let w = lowered
    .replace(ZERO_WIDTH, '')
    .replace(/[^\p{L}\p{N}\p{M}\s'+#&.-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Edge punctuation is noise ("-hello-", "...ok"), except c++ and c#.
  w = w.replace(/^[\s'.\-&+#]+/, '').replace(/[\s'.\-&]+$/, '').trim();
  if (!/[\p{L}\p{N}]/u.test(w)) return { ok: false, reason: 'empty' };
  if (w.length < POLL_LIMITS.wordMinLen) return { ok: false, reason: 'too_short' };
  if (w.length > POLL_LIMITS.wordMaxLen) return { ok: false, reason: 'too_long' };
  return { ok: true, word: w };
}

/** Normalise a word an organiser typed into the hide box, without the profanity check. */
export function normaliseForHide(raw: string): string {
  return raw
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s'+#&.-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[\s'.\-&+#]+/, '')
    .replace(/[\s'.\-&]+$/, '')
    .trim();
}

export const WORD_REASON_MESSAGE: Record<Exclude<WordCheck, { ok: true }>['reason'], string> = {
  empty: 'Type an actual word.',
  too_short: 'That is too short, give it 2 letters at least.',
  too_long: `Keep it under ${POLL_LIMITS.wordMaxLen} characters.`,
  link: 'No links here, just a word.',
  profane: 'Nope, keep it clean. This goes on the big screen.',
};
