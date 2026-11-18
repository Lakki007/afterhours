/*
  Slip reading, as the trails screens see it. The camera scanner (another engineer, see docs/SLIPS.md)
  returns a SlipScan; until that module lands this file holds the same shapes and a stub panel, so
  the trail screens are wired end to end with the typed-word fallback (always available anyway).
  When the scanner lands: replace `CameraSlipScanner` with its component and keep `readingOf`.
*/
import { Doodle } from '../../kit';
import s from './hunt.module.css';

export interface StripReading {
  /** letters separated by ' ', words by ' / ', e.g. "-.-. --- -.. ." */
  morse: string;
  /** decoded with the shared table; null if any letter is invalid */
  text: string | null;
  confidence: number;
  position: 'bottom' | 'top' | 'other';
}
export interface SlipScan {
  primary: StripReading | null;
  others: StripReading[];
  at: number;
}

/** What the phone sends: primary.text, or primary.morse when text is null (docs/SLIPS.md). */
export function readingOf(scan: SlipScan): { text?: string; morse?: string } | null {
  const p = scan.primary;
  if (!p) return null;
  return p.text ? { text: p.text, morse: p.morse } : { morse: p.morse };
}

/** Placeholder until the camera slip scanner lands: explains the move and points at the typed fallback. */
export function CameraSlipScanner(_props: { onScan: (scan: SlipScan) => void }) {
  return (
    <div className={s.slipCam}>
      <Doodle name="eye" size={34} fill="var(--sky)" />
      <p>
        <b>hold the slip flat, the edge you want at the bottom.</b> the camera reader is on its way; for now decode the bottom strip with the chart and type it.
      </p>
    </div>
  );
}
