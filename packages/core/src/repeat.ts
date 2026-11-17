import { addDays, daysBetween, daysInMonth, parseDate, weekdayOf, weekStart, type LocalDate } from "./dates";
import type { RepeatRule } from "./types";

/** Weeks start on Monday for the purpose of "every other week". */
function mondayOf(date: LocalDate): LocalDate {
  return weekStart(date, 6);
}

/** Whether the rule produces an occurrence on `date`. Dates before the anchor never do. */
export function occursOn(rule: RepeatRule, date: LocalDate): boolean {
  if (date < rule.anchor) return false;
  const a = parseDate(rule.anchor);
  const d = parseDate(date);
  if (rule.unit === "day") return daysBetween(rule.anchor, date) % rule.interval === 0;
  if (rule.unit === "week") {
    const weeks = Math.floor(daysBetween(mondayOf(rule.anchor), mondayOf(date)) / 7);
    if (weeks % rule.interval !== 0) return false;
    const days = rule.weekdays && rule.weekdays.length > 0 ? rule.weekdays : [weekdayOf(rule.anchor)];
    return days.includes(weekdayOf(date));
  }
  if (rule.unit === "month") {
    const months = (d.y - a.y) * 12 + (d.m - a.m);
    if (months % rule.interval !== 0) return false;
    const want = Math.min(rule.monthDay ?? a.d, daysInMonth(d.y, d.m));
    return d.d === want;
  }
  const years = d.y - a.y;
  if (years % rule.interval !== 0) return false;
  const month = rule.yearMonth ?? a.m;
  if (d.m !== month) return false;
  const want = Math.min(rule.yearDay ?? a.d, daysInMonth(d.y, month));
  return d.d === want;
}

/** Occurrence dates in [from, to], inclusive. The range is capped (about 11 years) to keep this cheap. */
export function occurrences(rule: RepeatRule, from: LocalDate, to: LocalDate, maxDays = 4000): LocalDate[] {
  const out: LocalDate[] = [];
  let day = from < rule.anchor ? rule.anchor : from;
  const limit = Math.min(daysBetween(day, to), maxDays);
  for (let i = 0; i <= limit; i++) {
    if (occursOn(rule, day)) out.push(day);
    day = addDays(day, 1);
  }
  return out;
}

const ORDINAL = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10 > 3 ? 0 : n % 10]}`;

/** Short label such as "Every other week · Mon, Wed" or "Every 3 days" for a rule. */
export function describeRule(rule: RepeatRule): string {
  const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const n = rule.interval;
  const every = n === 1 ? "Every" : n === 2 ? "Every other" : `Every ${ORDINAL(n)}`;
  if (rule.unit === "day") return n === 1 ? "Every day" : n === 2 ? "Every other day" : `Every ${n} days`;
  if (rule.unit === "week") {
    const days = rule.weekdays && rule.weekdays.length > 0 ? rule.weekdays : [weekdayOf(rule.anchor)];
    return `${every} week · ${[...days].sort((x, y) => x - y).map((i) => names[i]).join(", ")}`;
  }
  if (rule.unit === "month") return `${every} month · day ${rule.monthDay ?? parseDate(rule.anchor).d}`;
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const a = parseDate(rule.anchor);
  return `${every} year · ${monthNames[(rule.yearMonth ?? a.m) - 1]} ${rule.yearDay ?? a.d}`;
}

/** Checks a rule that came from outside (the window, a file) and returns it cleaned, or throws. */
export function parseRule(value: unknown): RepeatRule {
  const r = value as Partial<RepeatRule> | null;
  const bad = (why: string) => new Error(`Invalid repeat: ${why}`);
  if (!r || typeof r !== "object") throw bad("no rule");
  if (!["day", "week", "month", "year"].includes(r.unit as string)) throw bad("unit");
  if (!Number.isInteger(r.interval) || (r.interval as number) < 1 || (r.interval as number) > 99) throw bad("interval");
  if (typeof r.anchor !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.anchor)) throw bad("anchor");
  const rule: RepeatRule = { interval: r.interval as number, unit: r.unit as RepeatRule["unit"], anchor: r.anchor };
  if (r.unit === "week" && r.weekdays) {
    if (!Array.isArray(r.weekdays) || r.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw bad("weekdays");
    rule.weekdays = [...new Set(r.weekdays)].sort((x, y) => x - y);
  }
  if (r.unit === "month" && r.monthDay !== undefined) {
    if (!Number.isInteger(r.monthDay) || r.monthDay < 1 || r.monthDay > 31) throw bad("day of month");
    rule.monthDay = r.monthDay;
  }
  if (r.unit === "year") {
    if (r.yearMonth !== undefined && (!Number.isInteger(r.yearMonth) || r.yearMonth < 1 || r.yearMonth > 12)) throw bad("month");
    if (r.yearDay !== undefined && (!Number.isInteger(r.yearDay) || r.yearDay < 1 || r.yearDay > 31)) throw bad("day");
    if (r.yearMonth !== undefined) rule.yearMonth = r.yearMonth;
    if (r.yearDay !== undefined) rule.yearDay = r.yearDay;
  }
  return rule;
}
