/*
  NumberTicker: counts up/down to its value with a springy ease.
  Countdown: mm:ss to a server timestamp (never the phone clock).
  Meter: a racing bar (polls, progress).
*/
import { animate, motion, useReducedMotion } from 'motion/react';
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { useServerNow } from '../core/clock';
import type { Tone } from './Button';
import s from './kit.module.css';

export function NumberTicker({ value, className, style, format }: { value: number; className?: string; style?: CSSProperties; format?: (n: number) => string }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const controls = animate(from.current, value, {
      duration: reduce ? 0.15 : 0.9,
      ease: [0.34, 1.2, 0.64, 1],
      onUpdate: (v) => {
        from.current = v;
        setShown(v);
      },
    });
    return () => controls.stop();
  }, [value, reduce]);
  const n = Math.round(shown);
  return (
    <span className={`${s.num} ${className ?? ''}`} style={style} aria-label={String(value)}>
      {format ? format(n) : n.toLocaleString('en-IN')}
    </span>
  );
}

/** "04:07", or "1:02:09" past an hour. Negative clamps to 00:00. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function Countdown({ to, onDone, className, style }: { to: number; onDone?: () => void; className?: string; style?: CSSProperties }) {
  const now = useServerNow(250);
  const left = to - now;
  const done = useRef(false);
  useEffect(() => {
    if (left <= 0 && !done.current) {
      done.current = true;
      onDone?.();
    }
    if (left > 0) done.current = false;
  }, [left, onDone]);
  return (
    <time className={`${s.num} ${className ?? ''}`} style={style} dateTime={`PT${Math.max(0, Math.ceil(left / 1000))}S`}>
      {formatCountdown(left)}
    </time>
  );
}

/** value 0..1. Hand-drawn racing bar with a halftone fill. */
export function Meter({ value, tone = 'lime', label, className }: { value: number; tone?: Tone; label?: string; className?: string }) {
  const reduce = useReducedMotion();
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className={`${s.meter} ${s[`tone-${tone}`]} ${className ?? ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)} aria-label={label}>
      <motion.div className={s.meterFill} initial={false} animate={{ width: `${v * 100}%` }} transition={reduce ? { duration: 0.1 } : { type: 'spring', stiffness: 120, damping: 14 }} />
    </div>
  );
}
