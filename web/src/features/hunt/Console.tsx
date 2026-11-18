/*
  Console: the hunt. Open/close, stop editor (structure-lock banner once anyone
  started), printable QR sticker sheet, progress table, crowd bars and a
  typed-confirm reset.
*/
import { GlyphSchema, PaletteColorSchema } from '@afterhours/shared';
import {
  HUNT_CONFIRM_RESET,
  type HuntAdmin,
  HuntAdminProgressSchema,
  HuntAdminSchema,
  type HuntAdminStop,
  HuntStickerSheetSchema,
  type HuntStopInput,
} from '@afterhours/shared/features/hunt';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../core/api';
import { useLiveEvent } from '../../core/live';
import { fmtElapsed } from '../../core/time';
import { Button, IconButton, Meter, Qr, RecurseLogo, Sheet, TextArea, TextField, useToast } from '../../kit';
import { Section, Stamp, Stat, ui } from '../common/ui';
import s from './hunt.module.css';

const adminKey = ['hunt', 'admin'] as const;

interface Draft {
  id: number | null;
  title: string;
  clue: string;
  answers: string;
  hint1: string;
  hint2: string;
  points: number;
  glyph: HuntStopInput['glyph'];
  color: HuntStopInput['color'];
  reveal: string;
  location: string;
}
const blank: Draft = { id: null, title: '', clue: '', answers: '', hint1: '', hint2: '', points: 10, glyph: 'star', color: 'tangerine', reveal: '', location: '' };
const draftOf = (st: HuntAdminStop): Draft => ({
  id: st.id,
  title: st.title,
  clue: st.clue,
  answers: st.answers.join(', '),
  hint1: st.hints[0] ?? '',
  hint2: st.hints[1] ?? '',
  points: st.points,
  glyph: st.glyph,
  color: st.color,
  reveal: st.reveal,
  location: st.location,
});

function useAdminAct() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (f: () => Promise<HuntAdmin>) => f(),
    onSuccess: (d) => qc.setQueryData(adminKey, d),
    onError: (e) => toast(e.message, { kind: 'bad', title: 'nope' }),
  });
}

