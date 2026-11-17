/*
  Byte: the Recurse robot head as a mascot. Eyes follow your finger, blinks now
  and then. Used on empty states, loading and the sign-in.
*/
import { useRef } from 'react';
import { useLook } from '../fun/useLook';
import s from './kit.module.css';

export type MascotMood = 'happy' | 'sleepy' | 'oops' | 'wow';

export function Mascot({ size = 96, mood = 'happy', follow = true, className }: { size?: number; mood?: MascotMood; follow?: boolean; className?: string }) {
  const ref = useRef<SVGSVGElement>(null);
  const look = useLook(ref, follow);
  const dx = look.x * 4.5;
  const dy = look.y * 3.5;
  const ink = 'var(--ink)';
  return (
    <svg ref={ref} viewBox="0 0 100 100" width={size} height={size} className={`${s.mascot} ${className ?? ''}`} aria-hidden="true" style={{ overflow: 'visible' }}>
      <path d="M50 20Q47 9 54 6" fill="none" stroke={ink} strokeWidth="4" strokeLinecap="round" />
      <circle cx="54.500" cy="6" r="5" fill="var(--tangerine)" stroke={ink} strokeWidth="3.200" />
      <ellipse cx="53" cy="92" rx="26" ry="4" fill={ink} opacity="0.18" />
      <path d="M50 20C74 19 90 36 89 58 88 80 71 90 50 90 29 90 12 80 11 58 10 36 27 21 50 20z" fill="var(--paper-3)" stroke={ink} strokeWidth="4" strokeLinejoin="round" />
      <path d="M22 72Q50 94 78 72" fill="none" stroke={ink} strokeOpacity="0.14" strokeWidth="6" strokeLinecap="round" />
      <g className={s.mascotEyes} style={{ transformOrigin: '50px 56px' }}>
        {mood === 'sleepy' ? (
          <>
            <path d="M26 56Q34 63 42 56" fill="none" stroke={ink} strokeWidth="4.500" strokeLinecap="round" />
            <path d="M58 56Q66 63 74 56" fill="none" stroke={ink} strokeWidth="4.500" strokeLinecap="round" />
          </>
        ) : (
          [34, 66].map((x) => (
            <g key={x}>
              <circle cx={x + dx} cy={56 + dy} r={mood === 'wow' ? 11 : 9.500} fill={ink} />
              <rect x={x + dx - 9} y={55 + dy} width="18" height="2.600" fill="var(--paper-3)" />
            </g>
          ))
        )}
      </g>
      {mood === 'oops' && <path d="M40 76Q50 70 60 76" fill="none" stroke={ink} strokeWidth="3.600" strokeLinecap="round" />}
      {mood === 'wow' && <ellipse cx="50" cy="77" rx="5" ry="6" fill={ink} />}
      {mood === 'happy' && <path d="M41 74Q50 81 59 74" fill="none" stroke={ink} strokeWidth="3.600" strokeLinecap="round" />}
    </svg>
  );
}
