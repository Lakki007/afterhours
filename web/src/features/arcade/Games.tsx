/*
  The three arcade games. Each gets a fresh run (token + spec) from the server,
  plays with pointer events at 60 fps, and hands back a RunResult.
  - Lag Spike: red to green flip, ms readout, false-start wobble.
  - Base Rush: bin/dec/hex keypad against the clock, streaks.
  - Echo: 3x3 pads with tones; the server reveals the pattern level by level.
*/
import {
  ARCADE_GAMES,
  type HexbinBase,
  type MemoryStepResponse,
  MemoryStepResponseSchema,
  REACTION_MAX_MS,
  type RunResult,
  RunResultSchema,
  type RunStart,
} from '@afterhours/shared/features/arcade';
import { motion, useAnimate, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../core/api';
import { serverNow } from '../../core/clock';
import { haptics, sfx } from '../../fun';
import { Button, Countdown, Meter, useToast } from '../../kit';
import { ui } from '../common/ui';
import s from './arcade.module.css';

type Done = (r: RunResult) => void;
type Spec<G extends RunStart['game']> = Extract<RunStart, { game: G }>;

function useSubmit(run: RunStart, onDone: Done) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return {
    busy,
    submit: (body: object) => {
      setBusy(true);
      api
        .post(`/api/arcade/runs/${run.runId}/submit`, body, RunResultSchema)
        .then(onDone)
        .catch((e: Error) => {
          setBusy(false);
          toast(e.message, { kind: 'bad', title: 'run bounced' });
        });
    },
  };
}

// ---- lag spike -----------------------------------------------------------------------

