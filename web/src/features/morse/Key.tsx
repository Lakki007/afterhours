/*
  The telegraph key. Pointer events with capture, performance.now() timings, a
  near-zero-latency tone while held, no text selection, long-press menu or scroll.
  Reports presses as [downMs, upMs] since the first press.
*/
import type { Press } from '@afterhours/shared/features/morse';
import { useRef, useState } from 'react';
import { haptics, sfx } from '../../fun';
import s from './morse.module.css';

export function TelegraphKey({ onPress, disabled, label = 'tap and hold' }: { onPress: (p: Press, all: Press[]) => void; disabled?: boolean; label?: string }) {
  const [down, setDown] = useState(false);
  const first = useRef<number | null>(null);
  const downAt = useRef(0);
  const presses = useRef<Press[]>([]);
  const stopTone = useRef<() => void>(() => {});
  const release = () => {
    if (!down) return;
    setDown(false);
    stopTone.current();
    haptics.stop();
    const up = performance.now();
    const base = first.current ?? downAt.current;
    const p: Press = [Math.round(downAt.current - base), Math.round(up - base)];
    presses.current = [...presses.current, p];
    onPress(p, presses.current);
  };
  return (
    <button
      type="button"
      className={`${s.key} ${down ? s.keyDown : ''}`}
      disabled={disabled}
      aria-label={label}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        if (disabled) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        const now = performance.now();
        if (first.current === null) first.current = now;
        downAt.current = now;
        setDown(true);
        stopTone.current = sfx.tone(640, { gain: 0.25 });
        haptics.buzz(4000);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
    >
      <span className={s.keyKnob} />
      <span className={s.keyLabel}>{label}</span>
    </button>
  );
}

