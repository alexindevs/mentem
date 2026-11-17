import { addDays, dateOf, weekdayOf, type LocalDate } from "./dates";
import { blockCapacity } from "./schedule";
import type { Store } from "./store";
import type { DayBlock, Slot } from "./types";

export interface Move {
  taskId: string;
  from: { date: LocalDate; slot: Slot };
  /** null means the task went back to Unscheduled (it was the end of the week). */
  to: { date: LocalDate; slot: Slot } | null;
}

export interface UndoToken {
  date: LocalDate;
  previousOverride: string | null;
  before: Array<{ taskId: string; date: LocalDate; slot: Slot; position: number }>;
  eventRange: [number, number];
}

export interface TemplateChangeResult {
  moved: Move[];
  unchanged: number;
  undo: UndoToken;
}

export interface ChangeOptions {
  now?: number;
  /** Respect block capacity (default true). Over-full blocks push tasks on. */
  enforceCapacity?: boolean;
}

const maxEventId = (store: Store): number =>
  (store.db.prepare("SELECT COALESCE(MAX(id), 0) AS m FROM assignment_event").get() as { m: number }).m;

/**
 * Sets a date to use a different template and redistributes that date's tasks (FR-6a):
 *  - a task keeps the block of the same name if the new template has one;
 *  - otherwise it moves to the nearest remaining block, earlier first, then later;
 *  - order is preserved;
 *  - block capacity is respected (a task without an estimate counts as one pomodoro);
 *  - tasks that fit nowhere that day roll forward like an ended day (or go to Unscheduled
 *    on the week-end day);
 *  - dates in the past are left alone.
 * Returns a summary of what moved and a token that undoes the whole change.
 */
