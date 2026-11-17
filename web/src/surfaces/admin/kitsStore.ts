/*
  The kits you just generated, with their plain passwords.
  Memory only, on purpose: spec section 4 says plain passwords exist only in the
  printable sheet shown once and the CSV downloaded at that moment. Reloading
  the page forgets them (the server only keeps hashes).
*/
import type { GeneratedKit } from '@afterhours/shared';
import { useSyncExternalStore } from 'react';

export interface Batch {
  kits: GeneratedKit[];
  at: number;
}

let batch: Batch | null = null;
const listeners = new Set<() => void>();

export function setBatch(kits: GeneratedKit[]): void {
  batch = { kits, at: Date.now() };
  listeners.forEach((l) => l());
}

export function clearBatch(): void {
  batch = null;
  listeners.forEach((l) => l());
}

export function useBatch(): Batch | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => batch,
    () => null,
  );
}

/** RFC 4180-ish CSV with a header. */
export function toCsv(rows: (string | number | null)[][]): string {
  const esc = (v: string | number | null) => {
    const t = v === null ? '' : String(v);
    return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return `${rows.map((r) => r.map(esc).join(',')).join('\r\n')}\r\n`;
}

export function downloadText(filename: string, text: string, type = 'text/csv'): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}
