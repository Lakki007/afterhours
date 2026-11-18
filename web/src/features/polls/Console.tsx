/*
  Console: polls. A list of polls with one contextual button each (launch, then
  close, then reveal), an editor for every kind (quiz included), and the live
  picture of the selected poll: full counts, word list with hide chips, quiz board.
*/
import { OkSchema } from '@afterhours/shared';
import {
  AdminPollListSchema,
  AdminPollSchema,
  AdminResultsSchema,
  POLL_KINDS,
  type PollDefinitionInput,
  type PollKind,
  type PublicPoll,
} from '@afterhours/shared/features/polls';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../core/api';
import { useLiveEvent } from '../../core/live';
import { Button, IconButton, Meter, Sheet, TextField, useToast } from '../../kit';
import { Section, Stamp, Stat, ui } from '../common/ui';
import s from './polls.module.css';

const listKey = ['polls', 'admin'] as const;
const KIND_LABEL: Record<PollKind, string> = { single: 'single choice', multi: 'multi choice', this_or_that: 'this or that', rating: 'rating', wordcloud: 'word cloud', quiz: 'quiz' };

interface Opt {
  label: string;
  emoji: string;
}
interface Draft {
  id: number | null;
  kind: PollKind;
  question: string;
  options: Opt[];
  maxChoices: number;
  scaleMax: 5 | 7 | 10;
  scaleStyle: 'slider' | 'emoji';
  low: string;
  high: string;
  maxWords: number;
  correct: number;
  durationS: number;
  basePoints: number;
  speedBonusMax: number;
  series: string;
}

const blank = (): Draft => ({
  id: null,
  kind: 'single',
  question: '',
  options: [
    { label: '', emoji: '' },
    { label: '', emoji: '' },
  ],
  maxChoices: 2,
  scaleMax: 5,
  scaleStyle: 'slider',
  low: '',
  high: '',
  maxWords: 1,
  correct: 0,
  durationS: 20,
  basePoints: 20,
  speedBonusMax: 20,
  series: 'quiz',
});

function draftOf(p: PublicPoll): Draft {
  const d = blank();
  d.id = p.id;
  d.kind = p.kind;
  d.question = p.question;
  if ('options' in p) d.options = p.options.map((o) => ({ label: o.label, emoji: o.emoji ?? '' }));
  if (p.kind === 'multi') d.maxChoices = p.maxChoices;
  if (p.kind === 'rating') {
    d.scaleMax = p.scale.max;
    d.scaleStyle = p.scale.style;
    d.low = p.scale.lowLabel;
    d.high = p.scale.highLabel;
  }
  if (p.kind === 'wordcloud') d.maxWords = p.maxWords;
  if (p.kind === 'quiz') {
    d.correct = p.correct ?? 0;
    d.durationS = Math.round(p.durationMs / 1000);
    d.basePoints = p.basePoints;
    d.speedBonusMax = p.speedBonusMax;
    d.series = p.series;
  }
  return d;
}

function toDefinition(d: Draft): PollDefinitionInput {
  const options = d.options.filter((o) => o.label.trim()).map((o) => ({ label: o.label.trim(), ...(o.emoji.trim() ? { emoji: o.emoji.trim() } : {}) }));
  switch (d.kind) {
    case 'single':
      return { kind: 'single', question: d.question, options };
    case 'multi':
      return { kind: 'multi', question: d.question, options, maxChoices: Math.min(d.maxChoices, options.length) };
    case 'this_or_that':
      return { kind: 'this_or_that', question: d.question, options: [options[0] ?? { label: 'this' }, options[1] ?? { label: 'that' }] };
    case 'rating':
      return { kind: 'rating', question: d.question, scale: { min: 1, max: d.scaleMax, style: d.scaleStyle, lowLabel: d.low, highLabel: d.high } };
    case 'wordcloud':
      return { kind: 'wordcloud', question: d.question, maxWords: d.maxWords };
    case 'quiz':
      return { kind: 'quiz', question: d.question, options, correct: d.correct, durationMs: d.durationS * 1000, basePoints: d.basePoints, speedBonusMax: d.speedBonusMax, series: d.series };
  }
}

