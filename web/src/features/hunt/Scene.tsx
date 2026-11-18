/* Projector: route map with crowd counts, a stamp ticker and the finisher podium. */
import type { HuntStampEvent } from '@afterhours/shared/features/hunt';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';
import { useLiveEvent } from '../../core/live';
import { fmtElapsed } from '../../core/time';
import { Avatar, NumberTicker } from '../../kit';
import s from './hunt.module.css';
import { useHuntBoard } from './useHunt';

export default function HuntScene() {
  const b = useHuntBoard();
  const reduce = useReducedMotion();
  const [ticks, setTicks] = useState<HuntStampEvent[]>([]);
  useLiveEvent('hunt.stamp', (d) => setTicks((l) => [d, ...l].slice(0, 6)));
  const board = b.data;
  if (!board) return null;
  const here = new Map(board.crowd.here.map((h) => [h.stopId, h.count]));
  const stopIds = [...here.keys()].sort((a, c) => a - c);
  return (
    <div className={s.scene}>
      <div>
        <h2 className={s.sceneTitle}>{board.title}</h2>
        <div className={s.stats}>
          <span>
            <NumberTicker value={board.crowd.hunting} />
            <small>hunting</small>
          </span>
          <span>
            <NumberTicker value={board.crowd.finished} />
            <small>finished</small>
          </span>
          <span>
            {board.total}
            <small>stops</small>
          </span>
        </div>
        <div className={s.map}>
          {stopIds.map((id, i) => (
            <div key={id} className={s.mapStop}>
              {i + 1}
              <span className={s.dots}>{here.get(id)} here</span>
            </div>
          ))}
        </div>
      </div>
      <div className={s.ticker}>
        {board.finishers.length > 0 && (
          <div className={s.podium}>
            {board.finishers.slice(0, 5).map((f) => (
              <div key={f.attendeeId} className={s.podRow}>
                <span>#{f.rank}</span>
                <Avatar config={f.avatar} size={52} />
                <span>{f.nickname}</span>
                <span>{fmtElapsed(f.elapsedMs)}</span>
              </div>
            ))}
          </div>
        )}
        <AnimatePresence initial={false}>
          {ticks.map((t) => (
            <motion.div key={`${t.nickname}-${t.at}`} className={s.tick} initial={reduce ? { opacity: 0 } : { x: 120, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ opacity: 0 }}>
              <Avatar config={t.avatar} size={40} /> {t.nickname} stamped {t.solved}/{t.total}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
