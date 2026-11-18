/*
  One poll, any kind: the voting UI while it is live and you have not voted,
  then racing results. Quiz is a little game show: 3-2-1, a draining timer to
  deadlineAt, a stamped locked answer, and the reveal flips cards green/pink.
*/
import { type PollResults, type PollView, type PublicPoll, type PublicPollOf, type VoteRequest, VoteResponseSchema, POLL_LIMITS } from '@afterhours/shared/features/polls';
import { useMutation } from '@tanstack/react-query';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';
import { api, isApiError } from '../../core/api';
import { useServerNow } from '../../core/clock';
import { confetti, haptics, sfx } from '../../fun';
import { Button, Meter, NumberTicker, type Tone, useToast } from '../../kit';
import { Stamp, ui } from '../common/ui';
import s from './polls.module.css';
import { usePatchCurrent } from './usePolls';

const TONES: Tone[] = ['tangerine', 'sky', 'pink', 'lime', 'sun', 'grape'];
const FACES = ['😖', '😕', '😐', '🙂', '😍'];

function useVote(poll: PublicPoll, onRejected?: (msg: string) => void) {
  const patch = usePatchCurrent();
  const toast = useToast();
  const reduce = useReducedMotion();
  return useMutation({
    mutationFn: (body: VoteRequest) => api.post(`/api/polls/${poll.id}/vote`, body, VoteResponseSchema).then((r) => ({ r, body })),
    onSuccess: ({ r, body }) => {
      patch((v) => (v.poll.id === poll.id ? { ...v, myVote: body, results: r.results, voters: r.voters } : v));
      sfx.success();
      haptics.success();
      if (!reduce && poll.kind !== 'quiz') confetti({ count: 30, y: 0.4 });
    },
    onError: (e) => {
      if (isApiError(e, 'word_rejected') && onRejected) onRejected(e.message);
      else toast(e.message, { kind: 'bad', title: 'vote bounced' });
      haptics.fail();
    },
  });
}

// ---- voting ---------------------------------------------------------------------------

function ChoiceVote({ poll }: { poll: PublicPollOf<'single'> | PublicPollOf<'quiz'> }) {
  const vote = useVote(poll);
  return (
    <div className={s.options}>
      {poll.options.map((o, i) => (
        <motion.button
          key={i}
          type="button"
          className={`${s.option} ${s[`tone-${TONES[i % TONES.length]}`]}`}
          style={{ rotate: i % 2 ? 1 : -1 }}
          whileTap={{ scale: 0.92, rotate: 0 }}
          disabled={vote.isPending}
          onClick={() => vote.mutate(poll.kind === 'quiz' ? { kind: 'quiz', choice: i } : { kind: 'single', choice: i })}
        >
          {o.emoji && <span className={s.optEmoji}>{o.emoji}</span>}
          <span>{o.label}</span>
        </motion.button>
      ))}
    </div>
  );
}

function MultiVote({ poll }: { poll: PublicPollOf<'multi'> }) {
  const vote = useVote(poll);
  const [picked, setPicked] = useState<number[]>([]);
  const toggle = (i: number) => {
    sfx.tick();
    setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : p.length >= poll.maxChoices ? p : [...p, i]));
  };
  return (
    <div className={ui.stack}>
      <p className={ui.hand}>pick up to {poll.maxChoices}</p>
      <div className={s.options}>
        {poll.options.map((o, i) => (
          <motion.button
            key={i}
            type="button"
            aria-pressed={picked.includes(i)}
            className={`${s.option} ${picked.includes(i) ? s[`tone-${TONES[i % TONES.length]}`] : s.optionOff}`}
            whileTap={{ scale: 0.92 }}
            onClick={() => toggle(i)}
          >
            {o.emoji && <span className={s.optEmoji}>{o.emoji}</span>}
            <span>{o.label}</span>
          </motion.button>
        ))}
      </div>
      <Button tone="ink" block icon="check" disabled={picked.length === 0} loading={vote.isPending} onClick={() => vote.mutate({ kind: 'multi', choices: picked })}>
        lock them in
      </Button>
    </div>
  );
}

function ThisOrThatVote({ poll }: { poll: PublicPollOf<'this_or_that'> }) {
  const vote = useVote(poll);
  const [chosen, setChosen] = useState<0 | 1 | null>(null);
  return (
    <div className={s.tot}>
      {([0, 1] as const).map((i) => (
        <motion.button
          key={i}
          type="button"
          className={`${s.half} ${i === 0 ? s['tone-pink'] : s['tone-sky']}`}
          animate={chosen === null ? { scale: 1, x: 0, opacity: 1 } : chosen === i ? { scale: 1.06 } : { x: i === 0 ? -200 : 200, opacity: 0 }}
          whileTap={{ scale: 0.95 }}
          disabled={vote.isPending || chosen !== null}
          onClick={() => {
            setChosen(i);
            vote.mutate({ kind: 'this_or_that', choice: i }, { onError: () => setChosen(null) });
          }}
        >
          {poll.options[i].emoji && <span className={s.halfEmoji}>{poll.options[i].emoji}</span>}
          <span className={s.halfLabel}>{poll.options[i].label}</span>
        </motion.button>
      ))}
      <span className={s.or} aria-hidden="true">
        or
      </span>
    </div>
  );
}

