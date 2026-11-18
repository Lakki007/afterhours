/* Projector: the poll takeover. Racing bars, the word cloud, the quiz countdown and its reveal with the series board. */
import { motion, useReducedMotion } from 'motion/react';
import { useServerNow } from '../../core/clock';
import { Avatar, NumberTicker } from '../../kit';
import s from './polls.module.css';
import { useScreenPoll } from './status';

const FILLS = ['var(--tangerine)', 'var(--sky)', 'var(--pink)', 'var(--lime)', 'var(--sun)', 'var(--grape)'];

export default function PollScene() {
  const q = useScreenPoll();
  const now = useServerNow(200);
  const reduce = useReducedMotion();
  const st = q.data;
  if (!st?.poll) return null;
  const { poll, results, board } = st;
  const opts = 'options' in poll ? poll.options : [];
  const voters = results?.total ?? 0;

  let body = null;
  if (poll.kind === 'quiz' && poll.status === 'live') {
    const starts = poll.startsAt ?? 0;
    const pre = now < starts;
    const left = pre ? starts - now : Math.max(0, (poll.deadlineAt ?? now) - now);
    body = (
      <div className={s.sceneBars}>
        <div className={s.sceneCount}>{pre ? `${Math.ceil(left / 1000)}...` : Math.ceil(left / 1000)}</div>
        <div className={s.sceneBars}>
          {opts.map((o, i) => (
            <div key={i} className={s.sceneLabel}>
              {String.fromCharCode(65 + i)}. {o.emoji} {o.label}
            </div>
          ))}
        </div>
      </div>
    );
  } else if (results && 'counts' in results) {
    const max = Math.max(1, ...results.counts);
    const sum = Math.max(1, results.counts.reduce((a, b) => a + b, 0));
    const correct = 'correct' in results ? results.correct : null;
    body = (
      <div className={`${s.sceneBars} ${opts.length > 4 ? s.compact : ''}`}>
        {opts.map((o, i) => (
          <div key={i} className={`${s.sceneBar} ${correct === i ? s.sceneCorrect : ''}`}>
            <span className={s.sceneLabel}>
              {o.emoji} {o.label}
            </span>
            <div className={s.sceneTrack}>
              <motion.div
                className={s.sceneFill}
                style={{ background: correct === null ? FILLS[i % FILLS.length] : correct === i ? 'var(--lime)' : 'var(--paper-2)' }}
                initial={false}
                animate={{ width: `${((results.counts[i] ?? 0) / max) * 100}%` }}
                transition={reduce ? { duration: 0.1 } : { type: 'spring', stiffness: 90, damping: 15 }}
              />
            </div>
            <span className={s.sceneNum}>{Math.round(((results.counts[i] ?? 0) / sum) * 100)}%</span>
          </div>
        ))}
      </div>
    );
  } else if (results?.kind === 'wordcloud') {
    const top = Math.max(1, ...results.words.map((w) => w.count));
    body = (
      <div className={s.sceneCloud}>
        {results.words.map((w, i) => (
          <motion.span
            key={w.word}
            layout
            className={s.sceneWord}
            style={{ fontSize: `calc(var(--u) * ${2 + (w.count / top) * 6})`, color: FILLS[i % FILLS.length], rotate: ((i * 37) % 11) - 5 }}
            initial={reduce ? { opacity: 0 } : { scale: 0, y: 60 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
          >
            {w.word}
          </motion.span>
        ))}
      </div>
    );
  } else if (results?.kind === 'rating') {
    body = <div className={s.avgBig}>{results.average === null ? '-' : results.average.toFixed(1)}</div>;
  } else if (results?.kind === 'quiz') {
    body = <div className={s.sceneCount}>{results.total} answered</div>;
  }

  return (
    <div className={s.scene}>
      <div className={s.sceneMeta}>
        <span>{poll.status === 'live' ? (poll.kind === 'quiz' ? 'quiz time' : 'vote on your phone') : poll.status === 'revealed' ? 'the answer' : 'voting closed'}</span>
        <span>
          <NumberTicker value={voters} /> {poll.kind === 'quiz' ? 'answered' : 'voted'}
        </span>
      </div>
      <h2 className={s.sceneQ}>{poll.question}</h2>
      {body}
      {board && board.length > 0 && (
        <ol className={s.board}>
          {board.slice(0, 8).map((b) => (
            <li key={b.attendeeId} className={s.boardRow}>
              <span>#{b.rank}</span>
              <Avatar config={b.avatar} size={44} />
              <span>{b.nickname}</span>
              <span>{b.points}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
