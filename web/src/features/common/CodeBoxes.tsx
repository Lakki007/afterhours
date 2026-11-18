/*
  N single-character boxes that auto-advance, uppercase, and accept a paste.
  Shakes when `shake` changes (wrong code). Calls onComplete when full.
*/
import { motion, useAnimate, useReducedMotion } from 'motion/react';
import { useEffect, useRef } from 'react';
import { sfx } from '../../fun';
import s from './codeboxes.module.css';

export function CodeBoxes({
  length,
  value,
  onChange,
  onComplete,
  alphabet,
  shake = 0,
  disabled,
  label = 'code',
}: {
  length: number;
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  alphabet?: string;
  shake?: number;
  disabled?: boolean;
  label?: string;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const [scope, animate] = useAnimate<HTMLDivElement>();
  const reduce = useReducedMotion();
  useEffect(() => {
    if (shake && scope.current && !reduce) void animate(scope.current, { x: [0, -14, 12, -8, 6, 0] }, { duration: 0.4 });
  }, [shake, animate, scope, reduce]);

  const clean = (raw: string) =>
    raw
      .toUpperCase()
      .split('')
      .filter((c) => (alphabet ? alphabet.includes(c) : /[A-Z0-9]/.test(c)))
      .join('');

  const set = (next: string) => {
    const v = next.slice(0, length);
    onChange(v);
    if (v.length === length) onComplete?.(v);
  };

  return (
    <div ref={scope} className={s.row} role="group" aria-label={label}>
      {Array.from({ length }, (_, i) => {
        const ch = value[i] ?? '';
        return (
          <motion.input
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            className={`${s.box} ${ch ? s.filled : ''}`}
            style={{ rotate: i % 2 ? 2 : -2 }}
            value={ch}
            disabled={disabled}
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="one-time-code"
            autoCorrect="off"
            spellCheck={false}
            aria-label={`${label} character ${i + 1}`}
            animate={ch && !reduce ? { scale: [1.18, 1] } : { scale: 1 }}
            transition={{ duration: 0.18 }}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key === 'Backspace' && !ch && i > 0) {
                e.preventDefault();
                set(value.slice(0, i - 1));
                refs.current[i - 1]?.focus();
              } else if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus();
              else if (e.key === 'ArrowRight' && i < length - 1) refs.current[i + 1]?.focus();
            }}
            onChange={(e) => {
              const typed = clean(e.target.value);
              if (!typed) {
                set(value.slice(0, i));
                return;
              }
              // typing or pasting several chars fills forward from this box
              const next = (value.slice(0, i) + typed).slice(0, length);
              sfx.tick();
              set(next);
              refs.current[Math.min(next.length, length - 1)]?.focus();
            }}
          />
        );
      })}
    </div>
  );
}
