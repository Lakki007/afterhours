/*
  Wordmark: "after hours" as ransom-note letters cut from different papers.
  Every letter is a toy: press it for a note, drag it out and watch it snap back.
*/
import { motion, useReducedMotion } from 'motion/react';
import { haptics } from '../../fun/haptics';
import { sfx } from '../../fun/sfx';
import s from './wordmark.module.css';

const SCALE = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.5];

interface Cut {
  ch: string;
  bg: string;
  fg: string;
  rot: number;
  lift: number;
  scale: number;
}

const AFTER: Cut[] = [
  { ch: 'a', bg: 'var(--tangerine)', fg: 'var(--ink)', rot: -6, lift: 0, scale: 1 },
  { ch: 'f', bg: 'var(--paper-3)', fg: 'var(--ink)', rot: 4, lift: -6, scale: 1.08 },
  { ch: 't', bg: 'var(--lime)', fg: 'var(--ink)', rot: -3, lift: 4, scale: 0.96 },
  { ch: 'e', bg: 'var(--ink)', fg: 'var(--sun)', rot: 7, lift: -2, scale: 1.04 },
  { ch: 'r', bg: 'var(--pink)', fg: 'var(--ink)', rot: -4, lift: 3, scale: 1 },
];
const HOURS: Cut[] = [
  { ch: 'h', bg: 'var(--sky)', fg: 'var(--ink)', rot: 5, lift: 2, scale: 1.06 },
  { ch: 'o', bg: 'var(--sun)', fg: 'var(--ink)', rot: -7, lift: -4, scale: 1 },
  { ch: 'u', bg: 'var(--paper-3)', fg: 'var(--ink)', rot: 3, lift: 3, scale: 1.05 },
  { ch: 'r', bg: 'var(--grape)', fg: 'var(--paper-3)', rot: -5, lift: -2, scale: 0.98 },
  { ch: 's', bg: 'var(--tangerine)', fg: 'var(--ink)', rot: 6, lift: 4, scale: 1.04 },
];

function Letter({ cut, i, size }: { cut: Cut; i: number; size: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.button
      type="button"
      className={s.letter}
      aria-label={cut.ch}
      style={{
        background: cut.bg,
        color: cut.fg,
        width: size * 0.86 * cut.scale,
        height: size * 1.04 * cut.scale,
        fontSize: size * 0.82 * cut.scale,
        rotate: cut.rot,
        y: cut.lift,
      }}
      initial={reduce ? false : { y: -120, opacity: 0, rotate: cut.rot * 4 }}
      animate={{ y: cut.lift, opacity: 1, rotate: cut.rot }}
      transition={{ type: 'spring', stiffness: 380, damping: 14, delay: reduce ? 0 : 0.05 * i }}
      whileTap={reduce ? undefined : { scale: 0.86, rotate: cut.rot + 12 }}
      drag={!reduce}
      dragSnapToOrigin
      dragElastic={0.6}
      dragTransition={{ bounceStiffness: 300, bounceDamping: 12 }}
      onPointerDown={() => {
        sfx.note(SCALE[(i * 3 + cut.ch.charCodeAt(0)) % SCALE.length] ?? 660, 150, i % 2 ? 'triangle' : 'square');
        haptics.tick();
      }}
    >
      {cut.ch}
    </motion.button>
  );
}

export function Wordmark({ size = 62 }: { size?: number }) {
  return (
    <h1 className={s.wordmark} aria-label="after hours">
      <span className={s.line} aria-hidden="true">
        {AFTER.map((c, i) => (
          <Letter key={`a${i}`} cut={c} i={i} size={size} />
        ))}
      </span>
      <span className={s.line} aria-hidden="true">
        {HOURS.map((c, i) => (
          <Letter key={`h${i}`} cut={c} i={i + 5} size={size} />
        ))}
      </span>
    </h1>
  );
}
