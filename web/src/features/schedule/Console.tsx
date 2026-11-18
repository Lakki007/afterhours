/*
  Console: run of show. Start now / end now / +5 +10 +15 (with a preview of how
  many later activities get pushed), highlight star, move up/down, inline edit,
  create and delete. Every phone follows within a tick.
*/
import { ActivityKindSchema } from '@afterhours/shared';
import { type Activity, type ActivityInput, type ScheduleState, ScheduleStateSchema } from '@afterhours/shared/features/schedule';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../core/api';
import { useServerNow } from '../../core/clock';
import { atIstHHMM, fmtClock, istHHMM } from '../../core/time';
import { Button, IconButton, Sheet, TextArea, TextField, useToast } from '../../kit';
import { Section, Stamp, ui } from '../common/ui';
import s from './schedule.module.css';
import { KIND_LABEL, scheduleKey, useSchedule } from './useSchedule';

const LINKS = ['', '/polls', '/hunt', '/morse', '/arcade', '/leaderboard', '/checkin'];

/** How many later activities a delay of `min` would push (mirrors the server cascade). */
export function cascadeCount(list: Activity[], a: Activity, min: number): number {
  let prevEnd = a.endAt + min * 60_000;
  let n = 0;
  const idx = list.findIndex((x) => x.id === a.id);
  for (const r of list.slice(idx + 1)) {
    if (r.status !== 'upcoming') continue;
    if (r.startAt < prevEnd) {
      n++;
      prevEnd = r.endAt + (prevEnd - r.startAt);
    } else prevEnd = Math.max(prevEnd, r.endAt);
  }
  return n;
}

function useAct() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (f: () => Promise<ScheduleState>) => f(),
    onSuccess: (st) => qc.setQueryData(scheduleKey, st),
    onError: (e) => toast(e.message, { kind: 'bad', title: 'nope' }),
  });
}

interface Draft {
  id: number | null;
  title: string;
  blurb: string;
  location: string;
  kind: Activity['kind'];
  link: string;
  highlight: boolean;
  start: string;
  end: string;
  base: number;
}

function draftOf(a: Activity | null, base: number): Draft {
  if (!a) return { id: null, title: '', blurb: '', location: '', kind: 'talk', link: '', highlight: false, start: istHHMM(base), end: istHHMM(base + 30 * 60_000), base };
  return { id: a.id, title: a.title, blurb: a.blurb, location: a.location, kind: a.kind, link: a.link ?? '', highlight: a.highlight, start: istHHMM(a.startAt), end: istHHMM(a.endAt), base: a.startAt };
}

function Editor({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  const [d, setD] = useState(draft);
  const act = useAct();
  const save = () => {
    const body: ActivityInput = {
      title: d.title,
      blurb: d.blurb,
      location: d.location,
      kind: d.kind,
      link: d.link || null,
      highlight: d.highlight,
      startAt: atIstHHMM(d.base, d.start),
      endAt: atIstHHMM(d.base, d.end),
    };
    act.mutate(() => (d.id === null ? api.post('/api/schedule', body, ScheduleStateSchema) : api.patch(`/api/schedule/${d.id}`, body, ScheduleStateSchema)), { onSuccess: onClose });
  };
  return (
    <div className={s.form}>
      <div className={s.formWide}>
        <TextField label="title" value={d.title} maxLength={80} onChange={(e) => setD({ ...d, title: e.target.value })} />
      </div>
      <div className={s.formWide}>
        <TextArea label="blurb" value={d.blurb} maxLength={280} onChange={(e) => setD({ ...d, blurb: e.target.value })} />
      </div>
      <TextField label="where" value={d.location} maxLength={60} onChange={(e) => setD({ ...d, location: e.target.value })} />
      <label className={ui.label}>
        kind
        <select className={ui.select} value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value as Activity['kind'] })}>
          {ActivityKindSchema.options.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      <TextField label="starts (IST)" type="time" value={d.start} onChange={(e) => setD({ ...d, start: e.target.value })} />
      <TextField label="ends (IST)" type="time" value={d.end} onChange={(e) => setD({ ...d, end: e.target.value })} />
      <label className={ui.label}>
        jump-in link
        <select className={ui.select} value={d.link} onChange={(e) => setD({ ...d, link: e.target.value })}>
          {LINKS.map((l) => (
            <option key={l} value={l}>
              {l || 'none'}
            </option>
          ))}
        </select>
      </label>
      <label className={ui.toggle}>
        <input type="checkbox" checked={d.highlight} onChange={(e) => setD({ ...d, highlight: e.target.checked })} />
        highlight (push alert 15 min before and when live)
      </label>
      <div className={`${s.formWide} ${ui.row}`}>
        <Button tone="lime" icon="check" onClick={save} loading={act.isPending} disabled={!d.title.trim()}>
          {d.id === null ? 'add it' : 'save'}
        </Button>
        <Button tone="paper" ghost onClick={onClose}>
          cancel
        </Button>
      </div>
    </div>
  );
}

