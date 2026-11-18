/*
  Alerts on the phone:
  - BannerOverlay: every 'alerts.banner' becomes a toast that opens its url.
    On load, /recent fills in what was missed while offline (once each).
  - PushCard: the friendly "ping me before the big stuff" opt-in on home, with
    a test push, and the iPhone Add-to-Home-Screen explainer when needed.
*/
import { type Banner, RecentBannersResponseSchema, TestPushResponseSchema } from '@afterhours/shared/features/alerts';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../../core/api';
import { serverNow } from '../../core/clock';
import { useLiveEvent } from '../../core/live';
import { InstallHelp, isIOS, isStandalone } from '../../core/pwa/install';
import { celebrate } from '../../fun';
import { Button, Card, Doodle, useToast } from '../../kit';
import { ui } from '../common/ui';
import s from './alerts.module.css';
import { enablePush, isSubscribed, pushPermission, pushSupported } from './push';

const SEEN_KEY = 'ah:alerts-seen';
const PUSH_DISMISS = 'ah:push-dismissed';

function readNum(key: string): number | null {
  try {
    const v = localStorage.getItem(key);
    return v === null ? null : Number(v);
  } catch {
    return null;
  }
}
function writeNum(key: string, n: number): void {
  try {
    localStorage.setItem(key, String(n));
  } catch {
    /* private mode */
  }
}

export function BannerOverlay() {
  const toast = useToast();
  const show = (b: Banner) =>
    toast(b.body, { title: b.title, url: b.url !== '/' ? b.url : undefined, kind: b.kind === 'announcement' ? 'info' : 'good', icon: b.kind === 'announcement' ? 'megaphone' : 'bell', ms: 7000 });

  useLiveEvent('alerts.banner', (b) => {
    const seen = readNum(SEEN_KEY) ?? 0;
    if (b.id <= seen) return;
    writeNum(SEEN_KEY, b.id);
    show(b);
  });

  // Catch up once per load: banners from the last 20 minutes we have not shown.
  useEffect(() => {
    let off = false;
    api
      .get('/api/alerts/recent', RecentBannersResponseSchema)
      .then(({ banners }) => {
        if (off || banners.length === 0) return;
        const seen = readNum(SEEN_KEY);
        const max = Math.max(...banners.map((b) => b.id));
        writeNum(SEEN_KEY, Math.max(max, seen ?? 0));
        if (seen === null) return; // first visit: do not replay history
        const missed = banners.filter((b) => b.id > seen && serverNow() - b.at < 20 * 60_000).slice(-2);
        missed.forEach((b, i) => window.setTimeout(() => show(b), 600 + i * 900));
      })
      .catch(() => undefined);
    return () => {
      off = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

export function PushCard() {
  const toast = useToast();
  const [state, setState] = useState<'ask' | 'on' | 'hidden'>(() => {
    const dismissed = readNum(PUSH_DISMISS) === 1;
    if (dismissed) return 'hidden';
    const p = pushPermission();
    if (p === 'denied') return 'hidden';
    if (p === 'unsupported' && !isIOS()) return 'hidden';
    return 'ask';
  });
  const [help, setHelp] = useState(false);
  const [justOn, setJustOn] = useState(false);
  useEffect(() => {
    void isSubscribed().then((on) => on && setState('on'));
  }, []);
  const test = useMutation({
    mutationFn: () => api.post('/api/alerts/test', {}, TestPushResponseSchema),
    onSuccess: (r) => toast(r.sent > 0 ? 'check your notifications.' : r.pushEnabled ? 'no device registered yet. try turning alerts on again.' : 'push is off on the server today. in-app banners still work.', { kind: r.sent > 0 ? 'good' : 'info', title: r.sent > 0 ? 'test sent' : 'hmm' }),
    onError: (e) => toast(e.message, { kind: 'bad' }),
  });
  const turnOn = useMutation({
    mutationFn: enablePush,
    onSuccess: (r) => {
      if (r === 'on') {
        setState('on');
        setJustOn(true);
        celebrate({ y: 0.6 });
      } else if (r === 'denied') toast('no worries. banners still pop up while the app is open.', { kind: 'info', title: 'alerts blocked' });
      else if (r === 'server-off') toast('push is not set up today. in-app banners still work.', { kind: 'info' });
      else toast('this browser cannot do push. banners still work in the app.', { kind: 'info' });
    },
    onError: (e) => toast(e.message, { kind: 'bad' }),
  });
  if (state === 'hidden' || (state === 'on' && !justOn)) return null;
  const iosNeedsInstall = isIOS() && !isStandalone();
  const dismiss = () => {
    writeNum(PUSH_DISMISS, 1);
    setState('hidden');
  };
  return (
    <Card tone="grape" tilt={1} tape="left" tapeColor="pink" className={s.pushCard}>
      <div className={s.pushRow}>
        <span className={s.bell}>
          <Doodle name="bell" size={40} fill="var(--sun)" strokeWidth={2.4} />
        </span>
        <div className={ui.stack}>
          <h3 className={s.pushTitle}>{state === 'on' ? 'alerts are on' : 'ping me before the big stuff'}</h3>
          <p className={s.pushText}>
            {state === 'on'
              ? 'we will buzz you 15 min before the highlights. want a test?'
              : iosNeedsInstall
                ? 'on iphone, alerts only work once the app is on your home screen.'
                : 'three highlights today. we will buzz you 15 min before each. no spam.'}
          </p>
        </div>
      </div>
      <div className={ui.row}>
        {state === 'on' ? (
          <Button tone="lime" size="sm" icon="bell" onClick={() => test.mutate()} loading={test.isPending}>
            send a test
          </Button>
        ) : iosNeedsInstall ? (
          <Button tone="lime" size="sm" icon="phone" onClick={() => setHelp(true)}>
            show me how
          </Button>
        ) : (
          <Button tone="lime" size="sm" icon="bell" onClick={() => turnOn.mutate()} loading={turnOn.isPending} disabled={!pushSupported()}>
            turn on alerts
          </Button>
        )}
        <Button tone="paper" size="sm" ghost onClick={dismiss} className={s.ghostOnDark}>
          {state === 'on' ? 'done' : 'not now'}
        </Button>
      </div>
      <InstallHelp open={help} onClose={() => setHelp(false)} />
    </Card>
  );
}
