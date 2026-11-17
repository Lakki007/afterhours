/*
  Tilt: wraps anything and leans it toward your finger / cursor, springing
  back on release. Pure delight; use on hero things, not on lists.
    <Tilt max={10}><Card>...</Card></Tilt>
  Draggy: a thing you can fling around; it snaps home with a spring.
    <Draggy><Sticker .../></Draggy>
*/
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'motion/react';
import type { CSSProperties, PointerEvent, ReactNode } from 'react';
import { haptics } from './haptics';
import { sfx } from './sfx';

export function Tilt({ children, max = 9, className, style }: { children: ReactNode; max?: number; className?: string; style?: CSSProperties }) {
  const reduce = useReducedMotion();
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, { stiffness: 220, damping: 16 });
  const sy = useSpring(py, { stiffness: 220, damping: 16 });
  const rotateY = useTransform(sx, [-1, 1], [-max, max]);
  const rotateX = useTransform(sy, [-1, 1], [max, -max]);
  const set = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    px.set(((e.clientX - r.left) / r.width) * 2 - 1);
    py.set(((e.clientY - r.top) / r.height) * 2 - 1);
  };
  const reset = () => {
    px.set(0);
    py.set(0);
  };
  if (reduce) return <div className={className} style={style}>{children}</div>;
  return (
    <motion.div
      className={className}
      style={{ ...style, rotateX, rotateY, transformPerspective: 700, touchAction: 'pan-y' }}
      onPointerMove={set}
      onPointerDown={set}
      onPointerLeave={reset}
      onPointerUp={reset}
      onPointerCancel={reset}
    >
      {children}
    </motion.div>
  );
}

export function Draggy({ children, className, style, quiet }: { children: ReactNode; className?: string; style?: CSSProperties; quiet?: boolean }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      style={{ ...style, touchAction: 'none', cursor: 'grab' }}
      drag={!reduce}
      dragSnapToOrigin
      dragElastic={0.5}
      dragTransition={{ bounceStiffness: 260, bounceDamping: 14 }}
      whileDrag={{ scale: 1.12, rotate: 6, cursor: 'grabbing', zIndex: 5 }}
      onDragStart={() => {
        if (quiet) return;
        sfx.pop();
        haptics.tick();
      }}
      onDragEnd={() => {
        if (quiet) return;
        sfx.tick();
      }}
    >
      {children}
    </motion.div>
  );
}