export function changeDateTemplate(
  store: Store,
  date: LocalDate,
  newTemplateId: string | null,
  options: ChangeOptions = {},
): TemplateChangeResult {
  const now = options.now ?? store.clock.now();
  const enforce = options.enforceCapacity ?? true;
  const settings = store.getSettings();
  const cfg = {
    pomodoroMinutes: settings.pomodoroMinutes,
    shortBreakMinutes: settings.shortBreakMinutes,
    longBreakMinutes: settings.longBreakMinutes,
    cyclesBeforeLongBreak: settings.cyclesBeforeLongBreak,
  };

  return store.transaction(() => {
    const previousOverride = store.getDateOverride(date);
    const oldBlocks = store.blocksFor(date);
    const assignments = store.listDate(date);
    const before = assignments.map((a) => ({ taskId: a.taskId, date: a.date, slot: a.slot, position: a.position }));
    const eventLo = maxEventId(store);

    store.setDateTemplateRaw(date, newTemplateId);
    const newBlocks = store.blocksFor(date);

    // Past dates are history: their tasks stay where they were. Today and future dates are redistributed.
    const today = dateOf(now);
    const locked = new Set<Slot>();
    if (date < today) oldBlocks.forEach((b) => locked.add(b.slot));

    const oldBySlot = new Map(oldBlocks.map((b) => [b.slot, b]));
    const movable = assignments
      .filter((a) => !locked.has(a.slot))
      .sort((a, b) => {
        const sa = oldBySlot.get(a.slot)?.startMin ?? a.slot * 1000;
        const sb = oldBySlot.get(b.slot)?.startMin ?? b.slot * 1000;
        return sa - sb || a.position - b.position || a.createdAt - b.createdAt;
      });

    const targetFor = (slot: Slot): DayBlock | null => {
      if (newBlocks.length === 0) return null;
      const old = oldBySlot.get(slot);
      if (!old) return newBlocks[0]!;
      const sameName = newBlocks.find((b) => b.name.trim().toLowerCase() === old.name.trim().toLowerCase());
      if (sameName) return sameName;
      const earlier = [...newBlocks].filter((b) => b.startMin <= old.startMin).pop();
      if (earlier) return earlier;
      return newBlocks.find((b) => b.startMin > old.startMin) ?? newBlocks[0]!;
    };

    const capacity = new Map<Slot, number>(newBlocks.map((b) => [b.slot, blockCapacity(b.startHour, b.endHour, cfg)]));
    const used = new Map<Slot, number>(newBlocks.map((b) => [b.slot, 0]));
    // Locked blocks' tasks still occupy their blocks when those blocks exist in the new template.
    for (const a of assignments.filter((x) => locked.has(x.slot))) {
      if (used.has(a.slot)) used.set(a.slot, used.get(a.slot)! + (store.getTask(a.taskId)?.estimatePomodoros ?? 1));
    }

    const placed = new Map<Slot, string[]>(newBlocks.map((b) => [b.slot, []]));
    const rolled: Array<{ taskId: string; from: { date: LocalDate; slot: Slot } }> = [];

    for (const a of movable) {
      const cost = store.getTask(a.taskId)?.estimatePomodoros ?? 1;
      const preferred = targetFor(a.slot);
      let chosen: DayBlock | null = null;
      if (preferred) {
        const fits = (b: DayBlock) =>
          !enforce || used.get(b.slot)! === 0 || used.get(b.slot)! + cost <= capacity.get(b.slot)!;
        if (fits(preferred)) chosen = preferred;
        else chosen = newBlocks.find((b) => b.startMin > preferred.startMin && fits(b)) ?? null;
      }
      if (chosen) {
        used.set(chosen.slot, used.get(chosen.slot)! + cost);
        placed.get(chosen.slot)!.push(a.taskId);
      } else {
        rolled.push({ taskId: a.taskId, from: { date: a.date, slot: a.slot } });
      }
    }

    const moved: Move[] = [];
    let unchanged = 0;
    const bySlot = new Map(assignments.map((a) => [a.taskId, a.slot]));
    const sameBlock = (oldSlot: Slot, b: DayBlock): boolean => {
      const old = oldBySlot.get(oldSlot);
      return !!old && old.name.trim().toLowerCase() === b.name.trim().toLowerCase();
    };
    for (const b of newBlocks) {
      const ids = placed.get(b.slot)!;
      // Keep tasks from locked blocks (same slot) ahead of newly placed ones.
      const lockedHere = assignments.filter((a) => locked.has(a.slot) && a.slot === b.slot).map((a) => a.taskId);
      const order = [...lockedHere, ...ids];
      order.forEach((taskId, i) => {
        const fromSlot = bySlot.get(taskId)!;
        if (lockedHere.includes(taskId)) return;
        // The block's identity decides whether this is a real move. Re-numbering the same
        // block (Afternoon slot 2 becoming slot 1) is not one and writes no history.
        store.reslot(taskId, { date, slot: b.slot, position: i });
        if (sameBlock(fromSlot, b)) {
          unchanged += 1;
        } else {
          store.recordEvent(taskId, "moved", { fromDate: date, fromSlot, toDate: date, toSlot: b.slot }, "template_change");
          moved.push({ taskId, from: { date, slot: fromSlot }, to: { date, slot: b.slot } });
        }
      });
    }

    // Roll forward whatever did not fit.
    if (rolled.length > 0) {
      const dest = nextDayFirstBlock(store, date, settings.weekEndDay);
      for (const r of rolled.reverse()) {
        if (!dest) {
          store.unassign(r.taskId, "template_change");
          moved.push({ taskId: r.taskId, from: r.from, to: null });
        } else {
          store.assign(r.taskId, { date: dest.date, slot: dest.slot, position: "start" }, "template_change");
          moved.push({ taskId: r.taskId, from: r.from, to: dest });
        }
      }
    }

    return {
      moved,
      unchanged,
      undo: { date, previousOverride, before, eventRange: [eventLo, maxEventId(store)] },
    };
  });
}

function nextDayFirstBlock(store: Store, date: LocalDate, weekEndDay: number): { date: LocalDate; slot: Slot } | null {
  if (weekdayOf(date) === weekEndDay) return null;
  for (let i = 1; i <= 14; i++) {
    const d = addDays(date, i);
    const blocks = store.blocksFor(d);
    if (blocks.length > 0) return { date: d, slot: blocks[0]!.slot };
    if (weekdayOf(d) === weekEndDay) return null;
  }
  return null;
}

/** Reverses a template change: the override, every task's place, and the history it wrote. */
export function undoTemplateChange(store: Store, token: UndoToken): void {
  store.transaction(() => {
    store.setDateTemplateRaw(token.date, token.previousOverride);
    for (const b of token.before) {
      const cur = store.getAssignment(b.taskId);
      if (cur && cur.date === b.date && cur.slot === b.slot && cur.position === b.position) continue;
      store.assign(b.taskId, { date: b.date, slot: b.slot, position: b.position }, "template_change");
    }
    store.db
      .prepare("DELETE FROM assignment_event WHERE id > ? AND id <= ? AND reason = 'template_change'")
      .run(token.eventRange[0], store.db.prepare("SELECT COALESCE(MAX(id), 0) AS m FROM assignment_event").pluck().get() as number);
  });
}
