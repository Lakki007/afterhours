/*
  StickerCelebration: the full-screen "you got a sticker" moment.
  Driven by the live 'sticker.unlocked' event (sent to one attendee). Mounted
  once by the attendee shell. Queues if several land at once.
*/
import type { StickerDef } from '@afterhours/shared';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLiveEvent } from '../core/live';
import { qk } from '../core/queries';
import { Button } from '../kit/Button';
import { Scribble } from '../kit/Doodle';
import { Sticker } from '../kit/Sticker';
import { celebrate } from './confetti';
import s from './fun.module.css';
import { Draggy } from './Tilt';

export function StickerCelebration() {
  const qc = useQueryClient();
  const reduce = useReducedMotion();
  const [queue, setQueue] = useState<StickerDef[]>([]);
  const current = queue[0] ?? null;
  const shown = useRef<string | null>(null);

  useLiveEvent('sticker.unlocked', (d) => {
    void qc.invalidateQueries({ queryKey: qk.stickers });
    setQueue((q) => (q.some((x) => x.id === d.sticker.id) ? q : [...q, d.sticker]));
  });

  useEffect(() => {
    if (current && shown.current !== current.id) {
      shown.current = current.id;
      const t = window.setTimeout(() => celebrate({ y: 0.7 }), 260);
      return () => window.clearTimeout(t);
    }
    if (!current) shown.current = null;
    return undefined;
  }, [current]);

  const next = useCallback(() => setQueue((q) => q.slice(1)), []);

  return createPortal(
    <AnimatePresence>
      {current && (
        <motion.div
          key={current.id}
          className={s.celebrate}
          role="alertdialog"
          aria-label={`New sticker: ${current.title}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.2 } }}
        >
          <div className={s.celebrateCard}>
            <motion.h2
              className={s.celebrateHead}
              initial={reduce ? { opacity: 0 } : { scale: 0.4, rotate: -12, opacity: 0 }}
              animate={{ scale: 1, rotate: -3, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 420, damping: 15, delay: 0.1 }}
            >
              sticker unlocked!
            </motion.h2>
            <Scribble color="var(--lime)" style={{ width: 220, margin: '4px auto 18px' }} />
            <Draggy className={s.celebrateSticker}>
              <Sticker def={current} size={190} tilt={-7} slap />
            </Draggy>
            <p className={s.celebrateTitle}>{current.title}</p>
            <p className={s.celebrateHint}>{current.hint}</p>
            {queue.length > 1 && <p className={s.celebrateMore}>+{queue.length - 1} more waiting</p>}
            <Button tone="lime" size="lg" onClick={next} autoFocus>
              stick it in
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
