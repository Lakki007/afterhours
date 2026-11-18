/* Projector: the ladder race, the speed-round countdown with its live top, and the clear feed. */
import { MorseOverviewSchema } from '@afterhours/shared/features/morse';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { api } from '../../core/api';
import { useLiveEvent } from '../../core/live';
import { Avatar, Countdown } from '../../kit';
import s from './morse.module.css';

export function useMorseOverview() {
  const q = useQuery({ queryKey: ['morse', 'screen'], queryFn: () => api.get('/api/morse/screen', MorseOverviewSchema), refetchInterval: 10_000 });
  useLiveEvent('morse.cleared', () => void q.refetch());
  useLiveEvent('morse.state', () => void q.refetch());
  useLiveEvent('morse.sprint-board', () => void q.refetch());
  useLiveEvent('morse.sprint-ended', () => void q.refetch());
  return q;
}

export default function MorseScene() {
  const q = useMorseOverview();
  const o = q.data;
  if (!o) return null;
  const max = Math.max(1, ...o.clears.decode, ...o.clears.encode);
  const board = o.sprint?.top ?? o.lastSprint?.top ?? [];
  return (
    <div className={s.scene}>
      <div>
        <h2 className={s.sceneTitle}>{o.sprint ? 'speed round!' : 'morse ladder'}</h2>
        {o.sprint ? (
          <Countdown to={o.sprint.sprint.endsAt} className={s.bigClock} />
        ) : (
          <div className={s.race}>
            {o.clears.decode.map((n, i) => (
              <div key={i} className={s.raceRow}>
                <span>level {i + 1}</span>
                <div className={s.raceTrack}>
                  <motion.div className={s.raceDec} initial={false} animate={{ width: `${(n / max) * 50}%` }} />
                  <motion.div className={s.raceEnc} initial={false} animate={{ width: `${((o.clears.encode[i] ?? 0) / max) * 50}%` }} />
                </div>
                <span>{n + (o.clears.encode[i] ?? 0)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className={s.feed}>
        {board.length > 0 && (
          <div className={s.podium}>
            {board.slice(0, 10).map((r) => (
              <div key={r.attendeeId} className={s.podRow}>
                <span>#{r.rank}</span>
                <Avatar config={r.avatar} size={44} />
                <span>{r.nickname}</span>
                <span>{r.score}</span>
              </div>
            ))}
          </div>
        )}
        {board.length === 0 &&
          o.recent.slice(0, 6).map((c) => (
            <div key={`${c.nickname}-${c.at}`} className={s.feedItem}>
              <Avatar config={c.avatar} size={40} /> {c.nickname} cleared {c.mode} {c.level}
              {c.wpm ? ` at ${Math.round(c.wpm)} wpm` : ''}
            </div>
          ))}
      </div>
    </div>
  );
}
