import { describe, expect, it } from 'vitest';
import {
  MORSE_TABLE,
  type Press,
  decodePattern,
  decodeSpeed,
  editDistance,
  judgeTaps,
  normaliseWord,
  unitMsForWpm,
  wordToPatterns,
  wordToSignal,
} from './morse';

/** Small seeded PRNG so "random" jitter is repeatable. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Style {
  unit: number;
  /** Relative jitter (std-ish) on presses and on gaps. */
  pressJitter: number;
  gapJitter: number;
  /** A tapper who systematically makes dahs shorter than 3u (common). */
  dahFactor?: number;
  /** Letter gaps shorter than ideal (common: people rush). */
  letterGapFactor?: number;
}

/** Realistic human taps for a word: lognormal-ish jitter around the ideal. */
function humanTaps(word: string, st: Style, seed: number): Press[] {
  const r = rng(seed);
  const jit = (j: number) => Math.exp((r() + r() + r() - 1.5) * j * 1.6);
  const out: Press[] = [];
  let t = 0;
  const letters = wordToPatterns(word);
  letters.forEach((p, li) => {
    [...p].forEach((el, ei) => {
      if (li > 0 || ei > 0) {
        const intra = ei > 0;
        const ideal = intra ? st.unit : 3 * st.unit * (st.letterGapFactor ?? 1);
        t += ideal * jit(st.gapJitter);
      }
      const d = (el === '.' ? st.unit : 3 * st.unit * (st.dahFactor ?? 1)) * jit(st.pressJitter);
      out.push([Math.round(t), Math.round(t + d)]);
      t += d;
    });
  });
  const base = out[0]?.[0] ?? 0;
  return out.map(([a, b]) => [a - base, b - base] as const);
}

/** Exact machine timing. */
function perfect(word: string, unit: number): Press[] {
  return humanTaps(word, { unit, pressJitter: 0, gapJitter: 0 }, 1);
}

const MID: Style = { unit: 130, pressJitter: 0.15, gapJitter: 0.25 };

describe('morse table and signal', () => {
  it('has every letter and digit, and round-trips', () => {
    expect(Object.keys(MORSE_TABLE)).toHaveLength(36);
    for (const [c, p] of Object.entries(MORSE_TABLE)) expect(decodePattern(p)).toBe(c);
    expect(decodePattern('......')).toBe('?');
  });

  it('normalises words', () => {
    expect(normaliseWord(' Git-hub! ')).toBe('GITHUB');
  });

  it('builds a PARIS-timed signal: on/off alternating, starts and ends on', () => {
    const wpm = 12; // unit = 100 ms
    expect(unitMsForWpm(wpm)).toBe(100);
    const s = wordToSignal('ET', wpm); // . then -
    expect(s.segments).toEqual([100, 300, 300]); // dit, letter gap, dah
    const s2 = wordToSignal('A', wpm); // .-
    expect(s2.segments).toEqual([100, 100, 300]);
    expect(s2.totalMs).toBe(500);
    const odd = wordToSignal('CAT', 20);
    expect(odd.segments.length % 2).toBe(1);
  });
});

describe('judgeTaps: honest humans pass', () => {
  const words = ['HI', 'BUG', 'CODE', 'DEBUG', 'COMMIT', 'RECURSE', 'FIREWALL'];

  it('passes jittery human timing across speeds', () => {
    let tried = 0;
    for (const unit of [60, 90, 130, 200, 300]) {
      for (const w of words) {
        for (let seed = 1; seed <= 5; seed++) {
          const j = judgeTaps(w, humanTaps(w, { ...MID, unit }, seed * 100 + unit));
          expect(j.verdict, `${w} @${unit}ms seed ${seed}: decoded ${j.decoded}`).toBe('ok');
          expect(Math.abs(j.unitMs - unit) / unit).toBeLessThan(0.25);
          tried++;
        }
      }
    }
    expect(tried).toBe(175);
  });

  it('passes at least 97% of 600 randomly jittery honest taps (press 20%, gap 30%)', () => {
    let pass = 0;
    const all = ['HI', 'BUG', 'CODE', 'LINUX', 'COMMIT', 'RECURSE', 'ALGORITHM'];
    for (let i = 0; i < 600; i++) {
      const w = all[i % all.length] as string;
      const unit = 70 + ((i * 37) % 200);
      if (judgeTaps(w, humanTaps(w, { unit, pressJitter: 0.2, gapJitter: 0.3 }, 1000 + i)).verdict === 'ok') pass++;
    }
    expect(pass / 600).toBeGreaterThanOrEqual(0.97);
  });

  it('passes a slow but consistent tapper with short dahs and rushed gaps', () => {
    for (const w of words) {
      const taps = humanTaps(w, { unit: 220, pressJitter: 0.1, gapJitter: 0.15, dahFactor: 0.85, letterGapFactor: 0.8 }, 42);
      expect(judgeTaps(w, taps).verdict, w).toBe('ok');
    }
  });

  it('is relative to the attendee: the same word at 2x speed yields the same reading', () => {
    const a = judgeTaps('RECURSE', humanTaps('RECURSE', { ...MID, unit: 100 }, 7));
    const b = judgeTaps('RECURSE', humanTaps('RECURSE', { ...MID, unit: 200 }, 7));
    expect(a.decoded).toBe('RECURSE');
    expect(b.decoded).toBe('RECURSE');
    expect(b.wpm).toBeCloseTo(a.wpm / 2, 0);
  });

  it('gives a tidier rhythm a better rhythm score', () => {
    const tidy = judgeTaps('DEBUG', humanTaps('DEBUG', { unit: 130, pressJitter: 0.05, gapJitter: 0.08 }, 3));
    const messy = judgeTaps('DEBUG', humanTaps('DEBUG', { unit: 130, pressJitter: 0.3, gapJitter: 0.4 }, 3));
    expect(tidy.verdict).toBe('ok');
    expect(tidy.rhythm).toBeGreaterThan(messy.rhythm);
  });

  it('accepts a word made of one kind of press (all dits)', () => {
    const w = 'HS'; // .... ...
    expect(judgeTaps(w, humanTaps(w, MID, 9)).verdict).toBe('ok');
    expect(judgeTaps('TM', humanTaps('TM', MID, 9)).verdict).toBe('ok'); // all dahs
  });
});

