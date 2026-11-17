import { addDays, dateOf, instantOf, minutesOfDay, weekdayOf, type LocalDate } from "./dates";
import type { Store } from "./store";
import type { DayBlock, Slot } from "./types";

export interface RolloverResult {
  /** Tasks moved to a later block or day. */
  moved: Array<{ taskId: string; from: { date: LocalDate; slot: Slot }; to: { date: LocalDate; slot: Slot } }>;
  /** Tasks sent back to Unscheduled at the end of the week. */
  unscheduled: Array<{ taskId: string; from: { date: LocalDate; slot: Slot } }>;
  blocksProcessed: number;
}

const MAX_DAY_SEARCH = 14;

/**
 * Whether a work block ended between two moments, or so many days passed that one surely did.
 * The running app uses it to run rollover when a block ends, and not at any other time, so a
 * task that was moved back into a finished block stays where it was put.
 */
export function blockEndedBetween(store: Store, fromMs: number, toMs: number): boolean {
  if (toMs <= fromMs) return false;
  const last = dateOf(toMs);
  let day = dateOf(fromMs);
  for (let guard = 0; guard < 8; guard += 1) {
    for (const block of store.blocksFor(day)) {
      const end = instantOf(day, block.endMin);
      if (end > fromMs && end <= toMs) return true;
    }
    if (day === last) return false;
    day = addDays(day, 1);
  }
  return true;
}

/**
 * Moves open tasks out of blocks that have ended (FR-31 to FR-35):
 *  - to the next block the same day;
 *  - after the last block, to the first block of the next day that has blocks;
 *  - after the last block of the week-end day, back to Unscheduled.
 * Done tasks stay where they are and nothing is ever marked done. It is safe to run any
 * number of times and to catch up after the app was closed: each task moves once, straight
 * to the first block that has not ended yet, so the history records one move per task.
 */
export function runRollover(store: Store, now: number = store.clock.now()): RolloverResult {
  const today = dateOf(now);
  const nowMin = minutesOfDay(now);
  const weekEndDay = store.getSettings().weekEndDay;
  const result: RolloverResult = { moved: [], unscheduled: [], blocksProcessed: 0 };

  const blocksCache = new Map<LocalDate, DayBlock[]>();
  const blocksOf = (date: LocalDate): DayBlock[] => {
    let b = blocksCache.get(date);
    if (!b) {
      b = store.blocksFor(date);
      blocksCache.set(date, b);
    }
    return b;
  };
  /** A block has ended once its date is past, or its end time has passed today. A block that no longer exists counts as ended. */
  const isEnded = (date: LocalDate, slot: Slot): boolean => {
    if (date < today) return true;
    if (date > today) return false;
    const block = blocksOf(date).find((b) => b.slot === slot);
    return !block || block.endMin <= nowMin;
  };

  /** First block after (date, slot) that has not ended, or null if the week ends first. */
  const nextOpenBlock = (date: LocalDate, slot: Slot): { date: LocalDate; slot: Slot } | null => {
    let d = date;
    let s = slot;
    for (let guard = 0; guard < 400; guard++) {
      const blocks = blocksOf(d);
      const next = blocks.find((b) => b.slot > s);
      if (next) {
        if (isEnded(d, next.slot)) {
          s = next.slot;
          continue;
        }
        return { date: d, slot: next.slot };
      }
      // No later block today: the day is over.
      if (weekdayOf(d) === weekEndDay) return null;
      let found: LocalDate | null = null;
      for (let i = 1; i <= MAX_DAY_SEARCH; i++) {
        const cand = addDays(d, i);
        if (blocksOf(cand).length > 0) {
          found = cand;
          break;
        }
        if (weekdayOf(cand) === weekEndDay) return null; // the week ended on a day off
      }
      if (!found) return null;
      const first = blocksOf(found)[0]!;
      if (isEnded(found, first.slot)) {
        d = found;
        s = first.slot;
        continue;
      }
      return { date: found, slot: first.slot };
    }
    return null;
  };

  const candidates = store.db
    .prepare("SELECT DISTINCT date, slot FROM assignment WHERE date <= ? ORDER BY date DESC, slot DESC")
    .all(today) as Array<{ date: LocalDate; slot: Slot }>;

  store.transaction(() => {
    // Latest block first, so that older tasks end up ahead of newer ones in the destination.
    for (const { date, slot } of candidates) {
      if (!isEnded(date, slot)) continue;
      const open = store
        .listBlock(date, slot)
        .filter((a) => store.getTask(a.taskId)?.status !== "done");
      if (open.length === 0) continue;
      result.blocksProcessed += 1;
      for (const a of [...open].reverse()) {
        const dest = nextOpenBlock(date, slot);
        if (!dest) {
          store.unassign(a.taskId, "rollover");
          result.unscheduled.push({ taskId: a.taskId, from: { date, slot } });
        } else {
          store.assign(a.taskId, { date: dest.date, slot: dest.slot, position: "start" }, "rollover");
          result.moved.push({ taskId: a.taskId, from: { date, slot }, to: dest });
        }
      }
      store.db.prepare("INSERT OR IGNORE INTO rollover_log(date, slot, processed_at) VALUES(?,?,?)").run(date, slot, now);
    }
    // Moves happened newest block first; put the moved list in reading order.
    result.moved.reverse();
    result.unscheduled.reverse();
  });
  return result;
}
