/*
  Empty / loading / error states. They are moments, not afterthoughts:
  the mascot reacts and the copy says what to do next.
*/
import type { ReactNode } from 'react';
import { Button } from './Button';
import s from './kit.module.css';
import { Mascot, type MascotMood } from './Mascot';

export function EmptyState({ title, hint, action, mood = 'sleepy' }: { title: string; hint?: string; action?: ReactNode; mood?: MascotMood }) {
  return (
    <div className={s.state}>
      <Mascot size={92} mood={mood} />
      <h3 className={s.stateTitle}>{title}</h3>
      {hint && <p className={s.stateHint}>{hint}</p>}
      {action}
    </div>
  );
}

export function LoadingState({ label = 'one sec...' }: { label?: string }) {
  return (
    <div className={s.state} role="status" aria-live="polite">
      <span className={s.loadingDots} aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <p className={s.stateHint}>{label}</p>
    </div>
  );
}

export function ErrorState({ error, onRetry, title = 'that went sideways' }: { error?: unknown; onRetry?: () => void; title?: string }) {
  const msg = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Something broke. Try again?';
  return (
    <div className={s.state} role="alert">
      <Mascot size={92} mood="oops" />
      <h3 className={s.stateTitle}>{title}</h3>
      <p className={s.stateHint}>{msg}</p>
      {onRetry && (
        <Button tone="sun" icon="undo" onClick={onRetry}>
          try again
        </Button>
      )}
    </div>
  );
}
