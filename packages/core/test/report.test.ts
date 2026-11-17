import { describe, expect, it } from "vitest";
import { runRollover } from "../src/rollover";
import { weeklyReport } from "../src/report";
import { at, makeStore, standardWeek } from "./helpers";

const MON = "2026-11-16";

describe("weekly report", () => {
  it("counts planned, done on time, and pushed tasks", () => {
    const { store, clock } = makeStore(at(2026, 11, 16, 8, 0));
    standardWeek(store);
    const a = store.createTask({ title: "A" });
    const b = store.createTask({ title: "B" });
    const c = store.createTask({ title: "C" });
    for (const t of [a, b, c]) store.assign(t.id, { date: MON, slot: 1 });
    clock.set(at(2026, 11, 16, 10, 0));
    store.setStatus(a.id, "done");
    store.assign(b.id, { date: "2026-11-18", slot: 1 });
    const r = weeklyReport(store, MON);
    expect(r).toMatchObject({ planned: 3, done: 1, unfinished: 2, rescheduled: 1, onTimeCount: 1, onTimePct: 33 });
    expect(r.lists.rescheduled[0]).toMatchObject({ title: "B", move: { from: MON, to: "2026-11-18" } });
    expect(r.procrastination).toMatchObject({ level: "Medium", pct: 33, previousPct: null });
    expect(r.mostRescheduled).toEqual({ title: "B", times: 1 });
  });

  it("counts a rollover as a push and compares with the week before", () => {
    const { store, clock } = makeStore(at(2026, 11, 9, 8, 0));
    standardWeek(store);
    const old = store.createTask({ title: "Old" });
    store.assign(old.id, { date: "2026-11-09", slot: 1 });
    store.setStatus(old.id, "done");
    const slip = store.createTask({ title: "Slip" });
    store.assign(slip.id, { date: MON, slot: 1 });
    clock.set(at(2026, 11, 17, 0, 5));
    runRollover(store);
    const r = weeklyReport(store, MON);
    expect(r.rescheduled).toBe(1);
    expect(r.procrastination.previousPct).toBe(0);
    expect(r.procrastination.change).toBe(100);
    expect(r.procrastination.level).toBe("High");
  });

  it("counts the days in a row that everything planned was done", () => {
    const { store, clock } = makeStore(at(2026, 11, 16, 8, 0));
    standardWeek(store);
    for (const day of ["2026-11-16", "2026-11-17"]) {
      const t = store.createTask({ title: day });
      store.assign(t.id, { date: day, slot: 1 });
      store.setStatus(t.id, "done");
    }
    clock.set(at(2026, 11, 18, 8, 0));
    expect(weeklyReport(store, MON).streak).toEqual({ current: 2, best: 2 });
  });
});
