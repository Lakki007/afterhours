/*
  Event-time formatting. The event is in Hyderabad, so times are shown in IST
  whatever timezone the phone is set to. All inputs are server epoch ms.
*/
const TZ = 'Asia/Kolkata';
const IST_OFFSET_MS = 5.5 * 3_600_000;

const clockFmt = new Intl.DateTimeFormat('en-IN', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true });

/** "3:30 pm" */
export function fmtClock(ms: number): string {
  return clockFmt.format(ms).replace(/\s?([AP])M$/i, (_, p: string) => ` ${p.toLowerCase()}m`);
}

const dayFmt = new Intl.DateTimeFormat('en-IN', { timeZone: TZ, weekday: 'short' });
/** "sat" */
export function fmtDay(ms: number): string {
  return dayFmt.format(ms).toLowerCase();
}

/** "15:30" in IST, for <input type="time">. */
export function istHHMM(ms: number): string {
  const d = new Date(ms + IST_OFFSET_MS);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** Same IST calendar day as `baseMs`, at hh:mm IST. */
export function atIstHHMM(baseMs: number, hhmm: string): number {
  const d = new Date(baseMs + IST_OFFSET_MS);
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, m) - IST_OFFSET_MS;
}

/** "in 4 min", "in 1 h 20", "now" */
export function fmtIn(ms: number): string {
  if (ms <= 30_000) return 'now';
  const min = Math.round(ms / 60_000);
  if (min < 60) return `in ${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r ? `in ${h} h ${r}` : `in ${h} h`;
}

/** "2 min", "1 h 5 min" */
export function fmtDuration(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

/** "1:02.3" style for race times; "41.2 s" under a minute. */
export function fmtElapsed(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}
