/*
  Sticker book: a notebook page of everything you can collect. Earned ones are
  loose stickers you can fling around; locked ones are dashed outlines that
  tell you how to get them.
*/
import type { StickerDef } from '@afterhours/shared';
import { useState } from 'react';
import { useStickerBook } from '../../core/queries';
import { Draggy } from '../../fun';
import { Card, ErrorState, LoadingState, NumberTicker, Scribble, Sheet, Sticker } from '../../kit';
import s from './attendee.module.css';

export function StickerBook() {
  const book = useStickerBook();
  const [open, setOpen] = useState<StickerDef | null>(null);
  if (book.isPending) return <LoadingState label="finding your stickers..." />;
  if (book.isError) return <ErrorState error={book.error} onRetry={() => void book.refetch()} />;
  const { catalogue, unlocked } = book.data;
  const sorted = [...catalogue].sort((a, b) => a.order - b.order);
  const count = sorted.filter((d) => unlocked[d.id]).length;
  return (
    <div className={s.book}>
      <header className={s.profileHead}>
        <h1 className={s.bigTitle}>sticker book</h1>
        <Scribble color="var(--lime)" style={{ width: 150 }} />
        <p className={s.handNote}>
          <NumberTicker value={count} /> of {catalogue.length} stuck in. the grey ones tell you how to earn them.
        </p>
      </header>
      <Card tone="paper" tilt={-0.5} tape className={s.page}>
        <div className={s.stickerGrid}>
          {sorted.map((d, i) => {
            const got = Boolean(unlocked[d.id]);
            const tilt = ((i * 37) % 17) - 8;
            return (
              <button key={d.id} type="button" className={s.slotBtn} onClick={() => setOpen(d)} aria-label={got ? d.title : `locked: ${d.hint}`}>
                {got ? (
                  <Draggy>
                    <Sticker def={d} size={86} tilt={tilt} />
                  </Draggy>
                ) : (
                  <Sticker def={d} size={86} tilt={tilt / 2} locked />
                )}
                <span className={got ? s.slotTitle : s.slotTitleLocked}>{got ? d.title : '???'}</span>
              </button>
            );
          })}
        </div>
      </Card>
      <Sheet open={open !== null} onClose={() => setOpen(null)} title={open && unlocked[open.id] ? open.title : 'not yet'}>
        {open && (
          <div className={s.stickerDetail}>
            <Sticker def={open} size={150} tilt={-6} locked={!unlocked[open.id]} slap />
            <p className={s.detailHint}>{open.hint}</p>
            {unlocked[open.id] && <p className={s.handNote}>stuck in at {new Date(unlocked[open.id] as number).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</p>}
          </div>
        )}
      </Sheet>
    </div>
  );
}