function RatingVote({ poll }: { poll: PublicPollOf<'rating'> }) {
  const vote = useVote(poll);
  const { min, max, lowLabel, highLabel } = poll.scale;
  const [v, setV] = useState(Math.ceil((min + max) / 2));
  const face = FACES[Math.round(((v - min) / (max - min)) * (FACES.length - 1))] ?? '🙂';
  return (
    <div className={ui.stack}>
      <motion.div key={face} className={s.face} initial={{ scale: 0.6, rotate: -10 }} animate={{ scale: 1, rotate: 0 }} aria-hidden="true">
        {face}
      </motion.div>
      <div className={s.rateNum}>{v}</div>
      <input
        type="range"
        className={s.slider}
        min={min}
        max={max}
        step={1}
        value={v}
        aria-label="your rating"
        onChange={(e) => {
          setV(Number(e.target.value));
          sfx.tick();
          haptics.tick();
        }}
      />
      <div className={ui.between}>
        <span className={ui.hand}>{lowLabel || min}</span>
        <span className={ui.hand}>{highLabel || max}</span>
      </div>
      <Button tone="ink" block icon="check" loading={vote.isPending} onClick={() => vote.mutate({ kind: 'rating', value: v })}>
        that's my number
      </Button>
    </div>
  );
}

function WordVote({ poll }: { poll: PublicPollOf<'wordcloud'> }) {
  const [rejected, setRejected] = useState<string | null>(null);
  const vote = useVote(poll, setRejected);
  const [words, setWords] = useState<string[]>(Array.from({ length: poll.maxWords }, () => ''));
  const max = poll.maxLen || POLL_LIMITS.wordMaxLen;
  const filled = words.map((w) => w.trim()).filter(Boolean);
  return (
    <div className={ui.stack}>
      {words.map((w, i) => (
        <div key={i} className={s.wordRow}>
          <input
            className={s.wordInput}
            value={w}
            maxLength={max}
            placeholder={i === 0 ? 'one word...' : 'and another?'}
            aria-label={`word ${i + 1}`}
            onChange={(e) => {
              setRejected(null);
              setWords((l) => l.map((x, j) => (j === i ? e.target.value : x)));
            }}
          />
          <span className={`${s.charMeter} ${w.length >= max ? s.charFull : ''}`}>{max - w.length}</span>
        </div>
      ))}
      <AnimatePresence>
        {rejected && (
          <motion.p className={s.bubble} initial={{ scale: 0.5, rotate: -6, opacity: 0 }} animate={{ scale: 1, rotate: -2, opacity: 1 }} exit={{ opacity: 0 }}>
            {rejected}
          </motion.p>
        )}
      </AnimatePresence>
      <Button tone="ink" block icon="spark" disabled={filled.length === 0} loading={vote.isPending} onClick={() => vote.mutate({ kind: 'wordcloud', words: filled })}>
        throw it in the cloud
      </Button>
    </div>
  );
}

