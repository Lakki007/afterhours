/*
  sfx: tiny synthesised WebAudio blips. No audio files.
  - Never makes a sound before the first user gesture (browsers would block it
    anyway; we also do not want to startle anyone).
  - One global mute, remembered in localStorage. useMuted() for UI.
  - Every game must be playable with sound off: sfx is garnish, never the only signal.
*/
import { useSyncExternalStore } from 'react';

const MUTE_KEY = 'ah:muted';
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let gestured = false;
let muted = readMuted();
const listeners = new Set<() => void>();

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

function onFirstGesture() {
  gestured = true;
  ensureCtx();
  window.removeEventListener('pointerdown', onFirstGesture, true);
  window.removeEventListener('keydown', onFirstGesture, true);
}
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', onFirstGesture, true);
  window.addEventListener('keydown', onFirstGesture, true);
}

function ensureCtx(): AudioContext | null {
  if (!gestured) return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 6;
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(comp).connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function ready(): AudioContext | null {
  if (muted) return null;
  return ensureCtx();
}

interface Note {
  freq: number;
  /** seconds from now */
  at?: number;
  dur: number;
  type?: OscillatorType;
  gain?: number;
  /** slide to this frequency over the note */
  to?: number;
  detune?: number;
}

function play(notes: Note[]) {
  const ac = ready();
  if (!ac || !master) return;
  const t0 = ac.currentTime + 0.005;
  for (const n of notes) {
    const start = t0 + (n.at ?? 0);
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = n.type ?? 'triangle';
    osc.frequency.setValueAtTime(n.freq, start);
    if (n.to) osc.frequency.exponentialRampToValueAtTime(n.to, start + n.dur);
    if (n.detune) osc.detune.value = n.detune;
    const peak = n.gain ?? 0.2;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(peak, start + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, start + n.dur);
    osc.connect(g).connect(master);
    osc.start(start);
    osc.stop(start + n.dur + 0.02);
  }
}

function noise(dur: number, from: number, to: number, gain = 0.18) {
  const ac = ready();
  if (!ac || !master) return;
  const len = Math.floor(ac.sampleRate * dur);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = buf;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.4;
  const t = ac.currentTime;
  bp.frequency.setValueAtTime(from, t);
  bp.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.3);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp).connect(g).connect(master);
  src.start();
}

const C5 = 523.25;
const E5 = 659.25;
const G5 = 783.99;
const C6 = 1046.5;

export const sfx = {
  /** Button press: a short woody blip. */
  tap: () => play([{ freq: 640, to: 480, dur: 0.05, type: 'triangle', gain: 0.18 }]),
  /** Something popped in (sticker, toast, option picked). */
  pop: () => play([{ freq: 320, to: 980, dur: 0.07, type: 'sine', gain: 0.22 }]),
  /** Clock tick / selection change. */
  tick: () => play([{ freq: 1900, dur: 0.018, type: 'square', gain: 0.06 }]),
  /** Correct / saved / done. */
  success: () =>
    play([
      { freq: C5, dur: 0.09, gain: 0.18 },
      { freq: E5, at: 0.07, dur: 0.09, gain: 0.18 },
      { freq: G5, at: 0.14, dur: 0.16, gain: 0.2 },
    ]),
  /** Wrong / refused: a cartoon "bwomp". */
  fail: () =>
    play([
      { freq: 311, to: 290, dur: 0.14, type: 'square', gain: 0.09 },
      { freq: 233, to: 196, at: 0.13, dur: 0.24, type: 'square', gain: 0.09 },
    ]),
  /** Big win: sticker unlocked, sign-in complete, hunt finished. */
  fanfare: () =>
    play([
      { freq: G5 / 2, dur: 0.1, type: 'square', gain: 0.08 },
      { freq: C5, at: 0.1, dur: 0.1, type: 'square', gain: 0.09 },
      { freq: E5, at: 0.2, dur: 0.1, type: 'square', gain: 0.09 },
      { freq: G5, at: 0.3, dur: 0.12, type: 'square', gain: 0.1 },
      { freq: C6, at: 0.44, dur: 0.5, type: 'triangle', gain: 0.18 },
      { freq: G5, at: 0.44, dur: 0.5, type: 'triangle', gain: 0.1, detune: 6 },
      { freq: E5, at: 0.44, dur: 0.5, type: 'triangle', gain: 0.1, detune: -6 },
    ]),
  /** Swoosh for sheets and page changes. */
  whoosh: () => noise(0.22, 600, 3200, 0.12),
  /** Rattly shuffle (dice). */
  rattle: () => {
    for (let i = 0; i < 5; i++) play([{ freq: 900 + Math.random() * 900, at: i * 0.045, dur: 0.025, type: 'square', gain: 0.05 }]);
  },
  /**
   * A plain tone for features that need one (Morse!). Returns a stop() so a
   * telegraph key can hold the tone for as long as it is pressed.
   */
  tone(freq = 600, opts: { type?: OscillatorType; gain?: number } = {}): () => void {
    const ac = ready();
    if (!ac || !master) return () => {};
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = opts.type ?? 'sine';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.2, ac.currentTime + 0.006);
    osc.connect(g).connect(master);
    osc.start();
    let stopped = false;
    return () => {
      if (stopped || !ctx) return;
      stopped = true;
      const t = ctx.currentTime;
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.012);
      osc.stop(t + 0.03);
    };
  },
  /**
   * Morse-style on/off pattern, scheduled on the AudioContext clock (osc.start(t)/stop(t),
   * never setTimeout). `segments` alternate on, off, on... in ms, starting `delayMs` from now.
   * Returns stop(). Silent (no-op) when muted or before a gesture: callers flash/vibrate too.
   */
  pattern(segments: readonly number[], delayMs: number, freq = 650): () => void {
    const ac = ready();
    if (!ac || !master) return () => {};
    const g = ac.createGain();
    g.gain.value = 0;
    g.connect(master);
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    osc.connect(g);
    let t = ac.currentTime + delayMs / 1000;
    const start = t;
    segments.forEach((ms, i) => {
      const d = ms / 1000;
      if (i % 2 === 0) {
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.22, t + 0.005);
        g.gain.setValueAtTime(0.22, t + Math.max(0.006, d - 0.006));
        g.gain.linearRampToValueAtTime(0, t + d);
      }
      t += d;
    });
    osc.start(start);
    osc.stop(t + 0.05);
    return () => {
      try {
        osc.stop();
      } catch {
        /* already stopped */
      }
    };
  },
  /** One note, for feature-specific jingles. */
  note: (freq: number, durMs = 120, type: OscillatorType = 'triangle') => play([{ freq, dur: durMs / 1000, type }]),
};

export type SfxName = Exclude<keyof typeof sfx, 'tone' | 'note' | 'pattern'>;

export function isMuted(): boolean {
  return muted;
}

export function setMuted(next: boolean): void {
  muted = next;
  try {
    localStorage.setItem(MUTE_KEY, next ? '1' : '0');
  } catch {
    /* private mode: still works for this session */
  }
  for (const l of listeners) l();
}

export function toggleMuted(): boolean {
  setMuted(!muted);
  if (!muted) sfx.pop();
  return muted;
}

/** React hook: [muted, setMuted]. */
export function useMuted(): [boolean, (m: boolean) => void] {
  const m = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => muted,
    () => false,
  );
  return [m, setMuted];
}

/** True once the user has tapped or typed (sound is allowed from then on). */
export function hasGestured(): boolean {
  return gestured;
}
