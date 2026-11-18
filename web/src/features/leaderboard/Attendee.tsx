/*
  /leaderboard on the phone: "you are #N" with an arrow when you move, the gap to
  the person above, your neighbours, and the top list that springs into its new
  order. While frozen: "???" rows and a reminder that your points still count.
*/
import type { BoardRow } from '@afterhours/shared/features/leaderboard';
import { motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';
import { useLiveEvent } from '../../core/live';
import { useMe } from '../../core/queries';
import { confetti, haptics, sfx } from '../../fun';
import { Avatar, Card, Doodle, ErrorState, LoadingState, Meter, NumberTicker } from '../../kit';
import { PageHead, Stamp, ui } from '../common/ui';
import s from './leaderboard.module.css';
import { useBoard } from './useBoard';

export function Row({ r, me }: { r: BoardRow; me?: number | null }) {
  const reduce = useReducedMotion();
  if (r.hidden)
    return (
      <motion.li layout={!reduce} className={`${s.row} ${s.hidden}`}>
        <span className={s.rank}>#{r.rank}</span>
        <span className={s.mystery}>???</span>
      </motion.li>
    );
  return (
    <motion.li layout={!reduce} transition={{ type: 'spring', stiffness: 380, damping: 30 }} className={`${s.row} ${r.attendeeId === me ? s.mine : ''} ${r.rank <= 3 ? s[`top${r.rank}`] : ''}`}>
      <span className={s.rank}>#{r.rank}</span>
      <Avatar config={r.avatar} size={40} />
      <span className={s.nick}>
        {r.nickname} {r.tied && <span className={s.tie}>=</span>}
      </span>
      <span className={s.total}>
        <NumberTicker value={r.total} />
      </span>
    </motion.li>
  );
}

export function LeaderboardPage() {
  const q = useBoard(20);
  const myId = useMe().data?.attendee.id ?? null;
  const [moved, setMoved] = useState<{ dir: 'up' | 'down'; by: number } | null>(null);
  useLiveEvent('leaderboard.rank', (d) => {
    if (d.previous === null || d.previous === d.rank) return;
    const up = d.rank < d.previous;
    setMoved({ dir: up ? 'up' : 'down', by: Math.abs(d.previous - d.rank) });
    if (up) {
      sfx.success();
      haptics.success();
      confetti({ count: 24, y: 0.25 });
    }
  });
  if (q.isPending) return <LoadingState label="counting points..." />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const b = q.data;
  const me = b.me;
  return (
    <div className={ui.page}>
      <PageHead title="the board" note={`${b.players} people on it. every vote, stamp and game counts.`} color="var(--sun)" />
      {b.freeze.frozen && (
        <p className={s.frozen}>
          <Doodle name="lock" size={20} /> the board is frozen for the big reveal. your points still count.
        </p>
      )}
      {me && (
        <Card tone="ink" tilt={-1.2} className={s.meCard}>
          <div className={s.meRow}>
            <div>
              <p className={s.meLabel}>you are</p>
              <p className={s.meRank}>{me.hiddenInTop ? '#???' : me.rank ? `#${me.rank}` : 'unranked'}</p>
            </div>
            {moved && (
              <motion.span key={`${moved.dir}${moved.by}`} className={`${s.arrow} ${moved.dir === 'up' ? s.up : s.down}`} initial={{ scale: 0, rotate: -40 }} animate={{ scale: 1, rotate: 0 }}>
                {moved.dir === 'up' ? '▲' : '▼'} {moved.by}
              </motion.span>
            )}
            <div className={s.mePts}>
              <NumberTicker value={me.liveTotal} />
              <span className={s.meLabel}>points</span>
            </div>
          </div>
          {me.behind !== null && me.nextNickname && (
            <div className={ui.stack}>
              <p className={s.gap}>
                {me.behind === 0 ? `level with ${me.nextNickname}, they got there first` : `${me.behind} pts behind ${me.nextNickname}`}
              </p>
              <Meter value={me.total / Math.max(1, me.total + me.behind)} tone="lime" label="gap to the next place" />
            </div>
          )}
          {me.lead !== null && <p className={s.gap}>you lead by {me.lead}. don't get comfy.</p>}
          {me.tied && <Stamp tone="sky">tied</Stamp>}
        </Card>
      )}
      {me && me.neighbours.length > 0 && !me.hiddenInTop && (
        <Card tone="paper" tilt={0.6}>
          <h3 className={ui.cardTitle}>around you</h3>
          <ol className={s.list}>
            {me.neighbours.map((r) => (
              <Row key={r.hidden ? `h${r.rank}` : r.attendeeId} r={r} me={myId} />
            ))}
          </ol>
        </Card>
      )}
      <Card tone="paper" tilt={-0.4} tape tapeColor="sun">
        <h3 className={ui.cardTitle}>top {b.rows.length}</h3>
        <ol className={s.list}>
          {b.rows.map((r) => (
            <Row key={r.hidden ? `h${r.rank}` : r.attendeeId} r={r} me={myId} />
          ))}
        </ol>
      </Card>
    </div>
  );
}