function Editor({ draft, onDone }: { draft: Draft; onDone: () => void }) {
  const [d, setD] = useState(draft);
  const qc = useQueryClient();
  const toast = useToast();
  const save = useMutation({
    mutationFn: () => (d.id === null ? api.post('/api/polls/admin', toDefinition(d), AdminPollSchema) : api.put(`/api/polls/admin/${d.id}`, toDefinition(d), AdminPollSchema)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: listKey });
      onDone();
    },
    onError: (e) => toast(e.message, { kind: 'bad' }),
  });
  const hasOptions = d.kind === 'single' || d.kind === 'multi' || d.kind === 'this_or_that' || d.kind === 'quiz';
  const setOpt = (i: number, o: Partial<Opt>) => setD({ ...d, options: d.options.map((x, j) => (j === i ? { ...x, ...o } : x)) });
  return (
    <div className={ui.stack}>
      <label className={ui.label}>
        kind
        <select className={ui.select} value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value as PollKind, options: e.target.value === 'this_or_that' ? d.options.slice(0, 2) : d.options })}>
          {POLL_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      <TextField label="question" value={d.question} maxLength={140} onChange={(e) => setD({ ...d, question: e.target.value })} />
      {hasOptions && (
        <>
          {d.options.map((o, i) => (
            <div key={i} className={s.optRow}>
              {d.kind === 'quiz' ? (
                <label className={ui.toggle} title="the right answer">
                  <input type="radio" name="correct" checked={d.correct === i} onChange={() => setD({ ...d, correct: i })} />
                </label>
              ) : (
                <span className={ui.num}>{i + 1}</span>
              )}
              <TextField label={`option ${i + 1}`} value={o.label} maxLength={60} onChange={(e) => setOpt(i, { label: e.target.value })} />
              <TextField label="emoji" value={o.emoji} maxLength={8} onChange={(e) => setOpt(i, { emoji: e.target.value })} />
              {d.kind !== 'this_or_that' && d.options.length > 2 ? (
                <IconButton icon="close" size="sm" label="remove option" onClick={() => setD({ ...d, options: d.options.filter((_, j) => j !== i), correct: Math.min(d.correct, d.options.length - 2) })} />
              ) : (
                <span />
              )}
            </div>
          ))}
          {d.kind !== 'this_or_that' && d.options.length < (d.kind === 'quiz' ? 6 : 8) && (
            <Button size="sm" tone="paper" icon="plus" onClick={() => setD({ ...d, options: [...d.options, { label: '', emoji: '' }] })}>
              add option
            </Button>
          )}
        </>
      )}
      {d.kind === 'multi' && <TextField label="max picks" type="number" min={1} max={8} value={d.maxChoices} onChange={(e) => setD({ ...d, maxChoices: Number(e.target.value) })} />}
      {d.kind === 'rating' && (
        <div className={ui.row}>
          <label className={ui.label}>
            scale
            <select className={ui.select} value={d.scaleMax} onChange={(e) => setD({ ...d, scaleMax: Number(e.target.value) as 5 | 7 | 10 })}>
              <option value={5}>1 to 5</option>
              <option value={7}>1 to 7</option>
              <option value={10}>1 to 10</option>
            </select>
          </label>
          <TextField label="low end says" value={d.low} maxLength={24} onChange={(e) => setD({ ...d, low: e.target.value })} />
          <TextField label="high end says" value={d.high} maxLength={24} onChange={(e) => setD({ ...d, high: e.target.value })} />
        </div>
      )}
      {d.kind === 'wordcloud' && <TextField label="words per person (1-3)" type="number" min={1} max={3} value={d.maxWords} onChange={(e) => setD({ ...d, maxWords: Number(e.target.value) })} />}
      {d.kind === 'quiz' && (
        <div className={ui.row}>
          <TextField label="seconds to answer" type="number" min={5} max={120} value={d.durationS} onChange={(e) => setD({ ...d, durationS: Number(e.target.value) })} />
          <TextField label="points" type="number" min={0} max={200} value={d.basePoints} onChange={(e) => setD({ ...d, basePoints: Number(e.target.value) })} />
          <TextField label="max speed bonus" type="number" min={0} max={200} value={d.speedBonusMax} onChange={(e) => setD({ ...d, speedBonusMax: Number(e.target.value) })} />
          <TextField label="series" value={d.series} maxLength={32} onChange={(e) => setD({ ...d, series: e.target.value })} />
        </div>
      )}
      <div className={ui.row}>
        <Button tone="lime" icon="check" loading={save.isPending} disabled={d.question.trim().length < 3} onClick={() => save.mutate()}>
          save draft
        </Button>
        <Button tone="paper" ghost onClick={onDone}>
          cancel
        </Button>
      </div>
    </div>
  );
}

