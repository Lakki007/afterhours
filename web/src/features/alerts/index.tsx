/*
  Alerts (spec 5.3): in-app banners for everyone (toasts that open their link,
  with an offline catch-up), the push opt-in card, the console announce box and
  status, and the projector's announcement tape.
  Server side: server/src/features/alerts.
*/
import { type Banner } from '@afterhours/shared/features/alerts';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { lazy, useEffect, useState } from 'react';
import { defineFeature } from '../../core/feature';
import { useLiveEvent } from '../../core/live';
import { Doodle } from '../../kit';
import s from './alerts.module.css';
import { BannerOverlay, PushCard } from './Attendee';

function AnnouncementTape() {
  const reduce = useReducedMotion();
  const [b, setB] = useState<Banner | null>(null);
  useLiveEvent('alerts.banner', (d) => setB(d));
  useEffect(() => {
    if (!b) return;
    const t = window.setTimeout(() => setB(null), 14_000);
    return () => window.clearTimeout(t);
  }, [b]);
  return (
    <AnimatePresence>
      {b && (
        <motion.div
          key={b.id}
          className={s.tape}
          initial={reduce ? { opacity: 0 } : { x: '-110%', rotate: -6 }}
          animate={{ x: 0, rotate: -1.5, opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { x: '110%', rotate: 3 }}
          transition={{ type: 'spring', stiffness: 160, damping: 20 }}
        >
          <Doodle name="megaphone" size={64} fill="var(--pink)" />
          <span className={s.tapeTitle}>{b.title}</span>
          <span className={s.tapeBody}>{b.body}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export const alerts = defineFeature({
  name: 'alerts',
  home: { order: 15, Card: PushCard },
  AttendeeOverlay: BannerOverlay,
  ScreenOverlay: AnnouncementTape,
  console: { order: 15, label: 'announce', path: 'alerts', icon: 'megaphone', Panel: lazy(() => import('./Console')) },
});
