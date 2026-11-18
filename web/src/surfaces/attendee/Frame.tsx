/*
  The attendee app's frame pieces.
  - Splash: the branded launch state (same look as the inline boot screen in index.html).
  - DesktopAside: on a laptop the app is a phone-width column; this panel beside it
    says it is built for your phone, with a QR to open it there.
*/
import { motion, useReducedMotion } from 'motion/react';
import { useAppConfig } from '../../core/queries';
import { Qr, RecurseIcon, RecurseLogo } from '../../kit';
import { Wordmark } from '../shared/Wordmark';
import s from './frame.module.css';

export function Splash() {
  const reduce = useReducedMotion();
  return (
    <div className={s.splash} role="status" aria-label="After Hours is loading">
      <motion.div animate={reduce ? {} : { rotate: [-4, 4, -4] }} transition={{ repeat: Infinity, duration: 2.4, ease: 'easeInOut' }}>
        <RecurseIcon size={112} className={s.splashIcon} />
      </motion.div>
      <Wordmark size={40} />
      <RecurseLogo height={34} />
    </div>
  );
}

export function DesktopAside() {
  const cfg = useAppConfig();
  const url = cfg.data?.appUrl ?? window.location.origin;
  return (
    <aside className={s.aside} aria-label="open on your phone">
      <RecurseLogo height={36} />
      <h2 className={s.asideTitle}>built for your phone</h2>
      <p className={s.asideText}>after hours is an app for the afternoon: alerts, the hunt camera and the telegraph key all live on your phone. scan this to open it there.</p>
      <div className={s.qr}>
        <Qr text={url} size={190} label="Scan to open After Hours on your phone" />
      </div>
      <p className={s.asideHost}>{url.replace(/^https?:\/\//, '')}</p>
    </aside>
  );
}