function StopEditor({ draft, onDone }: { draft: Draft; onDone: () => void }) {
  const [d, setD] = useState(draft);
  const act = useAdminAct();
  const body: HuntStopInput = {
    title: d.title,
    clue: d.clue,
    answers: d.answers
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean),
    hints: [d.hint1, d.hint2].map((h) => h.trim()).filter(Boolean),
    points: d.points,
    glyph: d.glyph,
    color: d.color,
    reveal: d.reveal,
    location: d.location,
    clueImage: null,
  };
  return (
    <div className={ui.stack}>
      <TextField label="title (attendees see it after solving)" value={d.title} maxLength={60} onChange={(e) => setD({ ...d, title: e.target.value })} />
      <TextArea label="clue" value={d.clue} maxLength={400} onChange={(e) => setD({ ...d, clue: e.target.value })} />
      <TextField label="typed answers, comma separated (empty = sticker only)" value={d.answers} onChange={(e) => setD({ ...d, answers: e.target.value })} />
      <TextField label="hint 1" value={d.hint1} maxLength={200} onChange={(e) => setD({ ...d, hint1: e.target.value })} />
      <TextField label="hint 2" value={d.hint2} maxLength={200} onChange={(e) => setD({ ...d, hint2: e.target.value })} />
      <TextField label="reveal after solving" value={d.reveal} maxLength={240} onChange={(e) => setD({ ...d, reveal: e.target.value })} />
      <TextField label="where the sticker goes (organisers only)" value={d.location} maxLength={120} onChange={(e) => setD({ ...d, location: e.target.value })} />
      <div className={ui.row}>
        <TextField label="points" type="number" min={1} max={50} value={d.points} onChange={(e) => setD({ ...d, points: Number(e.target.value) })} />
        <label className={ui.label}>
          stamp
          <select className={ui.select} value={d.glyph} onChange={(e) => setD({ ...d, glyph: e.target.value as Draft['glyph'] })}>
            {GlyphSchema.options.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
        </label>
        <label className={ui.label}>
          colour
          <select className={ui.select} value={d.color} onChange={(e) => setD({ ...d, color: e.target.value as Draft['color'] })}>
            {PaletteColorSchema.options.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>
      <div className={ui.row}>
        <Button
          tone="lime"
          icon="check"
          loading={act.isPending}
          disabled={!d.title.trim() || !d.clue.trim()}
          onClick={() => act.mutate(() => (d.id === null ? api.post('/api/hunt/admin/stops', body, HuntAdminSchema) : api.put(`/api/hunt/admin/stops/${d.id}`, body, HuntAdminSchema)), { onSuccess: onDone })}
        >
          save stop
        </Button>
        <Button tone="paper" ghost onClick={onDone}>
          cancel
        </Button>
      </div>
    </div>
  );
}

function StickerSheet({ onClose }: { onClose: () => void }) {
  const q = useQuery({ queryKey: ['hunt', 'stickers'], queryFn: () => api.get('/api/hunt/admin/stickers', HuntStickerSheetSchema) });
  return (
    <div className={ui.stack}>
      <div className={`${ui.row} ${s.noPrint}`}>
        <Button tone="lime" icon="print" onClick={() => window.print()}>
          print
        </Button>
        <Button tone="paper" ghost onClick={onClose}>
          back
        </Button>
        <span className={ui.hand}>cut along the dashes. each QR opens the app on that stop; the code under it is the typed fallback.</span>
      </div>
      <div className={s.sheet}>
        {q.data?.stops.map((st) => (
          <div key={st.stopId} className={s.sticker}>
            <RecurseLogo height={18} />
            <Qr text={st.url} size={180} label={`QR for ${st.title}`} />
            <span className={s.stickerCode}>{st.code}</span>
            <span className={s.stickerTitle}>
              #{st.position} {st.title}
            </span>
            {st.location && <span className={s.stickerLoc}>{st.location}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function HuntConsole() {
  const qc = useQueryClient();
  const admin = useQuery({ queryKey: adminKey, queryFn: () => api.get('/api/hunt/admin', HuntAdminSchema), refetchInterval: 8000 });
  const progress = useQuery({ queryKey: ['hunt', 'progress'], queryFn: () => api.get('/api/hunt/admin/progress', HuntAdminProgressSchema), refetchInterval: 5000 });
  useLiveEvent('hunt.stamp', () => void progress.refetch());
  useLiveEvent('hunt.finished', () => void progress.refetch());
  useLiveEvent('hunt.state', () => void qc.invalidateQueries({ queryKey: adminKey }));
  const act = useAdminAct();
  const [edit, setEdit] = useState<Draft | null>(null);
  const [sheet, setSheet] = useState(false);
  const [confirm, setConfirm] = useState('');
  const a = admin.data;
  if (sheet) return <StickerSheet onClose={() => setSheet(false)} />;
  if (!a) return null;
  const ids = a.stops.map((x) => x.id);
  const move = (i: number, dir: -1 | 1) => {
    const next = [...ids];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j] as number, next[i] as number];
    act.mutate(() => api.put('/api/hunt/admin/order', { ids: next }, HuntAdminSchema));
  };
  const crowdMax = Math.max(1, ...(progress.data?.crowd.map((c) => c.count) ?? [1]));
  return (
    <div className={ui.stack}>
      <Section title={a.title} tape action={<Stamp tone={a.status === 'open' ? 'live' : a.status === 'closed' ? 'done' : 'info'}>{a.status}</Stamp>}>
        <div className={ui.statGrid}>
          <Stat label="stops" value={a.stops.length} />
          <Stat label="started" value={a.players} />
          <Stat label="finished" value={a.finished} />
        </div>
        <div className={ui.row}>
          {a.status !== 'open' ? (
            <Button tone="lime" icon="play" onClick={() => act.mutate(() => api.put('/api/hunt/admin/state', { status: 'open' }, HuntAdminSchema))}>
              open the hunt
            </Button>
          ) : (
            <Button tone="pink" icon="lock" onClick={() => act.mutate(() => api.put('/api/hunt/admin/state', { status: 'closed' }, HuntAdminSchema))}>
              close the hunt
            </Button>
          )}
          <Button tone="sky" icon="print" onClick={() => setSheet(true)}>
            sticker sheet
          </Button>
        </div>
      </Section>

      <Section
        title="stops"
        tilt={0.3}
        action={
          <Button size="sm" tone="lime" icon="plus" disabled={a.structureLocked} onClick={() => setEdit(blank)}>
            add stop
          </Button>
        }
      >
        {a.structureLocked && <p className={s.banner}>people have started, so adding, deleting and reordering stops is locked. text edits are fine. reset the hunt to restructure.</p>}
        <ol className={s.stops}>
          {a.stops.map((st, i) => (
            <li key={st.id} className={s.stop}>
              <span className={s.pos}>{st.position}</span>
              <span>
                <b>{st.title}</b> {st.isFinal && <Stamp tone="late">finale</Stamp>}
                <br />
                <span className={ui.hand}>
                  {st.code}, {st.location || 'no location note'}, found by {st.solvedBy}, {st.hereNow} on it now
                </span>
              </span>
              <span className={ui.row}>
                {!a.structureLocked && (
                  <>
                    <IconButton size="sm" icon="arrow" label="move up" style={{ transform: 'rotate(-90deg)' }} disabled={i === 0} onClick={() => move(i, -1)} />
                    <IconButton size="sm" icon="arrow" label="move down" style={{ transform: 'rotate(90deg)' }} disabled={i === ids.length - 1} onClick={() => move(i, 1)} />
                  </>
                )}
                <Button size="sm" tone="paper" onClick={() => setEdit(draftOf(st))}>
                  edit
                </Button>
                <IconButton size="sm" icon="undo" label="new QR token (old sticker stops working)" onClick={() => window.confirm('new QR for this stop? the old sticker stops working.') && act.mutate(() => api.post(`/api/hunt/admin/stops/${st.id}/rotate-token`, {}, HuntAdminSchema))} />
                {!a.structureLocked && <IconButton size="sm" icon="close" label="delete stop" onClick={() => window.confirm(`delete "${st.title}"?`) && act.mutate(() => api.del(`/api/hunt/admin/stops/${st.id}`, HuntAdminSchema))} />}
              </span>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="where the crowd is" tilt={-0.2}>
        {progress.data?.crowd.map((c) => (
          <div key={c.stopId} className={ui.stack}>
            <div className={ui.between}>
              <span>{c.title}</span>
              <span className={ui.num}>{c.count}</span>
            </div>
            <Meter value={c.count / crowdMax} tone="tangerine" label={c.title} />
          </div>
        ))}
        <table className={ui.table}>
          <thead>
            <tr>
              <th>who</th>
              <th>stamps</th>
              <th>on</th>
              <th>hints</th>
              <th>finish</th>
            </tr>
          </thead>
          <tbody>
            {progress.data?.rows.map((r) => (
              <tr key={r.attendeeId}>
                <td>
                  <b>{r.nickname}</b> <span className={ui.hand}>{r.name}</span>
                </td>
                <td className={ui.num}>{r.solved}</td>
                <td>{r.currentStopTitle ?? '-'}</td>
                <td>{r.hintsUsed}</td>
                <td>{r.rank ? `#${r.rank} in ${fmtElapsed(r.elapsedMs ?? 0)}` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="danger zone" tilt={0.2}>
        <p className={ui.hand}>wipes every hunt start, stamp, hint and finish, and takes back the hunt points. stops stay.</p>
        <div className={ui.row}>
          <TextField label={`type ${HUNT_CONFIRM_RESET}`} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          <Button
            tone="pink"
            icon="close"
            disabled={confirm !== HUNT_CONFIRM_RESET}
            onClick={() => act.mutate(() => api.post('/api/hunt/admin/reset', { confirm: HUNT_CONFIRM_RESET }, HuntAdminSchema), { onSuccess: () => setConfirm('') })}
          >
            reset the hunt
          </Button>
        </div>
      </Section>

      <Sheet open={edit !== null} onClose={() => setEdit(null)} title={edit?.id === null ? 'new stop' : 'edit stop'}>
        {edit && <StopEditor draft={edit} onDone={() => setEdit(null)} />}
      </Sheet>
    </div>
  );
}
