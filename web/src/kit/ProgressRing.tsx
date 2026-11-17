/*
  ProgressRing: a chunky inked ring that fills. value 0..1, children sit inside.
    <ProgressRing value={0.4} size={140} tone="tangerine"><Countdown .../></ProgressRing>
*/
import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';
import type { Tone } from './Button';
import s from './kit.module.css';

const COLOR: Record<Tone, string> = {
  tangerine: 'var(--tangerine)',
  lime: 'var(--lime)',
  pink: 'var(--pink)',
  grape: 'var(--grape)',
  sky: 'var(--sky)',
  sun: 'var(--sun)',
  paper: 'var(--paper-3)',
  ink: 'var(--ink)',
};

export function ProgressRing({ value, size = 120, thickness = 16, tone = 'tangerine', children, label }: { value: number; size?: number; thickness?: number; tone?: Tone; children?: ReactNode; label?: string }) {
  const reduce = useReducedMotion();
  const v = Math.max(0, Math.min(1, value));
  const r = (size - thickness - 6) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className={s.ring} style={{ width: size, height: size }} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)} aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="var(--paper-3)" stroke="var(--ink)" strokeWidth={thickness + 6} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--paper-2)" strokeWidth={thickness} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={COLOR[tone]}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={false}
          animate={{ strokeDashoffset: c * (1 - v) }}
          transition={reduce ? { duration: 0.1 } : { type: 'spring', stiffness: 60, damping: 14 }}
        />
      </svg>
      <div className={s.ringInner}>{children}</div>
    </div>
  );
}
