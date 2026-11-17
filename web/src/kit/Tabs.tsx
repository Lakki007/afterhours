/*
  Tabs: folder tabs; the active one lifts and the yellow block slides across.
    <Tabs value={v} onChange={setV} items={[{ id: 'a', label: 'blank' }, { id: 'b', label: 'csv', icon: 'list' }]} />
*/
import { motion } from 'motion/react';
import { useId } from 'react';
import { haptics } from '../fun/haptics';
import { sfx } from '../fun/sfx';
import { Doodle, type IconName } from './Doodle';
import s from './kit.module.css';

export interface TabItem<T extends string = string> {
  id: T;
  label: string;
  icon?: IconName;
}

export function Tabs<T extends string>({ items, value, onChange, label = 'tabs' }: { items: TabItem<T>[]; value: T; onChange: (id: T) => void; label?: string }) {
  const gid = useId();
  return (
    <div className={s.tabs} role="tablist" aria-label={label}>
      {items.map((t) => {
        const on = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={on}
            className={s.tab}
            onClick={() => {
              if (!on) {
                sfx.tick();
                haptics.tick();
                onChange(t.id);
              }
            }}
          >
            {on && <motion.span layoutId={`tabbg-${gid}`} className={s.tabBg} transition={{ type: 'spring', stiffness: 520, damping: 34 }} />}
            <span>
              {t.icon && <Doodle name={t.icon} size={18} />}
              {t.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
