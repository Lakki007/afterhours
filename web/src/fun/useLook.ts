/*
  useLook: a -1..1 vector from an element's centre toward the pointer (finger).
  Drives eyes that follow you (avatar builder, mascot). Passive, rAF-throttled.
*/
import { type RefObject, useEffect, useState } from 'react';

export interface LookVector {
  x: number;
  y: number;
}

export function useLook(ref: RefObject<Element | null>, enabled = true): LookVector {
  const [look, setLook] = useState<LookVector>({ x: 0, y: 0 });
  useEffect(() => {
    if (!enabled) return;
    let raf = 0;
    let last = { x: 0, y: 0 };
    const move = (e: PointerEvent) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const el = ref.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        const reach = Math.max(120, Math.min(window.innerWidth, 420) / 1.6);
        const next = { x: Math.max(-1, Math.min(1, dx / reach)), y: Math.max(-1, Math.min(1, dy / reach)) };
        if (Math.abs(next.x - last.x) + Math.abs(next.y - last.y) > 0.06) {
          last = next;
          setLook(next);
        }
      });
    };
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerdown', move, { passive: true });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerdown', move);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [ref, enabled]);
  return look;
}
