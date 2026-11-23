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

describe("moves made before the day arrives", () => {
  it("are planning, not rescheduling: the plan just becomes the new place", () => {
    const { store, clock } = makeStore(at(2026, 11, 16, 8, 0));
    standardWeek(store);
    const t = store.createTask({ title: "Planned ahead" });
    store.assign(t.id, { date: "2026-11-18", slot: 1 });
    // Tuesday: the task is moved from Wednesday to Thursday, and between blocks on Thursday.
    clock.set(at(2026, 11, 17, 9, 0));
    store.assign(t.id, { date: "2026-11-19", slot: 1 });
    store.assign(t.id, { date: "2026-11-19", slot: 2 });
    // Judged once Thursday, the day it ended up on, has begun.
    clock.set(at(2026, 11, 19, 12, 0));
    const r = weeklyReport(store, MON);
    expect(r).toMatchObject({ planned: 1, rescheduled: 0, unfinished: 1 });
    expect(r.lists.rescheduled).toEqual([]);
    expect(r.mostRescheduled).toBeNull();
    expect(r.procrastination.pct).toBe(0);
  });

  it("still counts a move made on the day itself, or after it", () => {
    const { store, clock } = makeStore(at(2026, 11, 16, 8, 0));
    standardWeek(store);
    const t = store.createTask({ title: "Slipped" });
    store.assign(t.id, { date: "2026-11-18", slot: 1 });
    clock.set(at(2026, 11, 18, 11, 0));
    store.assign(t.id, { date: "2026-11-19", slot: 1 });
    const r = weeklyReport(store, MON);
    expect(r.rescheduled).toBe(1);
    expect(r.lists.rescheduled[0]).toMatchObject({ title: "Slipped", move: { from: "2026-11-18", to: "2026-11-19" } });
  });

  it("does not stop a day with only planning changes from counting as cleared, or count it as pushed", () => {
    const { store, clock } = makeStore(at(2026, 11, 16, 8, 0));
    standardWeek(store);
    const moved = store.createTask({ title: "Moved ahead" });
    store.assign(moved.id, { date: "2026-11-17", slot: 1 });
    const kept = store.createTask({ title: "Kept" });
    store.assign(kept.id, { date: "2026-11-17", slot: 1 });
    clock.set(at(2026, 11, 16, 20, 0));
    store.assign(moved.id, { date: "2026-11-19", slot: 1 });
    clock.set(at(2026, 11, 17, 10, 0));
    store.setStatus(kept.id, "done");
    clock.set(at(2026, 11, 18, 8, 0));
    expect(weeklyReport(store, MON).streak.best).toBeGreaterThanOrEqual(1);
  });
});

describe("a week that is still going on", () => {
  it("leaves the days that have not started out of the numbers", () => {
    const { store, clock } = makeStore(at(2026, 11, 16, 8, 0));
    standardWeek(store);
    const today = store.createTask({ title: "Today" });
    store.assign(today.id, { date: "2026-11-16", slot: 1 });
    store.setStatus(today.id, "done");
    for (const title of ["a", "b", "c"]) {
      const t = store.createTask({ title });
      store.assign(t.id, { date: "2026-11-17", slot: 2 });
    }
    clock.set(at(2026, 11, 16, 14, 0));
    const r = weeklyReport(store, MON);
    expect(r).toMatchObject({ inProgress: true, planned: 1, done: 1, unfinished: 0, onTimeCount: 1, onTimePct: 100 });
    expect(r.bestTime).toBeNull();
    // Once Tuesday has begun, its tasks count as planned.
    clock.set(at(2026, 11, 17, 9, 0));
    expect(weeklyReport(store, MON)).toMatchObject({ planned: 4, unfinished: 3, onTimePct: 25 });
  });

  it("marks a week as in progress only until it ends", () => {
    const { store, clock } = makeStore(at(2026, 11, 16, 8, 0));
    standardWeek(store);
    expect(weeklyReport(store, MON).inProgress).toBe(true);
    clock.set(at(2026, 11, 23, 9, 0));
    expect(weeklyReport(store, MON).inProgress).toBe(false);
    expect(weeklyReport(store, "2026-11-23").inProgress).toBe(true);
    expect(weeklyReport(store, "2026-11-30").inProgress).toBe(false);
  });

  it("names a best time only when something was finished on time in it", () => {
    const { store, clock } = makeStore(at(2026, 11, 16, 8, 0));
    standardWeek(store);
    for (const title of ["a", "b", "c"]) {
      const t = store.createTask({ title });
      store.assign(t.id, { date: "2026-11-16", slot: 1 });
    }
    clock.set(at(2026, 11, 18, 9, 0));
    expect(weeklyReport(store, MON).bestTime).toBeNull();
    const [first] = store.listBlock("2026-11-16", 1);
    clock.set(at(2026, 11, 16, 11, 0));
    store.setStatus(first!.taskId, "done");
    clock.set(at(2026, 11, 18, 9, 0));
    expect(weeklyReport(store, MON).bestTime).toMatchObject({ weekday: 0, block: "Morning", onTime: 1, total: 3 });
  });
});
