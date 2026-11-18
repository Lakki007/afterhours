/*
  Home "now and next": the top of the attendee home. Happening now with a
  progress ring (server time), up next with a live countdown. When an organiser
  starts something (or time does), the old card slides out and the new one
  slams in with a blip and a little confetti.
*/
import type { Activity } from '@afterhours/shared/features/schedule';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { useServerNow } from '../../core/clock';
import { fmtClock, fmtDay, fmtDuration } from '../../core/time';
import { confetti, haptics, sfx } from '../../fun';
import { Card, Countdown, Doodle, LinkButton, ProgressRing } from '../../kit';
import { Stamp } from '../common/ui';
import s from './schedule.module.css';
import { LINK_LABEL, nowAndNext, useLastChange, useSchedule } from './useSchedule';

function NowCard({ a, now }: { a: Activity; now: number }) {
  const span = Math.max(1, a.endAt - a.startAt);
  const over = now > a.endAt;
  const progress = over ? 1 : (now - a.startAt) / span;
  const left = a.endAt - now;
  return (
    <Card tone={a.highlight ? 'pink' : 'sun'} tilt={-1.4} tape tapeColor="sky" className={`${s.nowCard} ${a.highlight ? s.highlight : ''}`}>
      <div className={s.nowRow}>
        <ProgressRing value={progress} size={122} thickness={12} tone={over ? 'pink' : 'tangerine'} label="how far along">
          <span>
            <span className={s.ringNum}>
              {over ? '+' : ''}
              {Math.max(0, Math.round(Math.abs(left) / 60_000))}
            </span>
            <span className={s.ringUnit}>{over ? 'min over' : 'min left'}</span>
          </span>
        </ProgressRing>
        <div className={s.nowText}>
          <p className={s.kicker}>happening now</p>
          <h2 className={s.nowTitle}>{a.title}</h2>
          <p className={s.where}>
            <Doodle name="pin" size={18} /> {a.location || 'around'}
          </p>
        </div>
      </div>
      <div className={s.nowFoot}>
        {over ? <Stamp tone="late" rot={-4}>running over</Stamp> : <Stamp tone="live" rot={-4}>live</Stamp>}
        {a.link && (
          <LinkButton to={a.link} tone="ink" size="sm" icon="arrow">
            {LINK_LABEL[a.link] ?? 'jump in'}
          </LinkButton>
        )}
      </div>
    </Card>
  );
}

function NextStrip({ a, now, solo }: { a: Activity; now: number; solo: boolean }) {
  const soon = a.startAt - now;
  return (
    <Card tone={solo ? 'sky' : 'paper'} tilt={solo ? -1 : 1.1} className={s.nextCard}>
      <div className={s.nextRow}>
        <div className={s.nextText}>
          <p className={s.kicker}>{solo ? 'up next' : 'then'}</p>
          <h3 className={solo ? s.nowTitle : s.nextTitle}>{a.title}</h3>
          <p className={s.where}>
            {fmtClock(a.startAt)}, {a.location || 'around'}
          </p>
        </div>
        <div className={s.nextClock}>
          {soon > 3 * 3_600_000 ? (
            <>
              <span className={s.inLabel}>{fmtDay(a.startAt)}</span>
              <span className={s.farClock}>{fmtClock(a.startAt)}</span>
            </>
          ) : soon > 0 ? (
            <>
              <span className={s.inLabel}>in</span>
              <Countdown to={a.startAt} className={s.countdown} />
            </>
          ) : (
            <span className={s.inLabel}>any minute</span>
          )}
        </div>
      </div>
      {a.highlight && (
        <p className={s.hiNote}>
          <Doodle name="star" size={18} fill="var(--sun)" /> big one. {fmtDuration(a.endAt - a.startAt)} of it.
        </p>
      )}
    </Card>
  );
}

export function NowNextCard() {
  const q = useSchedule();
  const now = useServerNow(1000);
  const change = useLastChange();
  const reduce = useReducedMotion();
  const { now: cur, next } = nowAndNext(q.data);
  const seen = useRef<number>(0);

  useEffect(() => {
    if (!change || change.seq === seen.current) return;
    seen.current = change.seq;
    const c = change.change;
    const startedSomething = c.kind === 'started' || (c.kind === 'advanced' && c.nowId !== null && c.nowId !== c.previousNowId);
    if (startedSomething) {
      sfx.success();
      haptics.success();
      if (!reduce) confetti({ x: 0.5, y: 0.25, count: 40, spread: 70 });
    } else if (c.kind === 'delayed' || c.kind === 'reordered') {
      sfx.whoosh();
      haptics.tick();
    }
  }, [change, reduce]);

  if (!q.data) return null;
  const allDone = !cur && !next;
  return (
    <section className={s.nowNext} aria-label="now and next">
      <AnimatePresence mode="popLayout" initial={false}>
        {cur && (
          <motion.div
            key={`now-${cur.id}`}
            initial={reduce ? { opacity: 0 } : { scale: 1.4, rotate: 8, opacity: 0, y: -30 }}
            animate={{ scale: 1, rotate: 0, opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { x: -420, rotate: -14, opacity: 0, transition: { duration: 0.35 } }}
            transition={{ type: 'spring', stiffness: 520, damping: 20 }}
          >
            <NowCard a={cur} now={now} />
          </motion.div>
        )}
        {next && (
          <motion.div key={`next-${next.id}`} layout={!reduce} initial={reduce ? { opacity: 0 } : { y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ opacity: 0 }}>
            <NextStrip a={next} now={now} solo={!cur} />
          </motion.div>
        )}
      </AnimatePresence>
      {allDone && (
        <Card tone="grape" tilt={-1}>
          <p className={s.wrap}>that's a wrap. thanks for hanging out.</p>
        </Card>
      )}
      <Link to="/schedule" className={s.planLink}>
        the whole afternoon <Doodle name="arrow" size={22} />
      </Link>
    </section>
  );
}