function Detail({ id }: { id: number }) {
  const toast = useToast();
  const res = useQuery({ queryKey: ['polls', 'admin', id], queryFn: () => api.get(`/api/polls/admin/${id}/results`, AdminResultsSchema), refetchInterval: 4000 });
  useLiveEvent('polls.results', (d) => d.pollId === id && void res.refetch());
  const word = useMutation({
    mutationFn: ({ w, hide }: { w: string; hide: boolean }) => api.post(`/api/polls/admin/${id}/words/${hide ? 'hide' : 'unhide'}`, { word: w }, OkSchema),
    onSuccess: () => void res.refetch(),
    onError: (e) => toast(e.message, { kind: 'bad' }),
  });
  const r = res.data;
  if (!r) return null;
  const p = r.poll;
  const counts = r.counts ?? [];
  const max = Math.max(1, ...counts);
  return (
    <div className={ui.stack}>
      <div className={ui.statGrid}>
        <Stat label={p.kind === 'quiz' ? 'answered' : 'voted'} value={r.voters} />
        {r.results.kind === 'rating' && <Stat label="average" value={r.results.average?.toFixed(1) ?? '-'} />}
      </div>
      {'options' in p &&
        p.options.map((o, i) => (
          <div key={i} className={ui.stack}>
            <div className={ui.between}>
              <span>
                {o.emoji} {o.label} {p.kind === 'quiz' && p.correct === i && <Stamp tone="live">right</Stamp>}
              </span>
              <span className={ui.num}>{counts[i] ?? 0}</span>
            </div>
            <Meter value={(counts[i] ?? 0) / max} tone={p.kind === 'quiz' && p.correct === i ? 'lime' : 'sky'} label={o.label} />
          </div>
        ))}
      {r.words && (
        <>
          <p className={ui.hand}>tap a word to hide it from phones and the projector (tap again to bring it back).</p>
          <div className={s.wordChips}>
            {r.words.map((w) => (
              <button key={w.word} type="button" className={`${s.wordChip} ${w.hidden ? s.wordHidden : ''}`} onClick={() => word.mutate({ w: w.word, hide: !w.hidden })}>
                {w.word} <span className={ui.num}>{w.count}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {r.board && r.board.length > 0 && (
        <>
          <h3 className={ui.kicker}>quiz board ({p.kind === 'quiz' ? p.series : ''})</h3>
          <ol>
            {r.board.slice(0, 10).map((b) => (
              <li key={b.attendeeId}>
                {b.nickname}: {b.points} pts, {b.correct} right
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

export default function PollsConsole() {
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: listKey, queryFn: () => api.get('/api/polls/admin', AdminPollListSchema), refetchInterval: 5000 });
  const refresh = () => void qc.invalidateQueries({ queryKey: listKey });
  useLiveEvent('polls.changed', refresh);
  useLiveEvent('polls.closed', refresh);
  useLiveEvent('polls.launched', refresh);
  const [sel, setSel] = useState<number | null>(null);
  const [edit, setEdit] = useState<Draft | null>(null);
  const act = useMutation({
    mutationFn: ({ id, what, body }: { id: number; what: 'launch' | 'close' | 'reveal' | 'reset'; body?: object }) => api.post(`/api/polls/admin/${id}/${what}`, body ?? {}, AdminPollSchema),
    onSuccess: refresh,
    onError: (e) => toast(e.message, { kind: 'bad', title: 'nope' }),
  });
  const del = useMutation({
    mutationFn: (id: number) => api.del(`/api/polls/admin/${id}`, OkSchema),
    onSuccess: () => {
      setSel(null);
      refresh();
    },
    onError: (e) => toast(e.message, { kind: 'bad' }),
  });
  const polls = list.data?.polls ?? [];
  const live = polls.find((p) => p.poll.status === 'live');
  const selected = polls.find((p) => p.poll.id === sel) ?? live ?? polls[0];

  const button = (p: PublicPoll) => {
    if (p.status === 'draft')
      return (
        <Button size="sm" tone="lime" icon="play" onClick={(e) => (e.stopPropagation(), act.mutate({ id: p.id, what: 'launch', body: { closeCurrent: Boolean(live) } }))}>
          launch
        </Button>
      );
    if (p.status === 'live')
      return (
        <Button size="sm" tone="pink" icon="lock" onClick={(e) => (e.stopPropagation(), act.mutate({ id: p.id, what: 'close' }))}>
          close
        </Button>
      );
    if (p.status === 'closed')
      return (
        <Button size="sm" tone="sun" icon="eye" onClick={(e) => (e.stopPropagation(), act.mutate({ id: p.id, what: 'reveal' }))}>
          reveal
        </Button>
      );
    return <Stamp tone="done">revealed</Stamp>;
  };

  return (
    <div className={s.cols}>
      <Section
        title="all polls"
        tape
        action={
          <Button size="sm" tone="lime" icon="plus" onClick={() => setEdit(blank())}>
            new
          </Button>
        }
      >
        <p className={ui.hand}>one live at a time. launching another closes the live one first.</p>
        <ul className={s.list}>
          {polls.map(({ poll: p, voters }) => (
            <li
              key={p.id}
              className={`${s.item} ${p.status === 'live' ? s.itemLive : selected?.poll.id === p.id ? s.itemOn : ''}`}
              onClick={() => setSel(p.id)}
              data-testid={`poll-${p.id}`}
            >
              <span className={s.itemQ}>
                <Stamp tone={p.kind === 'quiz' ? 'ink' : 'sky'} rot={-2}>
                  {KIND_LABEL[p.kind]}
                </Stamp>{' '}
                {p.question} <span className={ui.hand}>({voters})</span>
              </span>
              {button(p)}
            </li>
          ))}
        </ul>
      </Section>
      {selected && (
        <Section title={selected.poll.question} tilt={0.3}>
          <div className={ui.row}>
            {button(selected.poll)}
            {selected.poll.status === 'draft' && (
              <Button size="sm" tone="paper" onClick={() => setEdit(draftOf(selected.poll))}>
                edit
              </Button>
            )}
            {selected.poll.status === 'closed' && (
              <Button size="sm" tone="paper" icon="undo" onClick={() => act.mutate({ id: selected.poll.id, what: 'reset' })}>
                back to draft
              </Button>
            )}
            {selected.poll.status !== 'live' && (
              <Button size="sm" tone="paper" icon="close" onClick={() => window.confirm('delete this poll?') && del.mutate(selected.poll.id)}>
                delete
              </Button>
            )}
          </div>
          <Detail key={selected.poll.id} id={selected.poll.id} />
        </Section>
      )}
      <Sheet open={edit !== null} onClose={() => setEdit(null)} title={edit?.id === null ? 'new poll' : 'edit poll'}>
        {edit && <Editor draft={edit} onDone={() => setEdit(null)} />}
      </Sheet>
    </div>
  );
}
