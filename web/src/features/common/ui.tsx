/*
  Small shared pieces for feature screens. Kit components do the heavy lifting;
  these are the bits several features repeat (page head, ink stamps, console sections).
*/
import type { CSSProperties, ReactNode } from 'react';
import { Card, Scribble } from '../../kit';
import s from './ui.module.css';

export { s as ui };

export function PageHead({ title, note, color = 'var(--pink)' }: { title: string; note?: ReactNode; color?: string }) {
  return (
    <header className={s.head}>
      <h1 className={s.title}>{title}</h1>
      <Scribble color={color} style={{ width: 150 }} />
      {note && <p className={s.hand}>{note}</p>}
    </header>
  );
}

export type StampTone = 'live' | 'done' | 'late' | 'info' | 'sky' | 'ink';
export function Stamp({ tone = 'info', rot = -6, children, className }: { tone?: StampTone; rot?: number; children: ReactNode; className?: string }) {
  return (
    <span className={`${s.stamp} ${s[`stamp-${tone}`]} ${className ?? ''}`} style={{ '--rot': `${rot}deg` } as CSSProperties}>
      {children}
    </span>
  );
}

/** A console section: a paper card with a title. */
export function Section({ title, children, tilt = -0.3, tape, action }: { title: string; children: ReactNode; tilt?: number; tape?: boolean; action?: ReactNode }) {
  return (
    <Card tone="paper" tilt={tilt} tape={tape} tapeColor="lime">
      <div className={s.section}>
        <div className={s.between}>
          <h2 className={s.sectionTitle}>{title}</h2>
          {action}
        </div>
        {children}
      </div>
    </Card>
  );
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className={s.stat}>
      <span className={s.statNum}>{value}</span>
      <span className={s.statLabel}>{label}</span>
    </div>
  );
}

/** Download a file from an authenticated GET (console CSVs). */
export function downloadHref(href: string): void {
  const a = document.createElement('a');
  a.href = href;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
