/**
 * Local calendar dates as "YYYY-MM-DD" strings and times of day as minutes since midnight.
 * Weekdays are 0 = Monday ... 6 = Sunday. Calendar math is done in UTC so daylight
 * saving changes never shift a date; local time is only used to turn a date plus a
 * time of day into an instant.
 */
export type LocalDate = string;

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

export function formatDate(y: number, m: number, d: number): LocalDate {
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

export function parseDate(date: LocalDate): { y: number; m: number; d: number } {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) throw new Error(`Invalid date: ${date}`);
  return { y, m, d };
}

export function isValidDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const { y, m, d } = parseDate(date);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** The local calendar date of an instant. */
export function dateOf(ms: number): LocalDate {
  const t = new Date(ms);
  return formatDate(t.getFullYear(), t.getMonth() + 1, t.getDate());
}

/** Minutes since local midnight of an instant. */
export function minutesOfDay(ms: number): number {
  const t = new Date(ms);
  return t.getHours() * 60 + t.getMinutes();
}

export function addDays(date: LocalDate, n: number): LocalDate {
  const { y, m, d } = parseDate(date);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return formatDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function daysBetween(a: LocalDate, b: LocalDate): number {
  const pa = parseDate(a);
  const pb = parseDate(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86_400_000);
}

/** 0 = Monday ... 6 = Sunday. */
export function weekdayOf(date: LocalDate): number {
  const { y, m, d } = parseDate(date);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** The instant of a local date at a time of day (minutes since midnight, may exceed 1440). */
export function instantOf(date: LocalDate, minutes: number): number {
  const { y, m, d } = parseDate(date);
  return new Date(y, m - 1, d, 0, minutes, 0, 0).getTime();
}

/** First day of the week containing `date`, where the week ends on `weekEndDay`. */
export function weekStart(date: LocalDate, weekEndDay: number): LocalDate {
  const startDay = (weekEndDay + 1) % 7;
  const back = (weekdayOf(date) - startDay + 7) % 7;
  return addDays(date, -back);
}

export function weekEnd(date: LocalDate, weekEndDay: number): LocalDate {
  return addDays(weekStart(date, weekEndDay), 6);
}

export function parseTime(text: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) throw new Error(`Invalid time: ${text}`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59) throw new Error(`Invalid time: ${text}`);
  return h * 60 + min;
}

export function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  return `${pad(h)}:${pad(minutes % 60)}`;
}
