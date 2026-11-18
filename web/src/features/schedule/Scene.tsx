/* Projector: giant now / next, readable from the back of the hall. */
import { motion, useReducedMotion } from 'motion/react';
import { useServerNow } from '../../core/clock';
import { fmtClock } from '../../core/time';
import { Countdown, Doodle } from '../../kit';
import s from './schedule.module.css';
import { nowAndNext, useSchedule } from './useSchedule';

export default function NowNextScene() {
  const q = useSchedule();
  const now = useServerNow(1000);
  const reduce = useReducedMotion();
  const { now: cur, next } = nowAndNext(q.data);
  const progress = cur ? Math.min(1, Math.max(0, (now - cur.startAt) / Math.max(1, cur.endAt - cur.startAt))) : 0;
  const over = cur ? now > cur.endAt : false;
  return (
    <div className={s.scene}>
      {cur ? (
        <motion.div key={cur.id} className={s.sceneNow} initial={reduce ? { opacity: 0 } : { scale: 1.3, rotate: 6, opacity: 0 }} animate={{ scale: 1, rotate: -2, opacity: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 18 }}>
          <span className={s.sceneKicker}>{over ? 'running a little over' : 'happening now'}</span>
          <h2 className={s.sceneTitle}>{cur.title}</h2>
          <span className={s.sceneWhere}>
            <Doodle name="pin" size={36} /> {cur.location || 'around'}, till {fmtClock(cur.endAt)}
          </span>
          <div className={s.sceneBar}>
            <motion.div className={s.sceneBarFill} initial={false} animate={{ width: `${progress * 100}%` }} transition={{ type: 'spring', stiffness: 60, damping: 16 }} />
          </div>
        </motion.div>
      ) : (
        <div className={s.sceneNow}>
          <span className={s.sceneKicker}>right now</span>
          <h2 className={s.sceneTitle}>{next ? 'warming up' : "that's a wrap"}</h2>
        </div>
      )}
      {next && (
        <div className={s.sceneNext}>
          <span className={s.sceneKicker}>up next</span>
          <h3 className={s.sceneNextTitle}>{next.title}</h3>
          <span className={s.sceneWhere}>
            {fmtClock(next.startAt)}, {next.location || 'around'}
          </span>
          {next.startAt > now ? <Countdown to={next.startAt} className={s.sceneCount} /> : <span className={s.sceneCount}>any sec</span>}
        </div>
      )}
    </div>
  );
}
