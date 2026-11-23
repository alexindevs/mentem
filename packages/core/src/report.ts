import { addDays, dateOf, instantOf, weekdayOf, type LocalDate } from "./dates";
import type { Store } from "./store";

/**
 * The weekly report (PRD 7.12), worked out from the task history: when each task was first
 * assigned to a day of the week, when it was finished, and every time it was pushed.
 */

export interface ReportTask {
  id: string;
  title: string;
  done: boolean;
  /** Where it first went and where it went when it was first pushed, for the Rescheduled list. */
  move: { from: LocalDate; to: LocalDate } | null;
}

export type ProcrastinationLevel = "Low" | "Medium" | "High";

export interface WeeklyReport {
  weekStart: LocalDate;
  weekEnd: LocalDate;
  /** The week has not finished yet, so its numbers are partway, not a result. */
  inProgress: boolean;
  planned: number;
  done: number;
  unfinished: number;
  rescheduled: number;
  /** Share of planned tasks finished on the day they were first assigned, in percent. */
  onTimePct: number;
  onTimeCount: number;
  procrastination: { level: ProcrastinationLevel; pct: number; previousPct: number | null; change: number | null };
  mostRescheduled: { title: string; times: number } | null;
  bestTime: { weekday: number; block: string; onTime: number; total: number } | null;
  streak: { current: number; best: number };
  lists: { planned: ReportTask[]; done: ReportTask[]; rescheduled: ReportTask[]; unfinished: ReportTask[] };
}

interface EventRow {
  at: number;
  task_id: string;
  kind: string;
  from_date: string | null;
  to_date: string | null;
  to_slot: number | null;
}

const level = (pct: number): ProcrastinationLevel => (pct < 20 ? "Low" : pct <= 50 ? "Medium" : "High");