export function LagSpike({ run, onDone }: { run: Spec<'reaction'>; onDone: Done }) {
  const [round, setRound] = useState(0);
  const [phase, setPhase] = useState<'wait' | 'red' | 'green' | 'early' | 'shown'>('wait');
  const [last, setLast] = useState<number | null>(null);
  const times = useRef<number[]>([]);
  const greenAt = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const [scope, animate] = useAnimate<HTMLButtonElement>();
  const reduce = useReducedMotion();
  const { submit, busy } = useSubmit(run, onDone);

  const arm = (i: number) => {
    setPhase('red');
    timer.current = window.setTimeout(() => {
      greenAt.current = performance.now();
      setPhase('green');
      sfx.tick();
    }, run.spec.delaysMs[i] ?? 1500);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const next = (ms: number) => {
    times.current = [...times.current, ms];
    setLast(ms);
    setPhase('shown');
    if (times.current.length >= run.spec.rounds) {
      submit({ reactions: times.current });
      return;
    }
    window.setTimeout(() => {
      setRound((r) => r + 1);
      arm(times.current.length);
    }, 900);
  };

  const tap = () => {
    if (phase === 'wait') {
      arm(0);
      return;
    }
    if (phase === 'red') {
      window.clearTimeout(timer.current);
      setPhase('early');
      sfx.fail();
      haptics.fail();
      if (!reduce && scope.current) void animate(scope.current, { rotate: [0, -4, 4, -2, 0] }, { duration: 0.4 });
      window.setTimeout(() => next(REACTION_MAX_MS), 700);
      return;
    }
    if (phase === 'green') {
      const ms = Math.max(1, Math.round(performance.now() - greenAt.current));
      sfx.pop();
      haptics.tap();
      next(ms);
    }
  };

  return (
    <div className={ui.stack}>
      <p className={s.roundNo}>
        round {Math.min(round + 1, run.spec.rounds)}/{run.spec.rounds}
      </p>
      <button ref={scope} type="button" className={`${s.reactPad} ${s[`react-${phase}`]}`} onPointerDown={tap} disabled={busy}>
        {phase === 'wait' && 'tap to start'}
        {phase === 'red' && 'wait for green...'}
        {phase === 'green' && 'NOW!'}
        {phase === 'early' && 'too early!'}
        {phase === 'shown' && last !== null && (last >= REACTION_MAX_MS ? 'false start' : `${last} ms`)}
      </button>
      <div className={s.times}>
        {times.current.map((t, i) => (
          <span key={i} className={s.timeChip}>
            {t >= REACTION_MAX_MS ? 'x' : t}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---- base rush --------------------------------------------------------------------------

const KEYS: Record<HexbinBase, string[]> = {
  bin: ['0', '1'],
  dec: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  hex: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'A', 'B', 'C', 'D', 'E', 'F'],
};
const BASE_LABEL: Record<HexbinBase, string> = { bin: 'binary', dec: 'decimal', hex: 'hex' };

export function BaseRush({ run, onDone }: { run: Spec<'hexbin'>; onDone: Done }) {
  const qs = run.spec.questions;
  const [i, setI] = useState(0);
  const [typed, setTyped] = useState('');
  const answers = useRef<{ a: string; t: number }[]>([]);
  const [streak, setStreak] = useState(0);
  const { submit, busy } = useSubmit(run, onDone);
  const sent = useRef(false);
  const finish = () => {
    if (sent.current) return;
    sent.current = true;
    if (answers.current.length === 0) answers.current.push({ a: '', t: Math.max(0, serverNow() - run.startedAt) });
    submit({ answers: answers.current });
  };
  const q = qs[i];
  const enter = () => {
    if (!q || !typed) return;
    answers.current.push({ a: typed, t: Math.max(0, Math.round(serverNow() - run.startedAt)) });
    setTyped('');
    setStreak((n) => n + 1);
    sfx.tick();
    haptics.tick();
    if (i + 1 >= qs.length) finish();
    else setI(i + 1);
  };
  if (!q) return null;
  return (
    <div className={ui.stack}>
      <div className={ui.between}>
        <span className={s.roundNo}>#{i + 1}</span>
        <Countdown to={run.startedAt + run.durationMs} onDone={finish} className={s.clock} />
        <span className={s.streak}>{streak} answered</span>
      </div>
      <motion.div key={q.i} className={s.prompt} initial={{ rotateX: 90 }} animate={{ rotateX: 0 }} transition={{ duration: 0.18 }}>
        <span className={s.promptNum}>{q.prompt}</span>
        <span className={s.promptTo}>to {BASE_LABEL[q.to]}</span>
      </motion.div>
      <div className={s.typed}>{typed || ' '}</div>
      <div className={`${s.keypad} ${s[`keys-${q.to}`]}`}>
        {KEYS[q.to].map((k) => (
          <button key={k} type="button" className={s.keyBtn} onPointerDown={() => (setTyped((t) => (t.length < 12 ? t + k : t)), sfx.tap())} disabled={busy}>
            {k}
          </button>
        ))}
        <button type="button" className={`${s.keyBtn} ${s.keyDel}`} onPointerDown={() => setTyped((t) => t.slice(0, -1))}>
          del
        </button>
        <button type="button" className={`${s.keyBtn} ${s.keyGo}`} onPointerDown={enter} disabled={!typed || busy}>
          go
        </button>
      </div>
    </div>
  );
}

// ---- echo -----------------------------------------------------------------------------------

const PAD_NOTES = [262, 294, 330, 349, 392, 440, 494, 523, 587];

export function Echo({ run, onDone }: { run: Spec<'memory'>; onDone: Done }) {
  const toast = useToast();
  const [seq, setSeq] = useState(run.spec.sequence);
  const [level, setLevel] = useState(run.spec.level);
  const [lit, setLit] = useState<number | null>(null);
  const [showing, setShowing] = useState(true);
  const [taps, setTaps] = useState<number[]>([]);
  const busy = useRef(false);

  useEffect(() => {
    setShowing(true);
    let k = 0;
    const timers: number[] = [];
    const step = run.spec.showMs;
    seq.forEach((pad, j) => {
      timers.push(
        window.setTimeout(() => {
          setLit(pad);
          sfx.note(PAD_NOTES[pad] ?? 440, step * 0.7);
          haptics.tick();
        }, 600 + j * step),
      );
      timers.push(window.setTimeout(() => setLit(null), 600 + j * step + step * 0.7));
      k = j;
    });
    timers.push(window.setTimeout(() => setShowing(false), 600 + (k + 1) * step));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [seq, run.spec.showMs]);

  const press = (pad: number) => {
    if (showing || busy.current) return;
    sfx.note(PAD_NOTES[pad] ?? 440, 140);
    haptics.tap();
    setLit(pad);
    window.setTimeout(() => setLit((l) => (l === pad ? null : l)), 140);
    const next = [...taps, pad];
    setTaps(next);
    if (next.length < seq.length) return;
    busy.current = true;
    api
      .post(`/api/arcade/runs/${run.runId}/step`, { taps: next }, MemoryStepResponseSchema)
      .then((r: MemoryStepResponse) => {
        busy.current = false;
        setTaps([]);
        if (r.status === 'over') onDone(r.result);
        else {
          sfx.success();
          setLevel(r.level);
          setSeq(r.sequence);
        }
      })
      .catch((e: Error) => {
        busy.current = false;
        toast(e.message, { kind: 'bad' });
      });
  };
  return (
    <div className={ui.stack}>
      <div className={ui.between}>
        <span className={s.roundNo}>level {level}</span>
        <Countdown to={run.startedAt + run.durationMs} className={s.clock} />
        <span className={s.streak}>{showing ? 'watch...' : 'your turn'}</span>
      </div>
      <Meter value={taps.length / Math.max(1, seq.length)} tone="grape" label="taps" />
      <div className={s.pads}>
        {Array.from({ length: run.spec.pads }, (_, p) => (
          <button key={p} type="button" aria-label={`pad ${p + 1}`} className={`${s.pad} ${s[`pad-${p % 6}`]} ${lit === p ? s.padLit : ''}`} onPointerDown={() => press(p)} />
        ))}
      </div>
    </div>
  );
}

export function GameTitle({ game }: { game: RunStart['game'] }) {
  const g = ARCADE_GAMES[game];
  return (
    <div className={ui.stack}>
      <h2 className={s.gameTitle}>{g.title}</h2>
      <p className={ui.hand}>{g.howTo}</p>
    </div>
  );
}

export function StartButton({ onStart, loading }: { onStart: () => void; loading: boolean }) {
  return (
    <Button tone="lime" size="lg" icon="play" block onClick={onStart} loading={loading}>
      insert coin
    </Button>
  );
}
