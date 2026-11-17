/*
  Card: a piece of card stock. Hard ink outline, offset shadow, hand-cut corners.
    <Card tone="sun" tilt={-1.5} tape>...</Card>
    <Card press onClick={...}>tappable</Card>
  Tape: the strip on top; Torn: a coloured strip with a ripped bottom edge.
*/
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import type { Tone } from './Button';
import s from './kit.module.css';

export function Tape({ side = 'center', color }: { side?: 'center' | 'left' | 'right'; color?: 'sun' | 'pink' | 'sky' | 'lime' }) {
  const c = [s.tape, side === 'left' ? s['tape-left'] : side === 'right' ? s['tape-right'] : '', color && color !== 'sun' ? s[`tape-${color}`] : ''];
  return <span className={c.filter(Boolean).join(' ')} aria-hidden="true" />;
}

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  tone?: Tone;
  /** Rotation in degrees. */
  tilt?: number;
  tape?: boolean | 'left' | 'right';
  tapeColor?: 'sun' | 'pink' | 'sky' | 'lime';
  halftone?: boolean;
  /** Pad the content (default true). */
  pad?: boolean;
  lift?: boolean;
  flat?: boolean;
  /** Tappable: squishes on press. */
  press?: boolean;
  children?: ReactNode;
}

export function Card({ tone = 'paper', tilt = 0, tape, tapeColor, halftone, pad = true, lift, flat, press, className, style, children, ...rest }: CardProps) {
  const cn = [s.card, s[`tone-${tone}`], pad ? s['card-pad'] : '', halftone ? s['card-halftone'] : '', lift ? s['card-lift'] : '', flat ? s['card-flat'] : '', press ? s['card-press'] : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <div {...rest} className={cn} style={{ '--tilt': `${tilt}deg`, ...style } as CSSProperties} role={press && !rest.role ? 'button' : rest.role} tabIndex={press ? 0 : rest.tabIndex}>
      {tape && <Tape side={tape === true ? 'center' : tape} color={tapeColor} />}
      {children}
    </div>
  );
}

export function Torn({ tone = 'tangerine', className, style, children }: { tone?: Tone; className?: string; style?: CSSProperties; children?: ReactNode }) {
  return (
    <div className={`${s.torn} ${s[`tone-${tone}`]} ${className ?? ''}`} style={style}>
      {children}
    </div>
  );
}
