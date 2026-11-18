/* Console: announcement box (with push toggle), armed highlight alerts, and the send log. */
import { AlertStatusSchema, AnnounceResponseSchema, type ArmedState } from '@afterhours/shared/features/alerts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../core/api';
import { useLiveEvent } from '../../core/live';
import { fmtClock } from '../../core/time';
import { Button, TextArea, TextField, useToast } from '../../kit';
import { Section, Stamp, Stat, ui } from '../common/ui';
import s from './alerts.module.css';

const LINKS = ['', '/schedule', '/polls', '/hunt', '/morse', '/arcade', '/leaderboard', '/checkin'];
const STATE_TONE: Record<ArmedState, 'info' | 'live' | 'late'> = { pending: 'info', sent: 'live', missed: 'late' };

export default function AlertsConsole() {
  const toast = useToast();
  const status = useQuery({ queryKey: ['alerts', 'status'], queryFn: () => api.get('/api/alerts/status', AlertStatusSchema), refetchInterval: 10_000 });
  useLiveEvent('alerts.banner', () => void status.refetch());
  const [title, setTitle] = useState('announcement');
  const [body, setBody] = useState('');
  const [link, setLink] = useState('');
  const [push, setPush] = useState(true);
  const send = useMutation({
    mutationFn: () => api.post('/api/alerts/announce', { title, body, link: link || null, push }, AnnounceResponseSchema),
    onSuccess: (r) => {
      toast(r.push ? `push: ${r.push.sent} sent, ${r.push.failed} failed` : 'banner only', { kind: 'good', title: 'announced' });
      setBody('');
      void status.refetch();
    },
    onError: (e) => toast(e.message, { kind: 'bad' }),
  });
  const st = status.data;
  return (
    <div className={ui.stack}>
      <Section title="say something to everyone" tape>
        <div className={ui.stack}>
          <TextField label="title" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} />
          <TextArea label="message" value={body} maxLength={200} onChange={(e) => setBody(e.target.value)} placeholder="hunt clues just got spicier. go go go." />
          <div className={ui.row}>
            <label className={ui.label}>
              opens
              <select className={ui.select} value={link} onChange={(e) => setLink(e.target.value)}>
                {LINKS.map((l) => (
                  <option key={l} value={l}>
                    {l || 'home'}
                  </option>
                ))}
              </select>
            </label>
            <label className={ui.toggle}>
              <input type="checkbox" checked={push} onChange={(e) => setPush(e.target.checked)} />
              also send a push notification
            </label>
          </div>
          <div className={ui.row}>
            <Button tone="pink" icon="megaphone" onClick={() => send.mutate()} loading={send.isPending} disabled={!body.trim()}>
              announce
            </Button>
            <span className={ui.hand}>phones get a banner right away, the projector shows a tape strip.</span>
          </div>
        </div>
      </Section>

      <Section title="push status" tilt={0.3}>
        <div className={ui.statGrid}>
          <Stat label="push on the server" value={st ? (st.pushEnabled ? 'on' : 'off') : '...'} />
          <Stat label="devices subscribed" value={st?.subscriptions ?? '...'} />
        </div>
        <h3 className={ui.kicker}>highlight alerts (15 min before, then live)</h3>
        <ul className={s.armed}>
          {st?.armed.map((a) => (
            <li key={a.activityId}>
              <span>
                <b>{a.title}</b> <span className={ui.hand}>at {fmtClock(a.startAt)}</span>
              </span>
              <Stamp tone={STATE_TONE[a.soon.state]}>soon: {a.soon.state}</Stamp>
              <Stamp tone={STATE_TONE[a.live.state]}>live: {a.live.state}</Stamp>
            </li>
          ))}
          {st && st.armed.length === 0 && <li className={ui.hand}>no highlights left to alert about.</li>}
        </ul>
      </Section>

      <Section title="sent so far" tilt={-0.2}>
        <ul className={s.log}>
          {st?.log.map((b) => (
            <li key={b.id}>
              <span className={s.logHead}>
                <Stamp tone={b.kind === 'announcement' ? 'sky' : 'info'}>{b.kind}</Stamp>
                {fmtClock(b.at)} {b.title}
              </span>
              <span>{b.body}</span>
              {b.push && <span className={ui.hand}>push: {b.push.sent} sent, {b.push.failed} failed, {b.push.removed} dead subscriptions removed</span>}
            </li>
          ))}
          {st && st.log.length === 0 && <li className={ui.hand}>nothing sent yet.</li>}
        </ul>
      </Section>
    </div>
  );
}
