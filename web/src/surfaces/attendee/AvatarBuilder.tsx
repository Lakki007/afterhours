/*
  AvatarBuilder: a toy, not a form. The face follows your finger, tapping it
  boops it, the dice shake out a whole new one, and every option in the tray is
  a live preview you can slap on.
*/
import { AVATAR_OPTIONS, type AvatarConfig, type AvatarPart, avatarFromSeed } from '@afterhours/shared';
import { useAnimate, useReducedMotion } from 'motion/react';
import { useRef, useState } from 'react';
import { haptics, sfx, Tilt, useLook } from '../../fun';
import { Avatar, Button, Doodle, type IconName, Tabs } from '../../kit';
import s from './attendee.module.css';

const PARTS: { id: AvatarPart; label: string; icon: IconName }[] = [
  { id: 'color', label: 'colour', icon: 'spark' },
  { id: 'shape', label: 'body', icon: 'ghost' },
  { id: 'eyes', label: 'eyes', icon: 'eye' },
  { id: 'mouth', label: 'mouth', icon: 'smile' },
  { id: 'top', label: 'hat', icon: 'crown' },
  { id: 'extra', label: 'extras', icon: 'heart' },
];

const BOOPS = ['boop.', 'ow.', 'rude.', 'again!', 'hehe', 'that tickles', 'eep'];

export function AvatarBuilder({ value, onChange }: { value: AvatarConfig; onChange: (v: AvatarConfig) => void }) {
  const [part, setPart] = useState<AvatarPart>('eyes');
  const [scope, animate] = useAnimate<HTMLDivElement>();
  const stageRef = useRef<HTMLDivElement>(null);
  const look = useLook(stageRef);
  const reduce = useReducedMotion();
  const [line, setLine] = useState<string | null>(null);
  const lineTimer = useRef<number | undefined>(undefined);

  const squish = (big: boolean) => {
    if (reduce || !scope.current) return;
    void animate(scope.current, big ? { scale: [1, 1.22, 0.85, 1.06, 1], rotate: [0, -6, 5, -2, 0] } : { scale: [1, 1.1, 0.95, 1] }, { duration: big ? 0.5 : 0.28 });
  };

  const pick = (opt: string) => {
    sfx.tick();
    haptics.tick();
    squish(false);
    onChange({ ...value, [part]: opt } as AvatarConfig);
  };

  const boop = () => {
    sfx.pop();
    haptics.tap();
    squish(true);
    setLine(BOOPS[Math.floor(Math.random() * BOOPS.length)] ?? 'boop.');
    window.clearTimeout(lineTimer.current);
    lineTimer.current = window.setTimeout(() => setLine(null), 1100);
  };

  const shuffle = () => {
    sfx.rattle();
    haptics.celebrate();
    squish(true);
    onChange(avatarFromSeed(Math.floor(Math.random() * 1_000_000)));
  };

  return (
    <div className={s.builder}>
      <div className={s.stage} ref={stageRef}>
        <div className={s.stageDots} aria-hidden="true" />
        <Tilt max={14}>
          <div ref={scope} className={s.stageAvatar}>
            <button type="button" className={s.avatarHit} onClick={boop} aria-label="boop your avatar">
              <Avatar config={value} size={220} look={look} wobble />
            </button>
          </div>
        </Tilt>
        {line && <span className={s.boop}>{line}</span>}
        <Button tone="paper" size="sm" icon="dice" onClick={shuffle} className={s.diceBtn}>
          surprise me
        </Button>
      </div>

      <Tabs items={PARTS.map((p) => ({ id: p.id, label: p.label, icon: p.icon }))} value={part} onChange={setPart} label="avatar parts" />

      <div className={s.tray} role="listbox" aria-label={`${part} options`}>
        {AVATAR_OPTIONS[part].map((opt) => {
          const on = value[part] === opt;
          return (
            <button
              key={opt}
              type="button"
              role="option"
              aria-selected={on}
              aria-label={opt}
              className={`${s.opt} ${on ? s.optOn : ''}`}
              onClick={() => pick(opt)}
            >
              <Avatar config={{ ...value, [part]: opt } as AvatarConfig} size={60} />
              {on && <Doodle name="check" size={16} className={s.optTick} stroke="var(--ink)" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