function QuizVote({ poll }: { poll: PublicPollOf<'quiz'> }) {
  const now = useServerNow(100);
  const starts = poll.startsAt ?? 0;
  if (now < starts) {
    const n = Math.ceil((starts - now) / 1000);
    return (
      <AnimatePresence mode="popLayout">
        <motion.div key={n} className={s.three} initial={{ scale: 2.4, opacity: 0, rotate: -12 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} exit={{ scale: 0.4, opacity: 0 }}>
          {n}
        </motion.div>
      </AnimatePresence>
    );
  }
  return (
    <div className={ui.stack}>
      <QuizTimer poll={poll} now={now} />
      <ChoiceVote poll={poll} />
    </div>
  );
}

function QuizTimer({ poll, now }: { poll: PublicPollOf<'quiz'>; now: number }) {
  const end = poll.deadlineAt ?? now;
  const left = Math.max(0, end - now);
  return (
    <div className={s.timer}>
      <Meter value={left / poll.durationMs} tone={left < 5000 ? 'pink' : 'lime'} label="time left" />
      <span className={s.timerNum}>{Math.ceil(left / 1000)}</span>
    </div>
  );
}

// ---- results ----------------------------------------------------------------------------

function optionsOf(p: PublicPoll) {
  return 'options' in p ? p.options : [];
}

function Bars({ poll, results, mine }: { poll: PublicPoll; results: Extract<PollResults, { counts: number[] }>; mine: number[] }) {
  const opts = optionsOf(poll);
  const total = Math.max(1, Math.max(...results.counts, 1));
  const sum = Math.max(1, results.counts.reduce((a, b) => a + b, 0));
  const correct = 'correct' in results && typeof results.correct === 'number' ? results.correct : null;
  return (
    <ul className={s.bars}>
      {opts.map((o, i) => {
        const n = results.counts[i] ?? 0;
        const isMine = mine.includes(i);
        const tone: Tone = correct !== null ? (i === correct ? 'lime' : isMine ? 'pink' : 'paper') : TONES[i % TONES.length] ?? 'sun';
        return (
          <motion.li key={i} className={`${s.bar} ${isMine ? s.barMine : ''}`} initial={correct !== null ? { rotateX: 90 } : false} animate={{ rotateX: 0 }} transition={{ delay: i * 0.08 }}>
            <div className={ui.between}>
              <span className={s.barLabel}>
                {o.emoji} {o.label} {isMine && <Stamp tone="ink" rot={-4}>you</Stamp>} {correct === i && <Stamp tone="live" rot={3}>right</Stamp>}
              </span>
              <span className={s.barNum}>{Math.round((n / sum) * 100)}%</span>
            </div>
            <Meter value={n / total} tone={tone} label={o.label} />
          </motion.li>
        );
      })}
    </ul>
  );
}

function Results({ view }: { view: PollView }) {
  const { poll, results, myVote, myQuiz } = view;
  if (!results) return null;
  if (results.kind === 'rating') {
    const top = Math.max(1, ...results.histogram);
    return (
      <div className={ui.stack}>
        <p className={s.avg}>
          average <b>{results.average === null ? '-' : results.average.toFixed(1)}</b>
          {myVote?.kind === 'rating' && <span className={ui.hand}> (you said {myVote.value})</span>}
        </p>
        <div className={s.histo}>
          {results.histogram.map((n, i) => (
            <div key={i} className={s.histoCol}>
              <motion.div className={s.histoBar} initial={false} animate={{ height: `${(n / top) * 100}%` }} />
              <span className={s.histoLabel}>{results.min + i}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (results.kind === 'wordcloud') {
    const top = Math.max(1, ...results.words.map((w) => w.count));
    const mine = myVote?.kind === 'wordcloud' ? myVote.words : [];
    return (
      <div className={s.cloud}>
        {results.words.map((w, i) => (
          <motion.span
            key={w.word}
            layout
            className={`${s.cloudWord} ${mine.includes(w.word) ? s.cloudMine : ''}`}
            style={{ fontSize: `${0.9 + (w.count / top) * 1.8}rem`, rotate: ((i * 37) % 9) - 4 }}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
          >
            {w.word}
          </motion.span>
        ))}
        {results.words.length === 0 && <p className={ui.hand}>the cloud is empty. be first.</p>}
      </div>
    );
  }
  if (results.kind === 'quiz' && !results.revealed) {
    return (
      <div className={s.locked}>
        <Stamp tone="ink" rot={-8}>
          locked in
        </Stamp>
        <p className={ui.hand}>
          {myVote?.kind === 'quiz' && 'options' in poll ? `you said "${poll.options[myVote.choice]?.label}". ` : ''}
          answer shows up at the reveal. eyes on the big screen.
        </p>
      </div>
    );
  }
  const mine = myVote ? (myVote.kind === 'multi' ? myVote.choices : 'choice' in myVote ? [myVote.choice] : []) : [];
  return (
    <div className={ui.stack}>
      {myQuiz && (
        <div className={`${s.quizResult} ${myQuiz.correct ? s.quizRight : s.quizWrong}`}>
          <span className={s.quizBig}>{myQuiz.correct ? `+${myQuiz.points}` : 'nope'}</span>
          <span className={ui.hand}>{myQuiz.correct ? `right in ${(myQuiz.elapsedMs / 1000).toFixed(1)} s, ${myQuiz.speedBonus} of that was speed` : 'next one is yours'}</span>
        </div>
      )}
      {'counts' in results && <Bars poll={poll} results={results} mine={mine} />}
    </div>
  );
}

// ---- the whole thing ------------------------------------------------------------------

export function PollBody({ view }: { view: PollView }) {
  const { poll } = view;
  const live = poll.status === 'live';
  const canVote = live && !view.myVote;
  return (
    <div className={s.body}>
      <div className={ui.between}>
        <Stamp tone={live ? 'live' : poll.status === 'revealed' ? 'sky' : 'done'}>{live ? (poll.kind === 'quiz' ? 'quiz' : 'live poll') : poll.status}</Stamp>
        <span className={s.voters}>
          <NumberTicker value={view.voters} /> {poll.kind === 'quiz' ? 'answered' : 'voted'}
        </span>
      </div>
      <h2 className={s.question}>{poll.question}</h2>
      {canVote ? (
        poll.kind === 'single' ? (
          <ChoiceVote poll={poll} />
        ) : poll.kind === 'multi' ? (
          <MultiVote poll={poll} />
        ) : poll.kind === 'this_or_that' ? (
          <ThisOrThatVote poll={poll} />
        ) : poll.kind === 'rating' ? (
          <RatingVote poll={poll} />
        ) : poll.kind === 'wordcloud' ? (
          <WordVote poll={poll} />
        ) : (
          <QuizVote poll={poll} />
        )
      ) : view.results ? (
        <Results view={view} />
      ) : (
        <p className={ui.hand}>{live ? 'thanks! results land in a sec.' : "you missed this one. results show up when it's revealed."}</p>
      )}
    </div>
  );
}