describe('judgeTaps: mistakes and cheating', () => {
  it('wrong letter is wrong and marks which letter', () => {
    const taps = humanTaps('CODA', MID, 11);
    const j = judgeTaps('CODE', taps);
    expect(j.verdict).toBe('wrong');
    expect(j.letterOk).toEqual([true, true, true, false]);
    expect(j.decoded).toBe('CODA');
  });

  it('an extra letter is wrong', () => {
    const j = judgeTaps('CODE', humanTaps('CODES', MID, 12));
    expect(j.verdict).toBe('wrong');
    expect(j.decoded).toBe('CODES');
    expect(j.letterOk).toEqual([true, true, true, true]); // all expected letters right, but not the same word
  });

  it('a missing letter is wrong', () => {
    const j = judgeTaps('CODE', humanTaps('COD', MID, 13));
    expect(j.verdict).toBe('wrong');
    expect(j.letterOk[3]).toBe(false);
  });

  it('a word gap in the middle is wrong', () => {
    const taps = humanTaps('CODE', MID, 14);
    // push the last letter 9 units later
    const shifted = taps.map(([a, b], i) => (i >= taps.length - 1 ? ([a + 9 * 130, b + 9 * 130] as const) : ([a, b] as const)));
    const j = judgeTaps('CODE', shifted);
    expect(j.verdict).toBe('wrong');
    expect(j.decoded).toContain(' ');
  });

  it('too fast: sub-human units are rejected even when perfect decode', () => {
    const j = judgeTaps('COMMIT', humanTaps('COMMIT', { ...MID, unit: 20 }, 5));
    // 20ms presses are also below the per-press floor for dits, so either guard may trip first
    expect(['too_fast', 'invalid']).toContain(j.verdict);
    const j2 = judgeTaps('COMMIT', humanTaps('COMMIT', { unit: 25, pressJitter: 0.02, gapJitter: 0.05 }, 5));
    expect(j2.verdict).not.toBe('ok');
  });

  it('too slow: units beyond ~3 wpm are rejected', () => {
    const j = judgeTaps('DEBUG', humanTaps('DEBUG', { ...MID, unit: 600 }, 6));
    expect(j.verdict).toBe('too_slow');
  });

  it('empty and malformed input', () => {
    expect(judgeTaps('HI', []).verdict).toBe('empty');
    expect(judgeTaps('HI', [[0, 5]]).verdict).toBe('invalid'); // 5ms press
    expect(judgeTaps('HI', [[0, 100], [50, 150]]).verdict).toBe('invalid'); // overlapping
    expect(judgeTaps('HI', [[0, 100], [200, 190]]).verdict).toBe('invalid'); // up before down
    expect(judgeTaps('HI', [[0, Number.NaN]]).verdict).toBe('invalid');
  });

  it('machine-perfect timing is flagged robotic, human timing of the same word is not', () => {
    expect(judgeTaps('RECURSE', perfect('RECURSE', 120)).verdict).toBe('robotic');
    expect(judgeTaps('RECURSE', humanTaps('RECURSE', MID, 3)).verdict).toBe('ok');
  });

  it('a pasted perfect short word (too few elements to call robotic) still decodes, so wall-clock checks matter', () => {
    expect(judgeTaps('HI', perfect('HI', 120)).verdict).toBe('robotic'); // 6 presses + 5 gaps = 11 elements
    expect(judgeTaps('E', perfect('E', 120)).verdict).toBe('ok'); // 1 element: cannot judge
  });

  it('absurdly sloppy timing fails as sloppy or wrong, not ok', () => {
    const r = rng(99);
    const taps: Press[] = [];
    let t = 0;
    for (let i = 0; i < 10; i++) {
      const d = 30 + r() * 400;
      taps.push([Math.round(t), Math.round(t + d)]);
      t += d + 30 + r() * 600;
    }
    expect(judgeTaps('DEBUG', taps).verdict).not.toBe('ok');
  });
});

describe('scoring helpers', () => {
  it('decode speed: quick is 1, slow is 0, monotonic', () => {
    expect(decodeSpeed(0, 5)).toBe(1);
    expect(decodeSpeed(100_000, 5)).toBe(0);
    expect(decodeSpeed(6000, 5)).toBeLessThan(decodeSpeed(3000, 5));
  });
  it('edit distance', () => {
    expect(editDistance('kitten', 'sitting')).toBe(3);
    expect(editDistance('', 'abc')).toBe(3);
  });
});