function RunItem({ a, list, upcoming, onEdit }: { a: Activity; list: Activity[]; upcoming: Activity[]; onEdit: () => void }) {
  const act = useAct();
  const [confirmDel, setConfirmDel] = useState(false);
  const pos = upcoming.findIndex((x) => x.id === a.id);
  const move = (dir: -1 | 1) => {
    const order = upcoming.map((x) => x.id);
    const j = pos + dir;
    if (j < 0 || j >= order.length) return;
    [order[pos], order[j]] = [order[j] as number, order[pos] as number];
    act.mutate(() => api.post('/api/schedule/reorder', { order }, ScheduleStateSchema));
  };
  const late = Math.round(a.delayMs / 60_000);
  const c10 = cascadeCount(list, a, 10);
  return (
    <li className={`${s.runItem} ${a.status === 'live' ? s.runLive : ''} ${a.status === 'ended' ? s.runDone : ''}`} data-testid={`run-${a.id}`}>
      <div className={s.runTimes}>
        <span>{fmtClock(a.startAt)}</span>
        <span>{fmtClock(a.endAt)}</span>
      </div>
      <div className={s.runMain}>
        <span className={s.runTitle}>
          {a.highlight ? '★ ' : ''}
          {a.title}
        </span>
        <span className={ui.row}>
          {a.status === 'live' && <Stamp tone="ink">live</Stamp>}
          {a.status === 'ended' && <Stamp tone="done">done</Stamp>}
          {late > 0 && <Stamp tone="late">+{late} min</Stamp>}
          {late < 0 && <Stamp tone="sky">early</Stamp>}
          <span className={ui.hand}>
            {KIND_LABEL[a.kind]}, {a.location || 'no place set'}
            {a.link ? `, links ${a.link}` : ''}
          </span>
        </span>
        {a.status !== 'ended' && c10 > 0 && <span className={s.cascade}>+10 here pushes {c10} after it</span>}
      </div>
      <div className={s.runBtns}>
        {a.status !== 'live' && (
          <Button size="sm" tone="lime" icon="play" onClick={() => act.mutate(() => api.post(`/api/schedule/${a.id}/start`, {}, ScheduleStateSchema))}>
            start now
          </Button>
        )}
        {a.status === 'live' && (
          <Button size="sm" tone="pink" icon="close" onClick={() => act.mutate(() => api.post(`/api/schedule/${a.id}/end`, {}, ScheduleStateSchema))}>
            end now
          </Button>
        )}
        {a.status !== 'ended' &&
          ([5, 10, 15] as const).map((m) => (
            <Button
              key={m}
              size="sm"
              tone="sun"
              title={`pushes ${cascadeCount(list, a, m)} later activities`}
              onClick={() => act.mutate(() => api.post(`/api/schedule/${a.id}/delay`, { minutes: m }, ScheduleStateSchema))}
            >
              +{m}
            </Button>
          ))}
        <IconButton
          size="sm"
          icon="star"
          label={a.highlight ? 'unstar' : 'make it a highlight'}
          tone={a.highlight ? 'sun' : 'paper'}
          onClick={() => act.mutate(() => api.post(`/api/schedule/${a.id}/highlight`, { highlight: !a.highlight }, ScheduleStateSchema))}
        />
        {pos >= 0 && (
          <>
            <IconButton size="sm" icon="arrow" label="move earlier" style={{ transform: 'rotate(-90deg)' }} disabled={pos === 0} onClick={() => move(-1)} />
            <IconButton size="sm" icon="arrow" label="move later" style={{ transform: 'rotate(90deg)' }} disabled={pos === upcoming.length - 1} onClick={() => move(1)} />
          </>
        )}
        <Button size="sm" tone="paper" onClick={onEdit}>
          edit
        </Button>
        {confirmDel ? (
          <Button size="sm" tone="pink" onClick={() => act.mutate(() => api.del(`/api/schedule/${a.id}`, ScheduleStateSchema))}>
            really delete
          </Button>
        ) : (
          <IconButton size="sm" icon="close" label="delete" onClick={() => setConfirmDel(true)} />
        )}
      </div>
    </li>
  );
}

export default function ScheduleConsole() {
  const q = useSchedule();
  const now = useServerNow(5000);
  const [edit, setEdit] = useState<Draft | null>(null);
  const list = q.data?.activities ?? [];
  const upcoming = list.filter((a) => a.status === 'upcoming');
  const lastEnd = list.at(-1)?.endAt ?? now;
  return (
    <div className={ui.stack}>
      <Section
        title="the afternoon"
        tape
        action={
          <Button tone="lime" icon="plus" onClick={() => setEdit(draftOf(null, lastEnd))}>
            new activity
          </Button>
        }
      >
        <p className={ui.hand}>start, end and delay move every phone and the projector within a second. delays push later activities along so nothing overlaps.</p>
        <ol className={s.runList}>
          {list.map((a) => (
            <RunItem key={a.id} a={a} list={list} upcoming={upcoming} onEdit={() => setEdit(draftOf(a, a.startAt))} />
          ))}
        </ol>
      </Section>
      <Sheet open={edit !== null} onClose={() => setEdit(null)} title={edit?.id === null ? 'new activity' : 'edit activity'}>
        {edit && <Editor draft={edit} onClose={() => setEdit(null)} />}
      </Sheet>
    </div>
  );
}
