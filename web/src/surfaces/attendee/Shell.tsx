/*
  Attendee shell: page frame, bottom nav built from the feature registry,
  and the always-on overlays features contribute (floating reactions, poll takeover...).
*/
import type { MeResponse } from '@afterhours/shared';
import { motion } from 'motion/react';
import { NavLink, Route, Routes, useLocation } from 'react-router';
import { attendeeOverlays, attendeeRoutes, navItems } from '../../core/featureHost';
import { useUpdateReady, applyUpdate } from '../../core/pwa/register';
import { haptics, sfx } from '../../fun';
import { Button, Doodle, EmptyState, type IconName, PageTransition } from '../../kit';
import { Home } from './Home';
import { StickerBook } from './StickerBook';
import s from './attendee.module.css';

const NAV: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: '/', label: 'home', icon: 'home', end: true },
  ...navItems.map((n) => ({ to: n.to, label: n.label, icon: n.icon })),
  { to: '/stickers', label: 'stickers', icon: 'book' },
];

function BottomNav() {
  return (
    <nav className={s.nav} aria-label="main">
      {NAV.map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.end}
          className={({ isActive }) => `${s.navItem} ${isActive ? s.navOn : ''}`}
          onPointerDown={() => {
            sfx.tick();
            haptics.tick();
          }}
        >
          {({ isActive }) => (
            <>
              {isActive && <motion.span layoutId="navblob" className={s.navBlob} transition={{ type: 'spring', stiffness: 500, damping: 28 }} />}
              <span className={s.navInner}>
                <Doodle name={n.icon} size={26} fill={isActive ? 'var(--paper-3)' : 'none'} />
                <span className={s.navLabel}>{n.label}</span>
              </span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

function NotFound() {
  return <EmptyState title="nothing here" hint="that page wandered off. try home." mood="oops" />;
}

function UpdateBanner() {
  const ready = useUpdateReady();
  if (!ready) return null;
  return (
    <div className={s.update}>
      <span>a fresh version is ready</span>
      <Button size="sm" tone="lime" onClick={applyUpdate}>
        reload
      </Button>
    </div>
  );
}

export function Shell({ me }: { me: MeResponse }) {
  const { pathname } = useLocation();
  return (
    <div className={s.shell}>
      <UpdateBanner />
      <main className={s.main}>
        <PageTransition pageKey={pathname === '/' ? '/' : (pathname.split('/')[1] ?? '/')}>
          <Routes>
            <Route index element={<Home me={me} />} />
            <Route path="stickers" element={<StickerBook />} />
            {attendeeRoutes.map((r) => (
              <Route key={`${r.feature}:${r.path}`} path={r.path} element={<r.Component />} />
            ))}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </PageTransition>
      </main>
      <BottomNav />
      {attendeeOverlays.map((f) => (f.AttendeeOverlay ? <f.AttendeeOverlay key={f.name} /> : null))}
    </div>
  );
}
