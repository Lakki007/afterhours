/*
  Projector: the top 10 race. During the reveal it flips rows from 10 down to 1
  on 'leaderboard.reveal', with a drum roll before #1, then a crown and confetti.
  The closing moment of the event.
*/
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef } from 'react';
import { useServerNow } from '../../core/clock';
import { confetti, sfx } from '../../fun';
import { Avatar, Doodle, NumberTicker } from '../../kit';
import s from './leaderboard.module.css';
import { useBoard } from './useBoard';

export default function LeaderboardScene() {
  const q = useBoard(10);
  const reduce = useReducedMotion();
  const now = useServerNow(250);
  const b = q.data;
  const reveal = b?.freeze.reveal;
  const firstShown = Boolean(b?.rows.find((r) => r.rank === 1 && !r.hidden));
  const celebrated = useRef(false);
  useEffect(() => {
    if (reveal?.startedAt && firstShown && !celebrated.current) {
      celebrated.current = true;
      sfx.fanfare();
      if (!reduce) {
        confetti({ x: 0.3, y: 0.6, count: 140, spread: 80, power: 1.4 });
        confetti({ x: 0.7, y: 0.6, count: 140, spread: 80, power: 1.4 });
      }
    }
    if (!firstShown) celebrated.current = false;
  }, [reveal?.startedAt, firstShown, reduce]);
  if (!b) return null;
  const nextAt = reveal?.schedule?.[reveal.revealed] ?? null;
  const drumRoll = Boolean(reveal?.startedAt && !reveal.done && reveal.revealed === reveal.topN - 1 && nextAt && nextAt > now);
  return (
    <div className={s.scene}>
      <div>
        <h2 className={s.sceneTitle}>{reveal?.startedAt ? 'and the top 10 is...' : b.freeze.frozen ? 'the board is frozen' : 'the board'}</h2>
        <p className={s.sceneHand}>{b.players} people playing. points from votes, check-ins, the hunt, morse and the arcade.</p>
        {drumRoll && (
          <motion.p className={s.drum} animate={reduce ? {} : { rotate: [-3, 3, -3], scale: [1, 1.06, 1] }} transition={{ repeat: Infinity, duration: 0.3 }}>
            drum roll...
          </motion.p>
        )}
      </div>
      <ol className={s.sceneList}>
        {b.rows.map((r) =>
          r.hidden ? (
            <motion.li key={`h${r.rank}`} layout className={`${s.sceneRow} ${s.sceneHidden}`}>
              <span>#{r.rank}</span>
              <span />
              <span>? ? ?</span>
              <span />
            </motion.li>
          ) : (
            <motion.li
              key={r.attendeeId}
              layout={!reduce}
              className={`${s.sceneRow} ${r.rank === 1 ? s.sceneFirst : ''} ${s.rel}`}
              initial={reduce ? { opacity: 0 } : { rotateX: 90 }}
              animate={{ rotateX: 0, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 260, damping: 22 }}
            >
              {r.rank === 1 && reveal?.startedAt && <Doodle name="crown" size={56} fill="var(--sun)" className={s.crown} />}
              <span>#{r.rank}</span>
              <Avatar config={r.avatar} size={44} />
              <span className={s.sceneNick}>{r.nickname}</span>
              <NumberTicker value={r.total} />
            </motion.li>
          ),
        )}
      </ol>
    </div>
  );
}
