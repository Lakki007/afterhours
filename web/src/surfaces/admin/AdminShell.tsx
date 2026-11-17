/*
  Console shell: index-tab side nav built from the feature registry (plus the
  two core panels, Kits and Projector), and a routed content area.
*/
import { Navigate, NavLink, Route, Routes } from 'react-router';
import { consolePanels } from '../../core/featureHost';
import { useStaffSignOut } from '../../core/queries';
import { Button, Doodle, EmptyState, type IconName, type Tone } from '../../kit';
import { Wordmark } from '../shared/Wordmark';
import s from './admin.module.css';
import { KitsPanel } from './KitsPanel';
import { ProjectorPanel } from './ProjectorPanel';

interface NavEntry {
  path: string;
  label: string;
  icon: IconName;
}

const CORE: NavEntry[] = [
  { path: 'kits', label: 'kits and sign-ins', icon: 'ticket' },
  { path: 'projector', label: 'projector', icon: 'screen' },
];
const NAV: NavEntry[] = [...CORE, ...consolePanels.map((p) => ({ path: p.path, label: p.label, icon: p.icon }))];
const TONES: Tone[] = ['tangerine', 'lime', 'pink', 'sky', 'sun', 'grape'];

export function AdminShell() {
  const signOut = useStaffSignOut('admin');
  return (
    <div className={s.shell}>
      <aside className={s.side}>
        <div className={s.brand}>
          <Wordmark size={34} />
          <p className={s.brandNote}>organiser console</p>
        </div>
        <nav className={s.nav} aria-label="console">
          {NAV.map((n, i) => (
            <NavLink key={n.path} to={`/admin/${n.path}`} className={({ isActive }) => `${s.navItem} ${isActive ? s.navOn : ''}`} style={{ ['--tab' as string]: `var(--${TONES[i % TONES.length]})` }}>
              <Doodle name={n.icon} size={24} />
              <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <Button tone="paper" size="sm" ghost onClick={() => signOut.mutate()}>
          lock console
        </Button>
      </aside>
      <main className={s.content}>
        <Routes>
          <Route index element={<Navigate to="kits" replace />} />
          <Route path="kits" element={<KitsPanel />} />
          <Route path="projector" element={<ProjectorPanel />} />
          {consolePanels.map((p) => (
            <Route
              key={p.path}
              path={`${p.path}/*`}
              element={
                <div className={s.panel}>
                  <h1 className={s.panelTitle}>{p.label}</h1>
                  <p.Panel />
                </div>
              }
            />
          ))}
          <Route path="*" element={<EmptyState title="no such panel" hint="pick one from the left." mood="oops" />} />
        </Routes>
      </main>
    </div>
  );
}
