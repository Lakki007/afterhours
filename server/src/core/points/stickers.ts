import { type StickerDef, type StickerDefInput, StickerDefSchema } from '@afterhours/shared';
import { type Db, all, run } from '../db';
import type { LiveBus } from '../live/bus';

/** Stickers every attendee can get from core flows. Features add their own via `stickers` on their feature object. */
export const CORE_STICKERS: StickerDefInput[] = [
  { id: 'showed-up', title: 'showed up', hint: 'sign in at the door', shape: 'ticket', color: 'sun', glyph: 'flag', feature: 'core', order: 0 },
  { id: 'new-face', title: 'new face', hint: 'make your avatar', shape: 'blob', color: 'pink', glyph: 'smile', feature: 'core', order: 1 },
];

export class StickerService {
  private readonly catalogue = new Map<string, StickerDef>();

  constructor(
    private readonly db: Db,
    private readonly live: LiveBus,
    private readonly now: () => number = Date.now,
  ) {}

  /** Add catalogue entries. Throws on invalid or duplicate ids (at boot, so you notice). */
  register(defs: StickerDefInput[]): void {
    for (const input of defs) {
      const def = StickerDefSchema.parse(input);
      if (this.catalogue.has(def.id)) throw new Error(`Duplicate sticker id "${def.id}" (from ${def.feature})`);
      this.catalogue.set(def.id, def);
    }
  }

  list(): StickerDef[] {
    return [...this.catalogue.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  }

  get(id: string): StickerDef | undefined {
    return this.catalogue.get(id);
  }

  /**
   * Idempotent: the first call unlocks and publishes 'sticker.unlocked' to
   * that attendee (which pops the celebration); later calls are no-ops.
   */
  unlock(attendeeId: number, stickerId: string): { unlocked: boolean } {
    const sticker = this.catalogue.get(stickerId);
    if (!sticker) throw new Error(`Unknown sticker "${stickerId}". Register it in your feature's stickers list.`);
    const at = this.now();
    const r = run(this.db, 'INSERT OR IGNORE INTO sticker_unlocks (attendee_id, sticker_id, at) VALUES (?, ?, ?)', attendeeId, stickerId, at);
    if (r.changes === 0) return { unlocked: false };
    this.live.publish('sticker.unlocked', { sticker, at }, { attendeeId });
    return { unlocked: true };
  }

  /** Take back every unlock of stickers whose id starts with `prefix` (danger-zone resets). Returns rows removed. */
  revokePrefix(prefix: string): number {
    if (prefix.length < 2) throw new Error('Sticker prefix too short: refusing to wipe the whole book');
    return run(this.db, "DELETE FROM sticker_unlocks WHERE substr(sticker_id, 1, ?) = ?", prefix.length, prefix).changes;
  }

  unlockedBy(attendeeId: number): Record<string, number> {
    const rows = all<{ sticker_id: string; at: number }>(this.db, 'SELECT sticker_id, at FROM sticker_unlocks WHERE attendee_id = ?', attendeeId);
    return Object.fromEntries(rows.map((r) => [r.sticker_id, r.at]));
  }
}
