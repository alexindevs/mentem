const pad = (n: number) => String(n).padStart(2, "0");

/** Minutes since midnight as "7:30 AM". 1440 reads as the 12:00 AM that ends the day. */
export function formatTime(total: number): string {
  const day = total % 1440;
  const hour = Math.floor(day / 60);
  return `${hour % 12 || 12}:${pad(day % 60)} ${hour >= 12 ? "PM" : "AM"}`;
}

/** A whole hour as "9 AM". 24 reads as 12 AM. */
export function formatHour(hour: number): string {
  const h = hour % 24;
  return `${h % 12 || 12} ${h >= 12 ? "PM" : "AM"}`;
}

/** A length of time as "8 hours" or "7 hours 30 min". */
export function formatSpan(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const h = `${hours} ${hours === 1 ? "hour" : "hours"}`;
  if (rest === 0) return h;
  return hours === 0 ? `${rest} min` : `${h} ${rest} min`;
}

/** Milliseconds as "24:59", or "1:05:00" from an hour up. Rounds up so it never shows 0:00 early. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Every time from `from` to `to` inclusive, `step` minutes apart. */
export function timeSteps(from: number, to: number, step: number): number[] {
  const out: number[] = [];
  for (let t = from; t <= to; t += step) out.push(t);
  return out;
}

/** "2026-11-16" as a local Date. */
export function parseLocalDate(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/** "12:30 – 1:00 PM", dropping the first AM/PM when both share it. */
export function formatRange(start: number, end: number): string {
  const a = formatTime(start);
  const b = formatTime(end);
  return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -3)} – ${b}` : `${a} – ${b}`;
}

/** Minutes of focus as "4h 10m", or "45m". */
export function formatFocus(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? `${m}m` : m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** A whole hour as a plain number, "9" or "1", for block ranges like "9 – 12". */
export const hourShort = (hour: number) => String(hour % 12 || 12);

/** A block boundary: "9" or "1" on the hour, "12:22" when a block was started early. */
export function blockTime(minutes: number): string {
  return minutes % 60 === 0 ? hourShort(minutes / 60) : `${Math.floor(minutes / 60) % 12 || 12}:${pad(minutes % 60)}`;
}
