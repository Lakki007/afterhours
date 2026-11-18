/*
  Console: per-activity check-in. Pick a schedule activity, open/close its
  check-in, watch live counts and the rotating code, search who is in, check
  someone in by hand (dead phone), download the two CSVs.
*/
import { AdminOverviewSchema, AdminWindowSchema, AttendanceListSchema, CheckinResponseSchema, ScreenCheckinsSchema } from '@afterhours/shared/features/attendance';
import { ScheduleStateSchema } from '@afterhours/shared/features/schedule';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../core/api';
import { useLiveEvent } from '../../core/live';
import { fmtClock } from '../../core/time';
import { Button, Countdown, TextField, useToast } from '../../kit';
import { Section, Stamp, Stat, downloadHref, ui } from '../common/ui';
import s from './attendance.module.css';

const ovKey = ['attendance', 'admin', 'overview'] as const;

export default function AttendanceConsole() {
  const qc = useQueryClient();
  const toast = useToast();
  const ov = useQuery({ queryKey: ovKey, queryFn: () => api.get('/api/attendance/admin/overview', AdminOverviewSchema), refetchInterval: 5000 });
  const sched = useQuery({ queryKey: ['schedule'], queryFn: () => api.get('/api/schedule', ScheduleStateSchema) });
  const codes = useQuery({ queryKey: ['attendance', 'screen'], queryFn: () => api.get('/api/attendance/screen', ScreenCheckinsSchema), refetchInterval: 10_000 });
  useLiveEvent('attendance.counts', () => void ov.refetch());
  useLiveEvent('attendance.code', () => void codes.refetch());
  useLiveEvent('attendance.state', () => {
    void ov.refetch();
    void codes.refetch();
  });
  const [pick, setPick] = useState<string>('');
  const [q, setQ] = useState('');
  const [who, setWho] = useState('');
  const activities = sched.data?.activities ?? [];
  const windows = ov.data?.windows ?? [];
  const selected = pick || windows.find((w) => w.open)?.activityId || (sched.data?.nowId ? String(sched.data.nowId) : '') || String(activities[0]?.id ?? '');
  const win = windows.find((w) => w.activityId === selected);
  const code = codes.data?.open.find((o) => o.activityId === selected);

  const toggle = useMutation({
    mutationFn: (open: boolean) => api.post(open ? '/api/attendance/admin/open' : '/api/attendance/admin/close', { activityId: selected }, AdminWindowSchema),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ovKey });
      void codes.refetch();
    },
    onError: (e) => toast(e.message, { kind: 'bad' }),
  });
  const list = useQuery({
    queryKey: ['attendance', 'admin', 'list', selected, q],
    queryFn: () => api.get(`/api/attendance/admin/activity/${encodeURIComponent(selected)}?q=${encodeURIComponent(q)}&limit=200`, AttendanceListSchema),
    enabled: Boolean(win),
    refetchInterval: 5000,
  });
  const people = useQuery({
    queryKey: ['attendance', 'admin', 'event', who],
    queryFn: () => api.get(`/api/attendance/admin/event?q=${encodeURIComponent(who)}&limit=8`, AttendanceListSchema),
    enabled: who.trim().length >= 2,
  });
  const manual = useMutation({
    mutationFn: (attendeeId: number) => api.post(`/api/attendance/admin/activity/${encodeURIComponent(selected)}/checkin`, { attendeeId }, CheckinResponseSchema),
    onSuccess: (r) => {
      toast(`#${r.position} at ${r.title}`, { kind: 'good', title: r.newlyCheckedIn ? 'checked in' : 'already in' });
      void list.refetch();
    },
    onError: (e) => toast(e.message, { kind: 'bad' }),
  });

  return (
    <div className={ui.stack}>
      <Section title="event attendance" tape>
        <div className={ui.statGrid}>
          <Stat label="signed in today" value={ov.data?.eventCount ?? '...'} />
          <Stat label="made a face" value={ov.data?.profileCount ?? '...'} />
          <Stat label="activity check-ins" value={windows.reduce((n, w) => n + w.count, 0)} />
        </div>
        <div className={ui.row}>
          <Button tone="sky" size="sm" icon="download" onClick={() => downloadHref('/api/attendance/admin/export/event.csv')}>
            everyone who came (csv)
          </Button>
        </div>
      </Section>

      <Section title="check-in for an activity" tilt={0.3}>
        <div className={ui.row}>
          <label className={ui.label}>
            activity
            <select className={ui.select} value={selected} onChange={(e) => setPick(e.target.value)} aria-label="activity">
              {activities.map((a) => {
                const w = windows.find((x) => x.activityId === String(a.id));
                return (
                  <option key={a.id} value={String(a.id)}>
                    {fmtClock(a.startAt)} {a.title}
                    {w ? (w.open ? ' (open)' : ` (${w.count} in)`) : ''}
                  </option>
                );
              })}
            </select>
          </label>
          {win?.open ? (
            <Button tone="pink" icon="lock" onClick={() => toggle.mutate(false)} loading={toggle.isPending}>
              close check-in
            </Button>
          ) : (
            <Button tone="lime" icon="ticket" onClick={() => toggle.mutate(true)} loading={toggle.isPending} disabled={!selected}>
              {win ? 'reopen check-in' : 'open check-in'}
            </Button>
          )}
        </div>
        {win && (
          <div className={ui.statGrid}>
            <Stat label="checked in" value={win.count} />
            {code && (
              <div className={ui.stat}>
                <span className={s.code}>{code.code}</span>
                <span className={ui.statLabel}>
                  code now, rotates in <Countdown to={code.rotatesAt} />
                </span>
              </div>
            )}
          </div>
        )}
        <h3 className={ui.kicker}>all check-ins</h3>
        <ul className={s.winList}>
          {windows.map((w) => (
            <li key={w.activityId} className={`${s.winItem} ${w.open ? s.winOpen : ''}`}>
              <span>
                <b>{w.title}</b> <span className={ui.hand}>opened {fmtClock(w.openedAt)}</span>
              </span>
              {w.open ? <Stamp tone="ink">open</Stamp> : <Stamp tone="done">closed</Stamp>}
              <span className={s.winCount}>{w.count}</span>
            </li>
          ))}
          {windows.length === 0 && <li className={ui.hand}>nothing opened yet.</li>}
        </ul>
      </Section>

      {win && (
        <Section title={`who is in: ${win.title}`} tilt={-0.2}>
          <div className={ui.row}>
            <TextField label="search name, roll, nickname, kit" value={q} onChange={(e) => setQ(e.target.value)} />
            <Button tone="sky" size="sm" icon="download" onClick={() => downloadHref(`/api/attendance/admin/export/activity/${encodeURIComponent(selected)}.csv`)}>
              this activity (csv)
            </Button>
          </div>
          <table className={ui.table}>
            <thead>
              <tr>
                <th>kit</th>
                <th>name</th>
                <th>roll</th>
                <th>nickname</th>
                <th>at</th>
              </tr>
            </thead>
            <tbody>
              {list.data?.rows.map((r) => (
                <tr key={r.attendeeId}>
                  <td className={ui.num}>{r.kitId}</td>
                  <td>{r.name}</td>
                  <td>{r.roll}</td>
                  <td>{r.nickname}</td>
                  <td>{fmtClock(r.at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={ui.hand}>{list.data ? `${list.data.total} total` : ''}</p>

          <h3 className={ui.kicker}>check someone in by hand</h3>
          <TextField label="find them" value={who} onChange={(e) => setWho(e.target.value)} placeholder="name, roll or kit id" />
          <ul className={s.winList}>
            {people.data?.rows.map((p) => (
              <li key={p.attendeeId} className={s.winItem}>
                <span>
                  <b>{p.nickname ?? p.name}</b> <span className={ui.hand}>{p.name}, {p.roll}, {p.kitId}</span>
                </span>
                <span />
                <Button size="sm" tone="lime" onClick={() => manual.mutate(p.attendeeId)}>
                  check in
                </Button>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
