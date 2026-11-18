/*
  Playing a Morse signal so it works with sound OFF: the tone is scheduled on the
  AudioContext clock, the screen flash follows the same timeline (rAF against
  performance.now), and the phone vibrates the same on/off pattern.
*/
import type { Press } from '@afterhours/shared/features/morse';
import { haptics } from '../../fun/haptics';
import { sfx } from '../../fun/sfx';

export interface Playback {
  stop: () => void;
}

/** Plays `segments` (on, off, on... ms) after `leadInMs`. onLight(true/false) drives the flash. */
export function playSignal(segments: readonly number[], leadInMs: number, onLight: (on: boolean) => void, onDone: () => void): Playback {
  const stopTone = sfx.pattern(segments, leadInMs);
  haptics.buzz([0, leadInMs, ...segments]);
  const t0 = performance.now() + leadInMs;
  const edges: number[] = [];
  let acc = 0;
  for (const ms of segments) {
    acc += ms;
    edges.push(acc);
  }
  let raf = 0;
  let last: boolean | null = null;
  let stopped = false;
  const frame = () => {
    if (stopped) return;
    const t = performance.now() - t0;
    if (t >= acc) {
      onLight(false);
      onDone();
      return;
    }
    let on = false;
    if (t >= 0) {
      const i = edges.findIndex((e) => t < e);
      on = i % 2 === 0;
    }
    if (on !== last) {
      last = on;
      onLight(on);
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return {
    stop: () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stopTone();
      haptics.stop();
      onLight(false);
    },
  };
}

/** Free-play decoding: no expected word, so estimate the unit from the shortest press. */
export function freeDecode(presses: readonly Press[], table: Readonly<Record<string, string>>): string {
  if (presses.length === 0) return '';
  const durs = presses.map(([d, u]) => u - d);
  const unit = Math.min(300, Math.max(50, Math.min(...durs)));
  const reverse = new Map(Object.entries(table).map(([ch, code]) => [code, ch]));
  let out = '';
  let cur = '';
  presses.forEach(([d, u], i) => {
    if (i > 0) {
      const gap = d - (presses[i - 1] as Press)[1];
      if (gap >= 2 * unit) {
        out += reverse.get(cur) ?? '?';
        cur = '';
        if (gap >= 5 * unit) out += ' ';
      }
    }
    cur += u - d < 2 * unit ? '.' : '-';
  });
  return out + (cur ? (reverse.get(cur) ?? '?') : '');
}