export function weeklyReport(store: Store, weekStart: LocalDate, depth = 0): WeeklyReport {
  const end = addDays(weekStart, 6);
  const lo = instantOf(weekStart, 0);
  const hi = instantOf(addDays(end, 1), 0);

  const events = store.db
    .prepare(
      "SELECT at, task_id, kind, from_date, to_date, to_slot FROM assignment_event WHERE (to_date BETWEEN ? AND ?) OR (from_date BETWEEN ? AND ?) ORDER BY at, id",
    )
    .all(weekStart, end, weekStart, end) as EventRow[];

  const first = new Map<string, { date: LocalDate; slot: number | null }>();
  const moves = new Map<string, Array<{ from: LocalDate; to: LocalDate }>>();
  for (const e of events) {
    // A move made before the day it moves the task from has arrived is planning, not slipping:
    // the plan simply becomes the new place, and nothing is logged as rescheduled.
    if ((e.kind === "moved" || e.kind === "rolled") && e.from_date && dateOf(e.at) < e.from_date) {
      const plan = first.get(e.task_id);
      if (plan && plan.date === e.from_date) {
        if (e.to_date && e.to_date >= weekStart && e.to_date <= end) first.set(e.task_id, { date: e.to_date, slot: e.to_slot });
        else first.delete(e.task_id);
      }
      if (!first.has(e.task_id) && e.to_date && e.to_date >= weekStart && e.to_date <= end) first.set(e.task_id, { date: e.to_date, slot: e.to_slot });
      continue;
    }
    if (e.to_date && e.to_date >= weekStart && e.to_date <= end && ["assigned", "moved", "rolled"].includes(e.kind) && !first.has(e.task_id)) first.set(e.task_id, { date: e.to_date, slot: e.to_slot });
    if ((e.kind === "moved" || e.kind === "rolled") && e.from_date && e.from_date >= weekStart && e.from_date <= end && e.to_date) {
      const list = moves.get(e.task_id) ?? [];
      list.push({ from: e.from_date, to: e.to_date });
      moves.set(e.task_id, list);
    }
  }

  // A task counts as planned once the day it is on has begun (PRD FR-68). Days still ahead are
  // not planned yet, so tomorrow's tasks are not misses.
  const today = dateOf(store.clock.now());
  const rows = [...first.keys()].flatMap((id) => {
    const task = store.getTask(id);
    return task && first.get(id)!.date <= today ? [{ task, first: first.get(id)!, moves: moves.get(id) ?? [] }] : [];
  });

  const finishedIn = (completedAt: number | null) => completedAt !== null && completedAt >= lo && completedAt < hi;
  const onTime = (r: (typeof rows)[number]) => {
    if (!finishedIn(r.task.completedAt)) return false;
    const day = dateOf(r.task.completedAt!);
    return day === r.first.date && (r.task.dueDate === null || day <= r.task.dueDate);
  };

  const toTask = (r: (typeof rows)[number]): ReportTask => ({ id: r.task.id, title: r.task.title, done: r.task.status === "done", move: r.moves[0] ?? null });
  const planned = rows.map(toTask);
  const done = rows.filter((r) => finishedIn(r.task.completedAt)).map(toTask);
  const rescheduled = rows.filter((r) => r.moves.length > 0).map(toTask);
  const unfinished = rows.filter((r) => !(r.task.status === "done" && (r.task.completedAt ?? Infinity) < hi)).map(toTask);

  const onTimeCount = rows.filter(onTime).length;
  const pct = rows.length ? Math.round((rescheduled.length / rows.length) * 100) : 0;
  let previousPct: number | null = null;
  if (depth === 0) {
    const before = weeklyReport(store, addDays(weekStart, -7), 1);
    previousPct = before.planned > 0 ? before.procrastination.pct : null;
  }

  const most = rows.filter((r) => r.moves.length > 0).sort((a, b) => b.moves.length - a.moves.length)[0];

  // Best time: the day and block where the biggest share of planned tasks were finished on time.
  const groups = new Map<string, { weekday: number; block: string; total: number; onTime: number }>();
  for (const r of rows) {
    const block = store.blocksFor(r.first.date).find((b) => b.slot === r.first.slot);
    if (!block) continue;
    const key = `${r.first.date}:${block.slot}`;
    const g = groups.get(key) ?? { weekday: weekdayOf(r.first.date), block: block.name, total: 0, onTime: 0 };
    g.total += 1;
    if (onTime(r)) g.onTime += 1;
    groups.set(key, g);
  }
  const best = [...groups.values()].filter((g) => g.total >= 3 && g.onTime > 0).sort((a, b) => b.onTime / b.total - a.onTime / a.total || b.total - a.total)[0];

  return {
    weekStart,
    weekEnd: end,
    inProgress: today >= weekStart && today <= end,
    planned: planned.length,
    done: done.length,
    unfinished: unfinished.length,
    rescheduled: rescheduled.length,
    onTimePct: rows.length ? Math.round((onTimeCount / rows.length) * 100) : 0,
    onTimeCount,
    procrastination: { level: level(pct), pct, previousPct, change: previousPct === null ? null : pct - previousPct },
    mostRescheduled: most ? { title: most.task.title, times: most.moves.length } : null,
    bestTime: best ? { weekday: best.weekday, block: best.block, onTime: best.onTime, total: best.total } : null,
    streak: depth === 0 ? streakEndingOn(store, end) : { current: 0, best: 0 },
    lists: { planned, done, rescheduled, unfinished },
  };
}

/** Whether every task planned for a day was finished on it. Null when nothing was planned. */
function dayCleared(store: Store, date: LocalDate): boolean | null {
  const events = store.db
    .prepare("SELECT at, task_id, kind, from_date, to_date FROM assignment_event WHERE to_date = ? OR from_date = ? ORDER BY at, id")
    .all(date, date) as EventRow[];
  const stayed = new Set<string>();
  let pushed = false;
  for (const e of events) {
    if (e.to_date === date && ["assigned", "moved", "rolled"].includes(e.kind)) stayed.add(e.task_id);
    if (e.from_date === date && ["moved", "rolled", "unassigned"].includes(e.kind)) {
      stayed.delete(e.task_id);
      // Moved away ahead of the day: planning, not a push.
      if (e.kind !== "unassigned" && dateOf(e.at) >= date) pushed = true;
    }
  }
  if (stayed.size === 0 && !pushed) return null;
  if (pushed) return false;
  return [...stayed].every((id) => store.getTask(id)?.status === "done");
}

/** Days in a row, ending on `end`, on which everything planned was done, and the best run so far. */
export function streakEndingOn(store: Store, end: LocalDate): { current: number; best: number } {
  let current = 0;
  let counting = true;
  let best = 0;
  let run = 0;
  for (let i = 0; i < 365; i += 1) {
    const result = dayCleared(store, addDays(end, -i));
    if (result === null) continue;
    if (result) {
      run += 1;
      best = Math.max(best, run);
      if (counting) current = run;
    } else {
      counting = false;
      run = 0;
    }
  }
  return { current, best };
}
