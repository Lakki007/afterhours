/*
  Install prompt.
  - Android/desktop Chrome: captures `beforeinstallprompt`, offers a real button.
  - iPhone Safari: there is no API, so we show the "Add to Home Screen" steps.
  useInstall() for logic, <InstallCard/> as a ready-made home card,
  <InstallHelp/> if a feature (alerts) wants to open the iPhone explainer itself.
*/
import { useSyncExternalStore, useState } from 'react';
import { Button, Card, Doodle, Sheet } from '../../kit';
import { RecurseIcon, RecurseLogo } from '../../kit/Brand';
import { sfx } from '../../fun/sfx';
import s from './install.module.css';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'ah:install-dismissed';
let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
let version = 0;

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    version++;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    deferred = null;
    version++;
    emit();
  });
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

export interface InstallState {
  /** Already running as an installed app. */
  standalone: boolean;
  /** One tap installs (Chrome). */
  canPrompt: boolean;
  /** iPhone/iPad Safari: needs the manual steps. */
  needsIosSteps: boolean;
  prompt: () => Promise<boolean>;
}

export function useInstall(): InstallState {
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version,
    () => 0,
  );
  const standalone = installed || isStandalone();
  return {
    standalone,
    canPrompt: !standalone && deferred !== null,
    needsIosSteps: !standalone && isIOS(),
    prompt: async () => {
      if (!deferred) return false;
      await deferred.prompt();
      const choice = await deferred.userChoice;
      deferred = null;
      version++;
      emit();
      return choice.outcome === 'accepted';
    },
  };
}

export function InstallHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="put it on your home screen">
      <IosPicture />
      <ol className={s.steps}>
        <li>
          <span className={s.stepNum}>1</span>
          <span>
            Tap the <b>share</b> button in Safari
            <span className={s.stepArt}>
              <Doodle name="share" size={34} fill="var(--sky)" />
            </span>
          </span>
        </li>
        <li>
          <span className={s.stepNum}>2</span>
          <span>
            Scroll down, tap <b>Add to Home Screen</b>
            <span className={s.stepArt}>
              <Doodle name="plus" size={30} />
            </span>
          </span>
        </li>
        <li>
          <span className={s.stepNum}>3</span>
          <span>
            Tap <b>Add</b>, then open After Hours from the new icon
          </span>
        </li>
      </ol>
      <p className={s.note}>You need this on iPhone for alerts to work. Open it from the icon, not Safari.</p>
      <Button tone="lime" block onClick={onClose}>
        got it
      </Button>
    </Sheet>
  );
}

/** A drawn iPhone: Safari's share button at the bottom, then the new icon on the home screen. */
function IosPicture() {
  return (
    <div className={s.pic} aria-hidden="true">
      <div className={s.phone}>
        <div className={s.phoneBar}>{typeof location === 'undefined' ? '' : location.host}</div>
        <div className={s.phoneBody}>
          <RecurseLogo height={18} />
        </div>
        <div className={s.phoneTools}>
          <span />
          <span className={s.shareHi}>
            <Doodle name="share" size={22} />
          </span>
          <span />
        </div>
      </div>
      <Doodle name="arrow" size={40} />
      <div className={s.phone}>
        <div className={s.homeGrid}>
          <span />
          <span />
          <span className={s.appIcon}>
            <RecurseIcon size={34} />
            <small>After Hours</small>
          </span>
          <span />
        </div>
      </div>
    </div>
  );
}

/** Home-screen card. Renders nothing when installed, dismissed or unsupported. */
export function InstallCard() {
  const inst = useInstall();
  const [help, setHelp] = useState(false);
  const [hidden, setHidden] = useState(wasDismissed);
  if (hidden || inst.standalone || (!inst.canPrompt && !inst.needsIosSteps)) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* private mode */
    }
    setHidden(true);
  };
  return (
    <Card tone="sky" tilt={-1} tape tapeColor="sun" halftone>
      <div className={s.card}>
        <RecurseIcon size={52} />
        <div className={s.cardText}>
          <h3 className={s.cardTitle}>keep me on your home screen</h3>
          <p>opens faster, works on bad wifi, and unlocks alerts.</p>
        </div>
      </div>
      <div className={s.actions}>
        <Button
          tone="lime"
          size="sm"
          onClick={() => {
            if (inst.canPrompt) void inst.prompt().then((ok) => ok && sfx.success());
            else setHelp(true);
          }}
        >
          {inst.canPrompt ? 'add it' : 'show me how'}
        </Button>
        <Button tone="paper" size="sm" ghost onClick={dismiss}>
          not now
        </Button>
      </div>
      <InstallHelp open={help} onClose={() => setHelp(false)} />
    </Card>
  );
}
