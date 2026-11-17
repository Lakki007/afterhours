/*
  PageTransition: wrap a routed page; it flops in like a sheet of paper
  (opacity only under reduced motion).
    <PageTransition pageKey={location.pathname}>{outlet}</PageTransition>
*/
import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';

export function PageTransition({ pageKey, children, className }: { pageKey: string; children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      key={pageKey}
      className={className}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 22, rotate: -0.8 }}
      animate={{ opacity: 1, y: 0, rotate: 0 }}
      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
    >
      {children}
    </motion.div>
  );
}
