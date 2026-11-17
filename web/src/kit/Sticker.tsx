/*
  Sticker: a die-cut sticker drawn from pure data (shape + colour + glyph).
    <Sticker def={def} size={96} tilt={-6} />
    <Sticker def={def} locked />            // greyed kraft silhouette with a lock
    <Sticker def={def} slap />              // entrance: peels down and slaps on
*/
import type { PaletteColor, StickerDef, StickerShape } from '@afterhours/shared';
import { motion, useReducedMotion } from 'motion/react';
import type { CSSProperties } from 'react';
import { Doodle } from './Doodle';
import s from './kit.module.css';

const INK = 'var(--ink)';

const FILL: Record<PaletteColor, string> = {
  tangerine: 'var(--tangerine)',
  lime: 'var(--lime)',
  pink: 'var(--pink)',
  grape: 'var(--grape)',
  sky: 'var(--sky)',
  sun: 'var(--sun)',
  paper: 'var(--paper-3)',
  ink: 'var(--ink)',
};

function poly(n: number, rOuter: number, rInner: number, rot = -Math.PI / 2): string {
  const pts: string[] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = rot + (i * Math.PI) / n;
    const r = i % 2 ? rInner : rOuter;
    pts.push(`${i ? 'L' : 'M'}${(50 + Math.cos(a) * r).toFixed(1)} ${(50 + Math.sin(a) * r).toFixed(1)}`);
  }
  return `${pts.join('')}z`;
}

const SHAPES: Record<StickerShape, string> = {
  circle: 'M50 12a38 38 0 1 0 .1 0z',
  star: poly(5, 42, 22),
  burst: poly(13, 43, 33),
  blob: 'M50 12C72 8 90 26 88 50 86 74 72 90 48 88 26 87 10 72 12 48 14 28 28 14 50 12z',
  ticket: 'M12 26H88V40A10 10 0 0 0 88 60V74H12V60A10 10 0 0 0 12 40z',
  shield: 'M50 9L85 22V52Q85 77 50 91Q15 77 15 52V22z',
  heart: 'M50 87C8 58 9 27 30 19 42 14 50 24 50 31 50 24 58 14 70 19 91 27 92 58 50 87z',
  square: 'M18 15H82Q87 15 87 20V80Q87 85 82 85H18Q13 85 13 80V20Q13 15 18 15z',
};

type StickerLike = Pick<StickerDef, 'shape' | 'color' | 'glyph'> & Partial<Pick<StickerDef, 'title'>>;

export interface StickerProps {
  def: StickerLike;
  size?: number;
  /** Rotation in degrees. */
  tilt?: number;
  locked?: boolean;
  /** Entrance animation: peels down and slaps on. */
  slap?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function Sticker({ def, size = 96, tilt = 0, locked = false, slap = false, className, style }: StickerProps) {
  const reduce = useReducedMotion();
  const d = SHAPES[def.shape];
  const body = locked ? 'var(--paper-2)' : FILL[def.color];
  const glyphSize = Math.round(size * (def.shape === 'ticket' ? 0.34 : 0.46));
  return (
    <motion.div
      className={`${s.sticker} ${className ?? ''}`}
      style={{ width: size, height: size, rotate: tilt, ...style }}
      initial={slap ? (reduce ? { opacity: 0 } : { scale: 2.4, rotate: tilt - 24, y: -60, opacity: 0 }) : false}
      animate={slap ? { scale: 1, rotate: tilt, y: 0, opacity: 1 } : undefined}
      transition={{ type: 'spring', stiffness: 520, damping: 17, mass: 0.8 }}
    >
      <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true" style={{ overflow: 'visible' }}>
        <g filter="url(#ah-rough)">
          <path d={d} fill={INK} stroke={INK} strokeWidth="11" strokeLinejoin="round" transform="translate(2 3)" opacity="0.9" />
        </g>
        <path d={d} fill="var(--paper-3)" stroke="var(--paper-3)" strokeWidth="8" strokeLinejoin="round" />
        <path d={d} fill={body} stroke={INK} strokeWidth="3" strokeLinejoin="round" strokeDasharray={locked ? '5 5' : undefined} />
        {!locked && <path d={d} fill="url(#ah-sticker-dots)" opacity="0.6" />}
      </svg>
      <span className={s.stickerGlyph} style={{ width: glyphSize, height: glyphSize }}>
        <Doodle name={locked ? 'lock' : def.glyph} size={glyphSize} fill={locked ? 'var(--paper-3)' : 'var(--paper-3)'} strokeWidth={2.4} />
      </span>
    </motion.div>
  );
}

