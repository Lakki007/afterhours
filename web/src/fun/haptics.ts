/*
  haptics: navigator.vibrate patterns (Android Chrome; iOS Safari ignores it).
  Silent no-op where unsupported. Never the only feedback for anything.
*/
function buzz(pattern: number | number[]): void {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(pattern);
  } catch {
    /* some browsers throw before a gesture */
  }
}

export const haptics = {
  /** Every press. Barely there. */
  tap: () => buzz(8),
  /** Selection changed / tick. */
  tick: () => buzz(4),
  success: () => buzz([14, 40, 22]),
  fail: () => buzz([45, 35, 45]),
  /** Sticker unlocked, big win. */
  celebrate: () => buzz([20, 30, 20, 30, 70]),
  /** Raw access for features (Morse uses this for dots and dashes). */
  buzz,
  stop: () => buzz(0),
};

export type HapticName = Exclude<keyof typeof haptics, 'buzz' | 'stop'>;
