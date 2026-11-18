/*
  /schedule: the whole afternoon as tilted cards on a string. LIVE, DONE and
  "+10 min" stamps; highlights get a bigger wobbling card with a sticker edge.
  Delays flip the time like a departure board and nudge the cards that moved.
*/
import type { Activity } from '@afterhours/shared/features/schedule';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';
import { useServerNow } from '../../core/clock';
import { fmtClock } from '../../core/time';
import { Card, Doodle, ErrorState, LinkButton, LoadingState } from '../../kit';
import { PageHead, Stamp, ui } from '../common/ui';
import s from './schedule.module.css';
import { KIND_LABEL, LINK_LABEL, useLastChange, useSchedule } from './useSchedule';

function FlipTime({ ms }: { ms: number }) {
  const reduce = useReducedMotion();
  const [clock, ampm] = fmtClock(ms).split(' ');
  const text = `${clock}${ampm ?? ''}`;
  return (
    <span className={s.flipWrap}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={text}
          className={s.flip}
          initial={reduce ? { opacity: 0 } : { rotateX: -90, opacity: 0 }}
          animate={{ rotateX: 0, opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { rotateX: 90, opacity: 0 }}
          transition={{ duration: 0.28 }}
        >
          {clock}
          <small className={s.ampm}>{ampm}</small>
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

function Row({ a, i, nudged, now }: { a: Activity; i: number; nudged: boolean; now: number }) {
  const reduce = useReducedMotion();
  const tilt = a.highlight ? (i % 2 ? 1.2 : -1.2) : i % 2 ? 0.8 : -0.7;
  const late = Math.round(a.delayMs / 60_000);
  const over = a.status === 'live' && now > a.endAt;
  return (
    <motion.li
      layout={!reduce}
      className={`${s.tlItem} ${a.status === 'ended' ? s.tlDone : ''}`}
      animate={nudged && !reduce ? { x: [0, 14, -8, 0] } : { x: 0 }}
      transition={{ layout: { type: 'spring', stiffness: 300, damping: 28 }, duration: 0.5 }}
    >
      <div className={s.tlTime}>
        <FlipTime ms={a.startAt} />
        <span className={s.tlDot} aria-hidden="true" />
      </div>
      <Card
        tone={a.status === 'live' ? (a.highlight ? 'pink' : 'sun') : a.highlight ? 'paper' : 'paper'}
        tilt={tilt}
        className={`${s.tlCard} ${a.highlight ? s.highlight : ''} ${a.highlight && a.status !== 'ended' && !reduce ? s.wobble : ''}`}
      >
        <div className={ui.between}>
          <span className={s.kind}>{KIND_LABEL[a.kind]}</span>
          <span className={ui.row}>
            {a.status === 'live' && <Stamp tone={over ? 'late' : 'live'}>{over ? 'running over' : 'live'}</Stamp>}
            {a.status === 'ended' && <Stamp tone="done">done</Stamp>}
            {a.status === 'upcoming' && late > 0 && <Stamp tone="late">+{late} min</Stamp>}
            {a.status === 'upcoming' && late < 0 && <Stamp tone="sky">{late} min</Stamp>}
          </span>
        </div>
        <h3 className={a.highlight ? s.tlTitleBig : s.tlTitle}>
          {a.highlight && <Doodle name="star" size={26} fill="var(--sun)" />} {a.title}
        </h3>
        {a.blurb && <p className={s.blurb}>{a.blurb}</p>}
        <p className={s.where}>
          <Doodle name="pin" size={16} /> {a.location || 'around'} <span className={s.until}>till {fmtClock(a.endAt)}</span>
        </p>
        {a.link && a.status !== 'ended' && (
          <LinkButton to={a.link} size="sm" tone={a.status === 'live' ? 'ink' : 'lime'} icon="arrow" className={s.jump}>
            {LINK_LABEL[a.link] ?? 'jump in'}
          </LinkButton>
        )}
      </Card>
    </motion.li>
  );
}

export function Timeline() {
  const q = useSchedule();
  const change = useLastChange();
  const now = useServerNow(5000);
  const [nudged, setNudged] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (!change) return;
    const c = change.change;
    if ((c.kind === 'delayed' || c.kind === 'started') && c.shiftedIds.length) {
      setNudged(new Set([...c.shiftedIds, c.activityId]));
      const t = window.setTimeout(() => setNudged(new Set()), 700);
      return () => window.clearTimeout(t);
    }
  }, [change]);

  if (q.isPending) return <LoadingState label="fetching the plan..." />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const list = q.data.activities;
  return (
    <div className={ui.page}>
      <PageHead title="the afternoon" note="times move when the organisers move them. this page keeps up." color="var(--sky)" />
      <ol className={s.timeline}>
        {list.map((a, i) => (
          <Row key={a.id} a={a} i={i} nudged={nudged.has(a.id)} now={now} />
        ))}
      </ol>
    </div>
  );
}
