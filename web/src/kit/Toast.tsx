/*
  Toasts: sticky-note messages that drop from the top.
    const toast = useToast();
    toast('saved', { kind: 'good' });
    toast('nope', { kind: 'bad', title: 'wrong code', icon: 'close' });
  Needs <ToastProvider> (every surface mounts one).
*/
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useNavigate } from 'react-router';
import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from 'react';
import { haptics } from '../fun/haptics';
import { sfx } from '../fun/sfx';
import { Tape } from './Card';
import { Doodle, type IconName } from './Doodle';
import s from './kit.module.css';

export type ToastKind = 'info' | 'good' | 'bad' | 'points';
export interface ToastOptions {
  kind?: ToastKind;
  title?: string;
  icon?: IconName;
  ms?: number;
  /** In-app path to open when the toast is tapped, e.g. '/polls'. */
  url?: string;
  /** Silence the blip. */
  quiet?: boolean;
}
interface ToastItem extends ToastOptions {
  id: number;
  message: string;
  rot: number;
}

const TONE: Record<ToastKind, string> = { info: 'sun', good: 'lime', bad: 'pink', points: 'sky' };
const ICON: Record<ToastKind, IconName> = { info: 'spark', good: 'check', bad: 'close', points: 'star' };

type Push = (message: string, opts?: ToastOptions) => void;
const ToastContext = createContext<Push | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const reduce = useReducedMotion();
  const navigate = useNavigate();
  const remove = useCallback((id: number) => setItems((l) => l.filter((t) => t.id !== id)), []);
  const push = useCallback<Push>(
    (message, opts = {}) => {
      const id = ++seq.current;
      setItems((l) => [...l.slice(-2), { ...opts, id, message, rot: (Math.random() - 0.5) * 4 }]);
      if (!opts.quiet) {
        if (opts.kind === 'bad') {
          sfx.fail();
          haptics.fail();
        } else if (opts.kind === 'good' || opts.kind === 'points') {
          sfx.pop();
          haptics.success();
        } else sfx.pop();
      }
      window.setTimeout(() => remove(id), opts.ms ?? 3800);
    },
    [remove],
  );
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className={s.toasts} aria-live="polite" role="status">
        <AnimatePresence initial={false}>
          {items.map((t) => {
            const kind = t.kind ?? 'info';
            return (
              <motion.div
                key={t.id}
                layout={!reduce}
                className={`${s.toast} ${s[`tone-${TONE[kind]}`]} ${t.url ? s.toastLink : ''}`}
                onClick={() => {
                  if (t.url) {
                    navigate(t.url);
                    remove(t.id);
                  }
                }}
                initial={reduce ? { opacity: 0 } : { y: -80, rotate: t.rot * 3, opacity: 0, scale: 0.8 }}
                animate={{ y: 0, rotate: t.rot, opacity: 1, scale: 1 }}
                exit={{ opacity: 0, x: 120, transition: { duration: 0.2 } }}
                transition={{ type: 'spring', stiffness: 500, damping: 24 }}
                drag="x"
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={0.8}
                onDragEnd={(_, i) => {
                  if (Math.abs(i.offset.x) > 70) remove(t.id);
                }}
              >
                <Tape side="left" color={kind === 'bad' ? 'sun' : 'pink'} />
                <Doodle name={t.icon ?? ICON[kind]} size={26} fill="var(--paper-3)" />
                <span className={s.toastBody}>
                  {t.title && <span className={s.toastTitle}>{t.title}</span>}
                  <span>{t.message}</span>
                </span>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): Push {
  const v = useContext(ToastContext);
  if (!v) throw new Error('useToast() needs a <ToastProvider> above it');
  return v;
}
