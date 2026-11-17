import { FakeClock } from "../src/clock";
import { openDatabase } from "../src/db/open";
import { Store } from "../src/store";

/** 2026-11-16 is a Monday. Months in Date are 0-based. */
export const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min, 0, 0);

export function makeStore(now: Date = at(2026, 11, 16, 8, 0)) {
  const clock = new FakeClock(now);
  const { db } = openDatabase(":memory:", { clock });
  const store = new Store(db, clock);
  return { store, clock, close: () => db.close() };
}

/** Weekday (Mon-Fri: Morning 9-12, Afternoon 13-17) and Weekend (Sat-Sun: Afternoon 13-17). */
export function standardWeek(store: Store) {
  const weekday = store.createTemplate({
    name: "Weekday",
    blocks: [
      { slot: 1, name: "Morning", startHour: 9, endHour: 12 },
      { slot: 2, name: "Afternoon", startHour: 13, endHour: 17 },
    ],
  });
  const weekend = store.createTemplate({
    name: "Weekend",
    blocks: [{ slot: 1, name: "Afternoon", startHour: 13, endHour: 17 }],
  });
  store.setSchedule([0, 1, 2, 3, 4], weekday.id);
  store.setSchedule([5, 6], weekend.id);
  return { weekday, weekend };
}
