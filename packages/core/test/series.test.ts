import { describe, expect, it } from "vitest";
import { describeRule, occursOn, occurrences, parseRule } from "../src/repeat";
import { runRollover } from "../src/rollover";
import { materializeRepeats } from "../src/series";
import { at, makeStore, standardWeek } from "./helpers";

const MON = "2026-11-16";

describe("rules by day and by every Nth", () => {
  it("repeats every day, every other day and every third day from the start date", () => {
    const every = { interval: 1, unit: "day" as const, anchor: MON };
    const other = { interval: 2, unit: "day" as const, anchor: MON };
    const third = { interval: 3, unit: "day" as const, anchor: MON };
    expect(occurrences(every, MON, "2026-11-19")).toEqual(["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19"]);
    expect(occurrences(other, MON, "2026-11-22")).toEqual(["2026-11-16", "2026-11-18", "2026-11-20", "2026-11-22"]);
    expect(occurrences(third, MON, "2026-11-28")).toEqual(["2026-11-16", "2026-11-19", "2026-11-22", "2026-11-25", "2026-11-28"]);
    expect(occursOn(third, "2026-11-15")).toBe(false);
  });

  it("repeats every third week and every sixth month", () => {
    const weeks = { interval: 3, unit: "week" as const, anchor: MON, weekdays: [0] };
    expect(occurrences(weeks, MON, "2027-01-31")).toEqual(["2026-11-16", "2026-12-07", "2026-12-28", "2027-01-18"]);
    const months = { interval: 6, unit: "month" as const, anchor: MON, monthDay: 16 };
    expect(occurrences(months, MON, "2027-12-31")).toEqual(["2026-11-16", "2027-05-16", "2027-11-16"]);
  });

  it("describes them in words", () => {
    expect(describeRule({ interval: 1, unit: "day", anchor: MON })).toBe("Every day");
    expect(describeRule({ interval: 2, unit: "day", anchor: MON })).toBe("Every other day");
    expect(describeRule({ interval: 3, unit: "day", anchor: MON })).toBe("Every 3 days");
    expect(describeRule({ interval: 3, unit: "week", anchor: MON, weekdays: [2, 0] })).toBe("Every 3rd week · Mon, Wed");
    expect(describeRule({ interval: 2, unit: "week", anchor: MON, weekdays: [0, 2, 4] })).toBe("Every other week · Mon, Wed, Fri");
    expect(describeRule({ interval: 22, unit: "month", anchor: MON, monthDay: 5 })).toBe("Every 22nd month · day 5");
  });

  it("checks a rule from outside and cleans it", () => {
    expect(parseRule({ interval: 3, unit: "day", anchor: MON, junk: true })).toEqual({ interval: 3, unit: "day", anchor: MON });
    expect(parseRule({ interval: 1, unit: "week", anchor: MON, weekdays: [4, 0, 4] }).weekdays).toEqual([0, 4]);
    for (const bad of [null, {}, { interval: 0, unit: "day", anchor: MON }, { interval: 100, unit: "day", anchor: MON }, { interval: 1.5, unit: "day", anchor: MON }, { interval: 1, unit: "hour", anchor: MON }, { interval: 1, unit: "day", anchor: "soon" }, { interval: 1, unit: "week", anchor: MON, weekdays: [9] }, { interval: 1, unit: "month", anchor: MON, monthDay: 40 }]) {
      expect(() => parseRule(bad)).toThrow(/Invalid repeat/);
    }
  });
});

describe("routine items that only show on some days", () => {
  it("shows an every-third-day item on the right days only", () => {
    const { store } = makeStore();
    const { weekday } = standardWeek(store);
    store.addRoutineItem(weekday.id, { title: "Water the plants", startMin: 8 * 60, endMin: 8 * 60 + 15, repeat: { interval: 3, unit: "day", anchor: MON } });
    store.addRoutineItem(weekday.id, { title: "Walk", startMin: 12 * 60, endMin: null });
    const shown = (d: string) => store.routineFor(d).map((r) => r.title);
    expect(shown("2026-11-16")).toEqual(["Water the plants", "Walk"]);
    expect(shown("2026-11-17")).toEqual(["Walk"]);
    expect(shown("2026-11-18")).toEqual(["Walk"]);
    expect(shown("2026-11-19")).toEqual(["Water the plants", "Walk"]);
  });

  it("can be changed to every other day later", () => {
    const { store } = makeStore();
    const { weekday } = standardWeek(store);
    const item = store.addRoutineItem(weekday.id, { title: "Stretch", startMin: 7 * 60, endMin: null });
    store.updateRoutineItem(item.id, { title: "Stretch", startMin: 7 * 60, endMin: null, repeat: { interval: 2, unit: "day", anchor: MON } });
    expect(store.routineFor("2026-11-17").map((r) => r.title)).toEqual([]);
    expect(store.routineFor("2026-11-18").map((r) => r.title)).toEqual(["Stretch"]);
    store.updateRoutineItem(item.id, { title: "Stretch", startMin: 7 * 60, endMin: null, repeat: null });
    expect(store.routineFor("2026-11-17").map((r) => r.title)).toEqual(["Stretch"]);
  });
});

describe("repeating tasks", () => {
  function weeklyStandup() {
    const ctx = makeStore(at(2026, 11, 16, 8, 0));
    standardWeek(ctx.store);
    const origin = ctx.store.createTask({ title: "Standup notes", notes: "Keep it short", steps: ["gather", "send"], estimatePomodoros: 1 });
    ctx.store.assign(origin.id, { date: MON, slot: 1, repeat: { interval: 1, unit: "week", anchor: MON, weekdays: [0, 2] } });
    return { ...ctx, origin };
  }

  it("makes a copy for each coming date, in the same block, with the same details", () => {
    const { store, origin } = weeklyStandup();
    const { created } = materializeRepeats(store, store.clock.now(), 14);
    expect(created).toBe(4);
    const dates = [...store.seriesDates(origin.id)].sort();
    expect(dates).toEqual(["2026-11-16", "2026-11-18", "2026-11-23", "2026-11-25", "2026-11-30"]);
    const copy = store.blockTasks("2026-11-18", 1)[0]!;
    expect(copy).toMatchObject({ title: "Standup notes", notes: "Keep it short", estimatePomodoros: 1, seriesId: origin.id, status: "open" });
    expect(copy.id).not.toBe(origin.id);
    expect(store.listSteps(copy.id).map((s) => s.text)).toEqual(["gather", "send"]);
    expect(store.blockTasks("2026-11-17", 1)).toEqual([]);
  });

  it("never makes the same copy twice, even after it was finished or moved", () => {
    const { store } = weeklyStandup();
    materializeRepeats(store);
    const wed = store.blockTasks("2026-11-18", 1)[0]!;
    store.setStatus(wed.id, "done");
    const next = store.blockTasks("2026-11-23", 1)[0]!;
    store.assign(next.id, { date: "2026-11-24", slot: 2 });
    expect(materializeRepeats(store).created).toBe(0);
    expect(store.blockTasks("2026-11-23", 1)).toEqual([]);
    expect(store.blockTasks("2026-11-24", 2)).toHaveLength(1);
  });

  it("keeps going as days pass, and skips days it missed", () => {
    const { store, clock } = weeklyStandup();
    materializeRepeats(store);
    clock.set(at(2026, 12, 7, 8, 0));
    const { created } = materializeRepeats(store);
    // 7, 9, 14, 16 and 21 December.
    expect(created).toBe(5);
    expect(store.blockTasks("2026-12-07", 1)).toHaveLength(1);
    expect(store.blockTasks("2026-11-30", 1)).toHaveLength(1);
  });

  it("stops when the series ends, and when the first task is deleted", () => {
    const { store, origin } = weeklyStandup();
    materializeRepeats(store);
    store.endSeries(origin.id);
    expect(materializeRepeats(store, at(2026, 12, 20, 8, 0).getTime()).created).toBe(0);
    store.startSeries(origin.id, 1, { interval: 1, unit: "day", anchor: "2026-12-20" });
    store.deleteTask(origin.id);
    expect(materializeRepeats(store, at(2026, 12, 20, 8, 0).getTime()).created).toBe(0);
    expect(store.getSeries(origin.id)?.active).toBe(false);
  });

  it("skips a day whose template has no such block, and fills it in if that changes", () => {
    const ctx = makeStore(at(2026, 11, 16, 8, 0));
    const { weekend } = standardWeek(ctx.store);
    const origin = ctx.store.createTask({ title: "Evening review" });
    ctx.store.assign(origin.id, { date: MON, slot: 2, repeat: { interval: 1, unit: "day", anchor: MON } });
    materializeRepeats(ctx.store, ctx.clock.now(), 6);
    // Saturday and Sunday use Weekend, which has only one block, so nothing was made for them.
    expect(ctx.store.blockTasks("2026-11-21", 2)).toEqual([]);
    expect(ctx.store.blockTasks("2026-11-20", 2)).toHaveLength(1);
    expect(weekend.blocks).toHaveLength(1);
  });

  it("does not put a copy in a block that has already ended today", () => {
    const ctx = makeStore(at(2026, 11, 16, 13, 0));
    standardWeek(ctx.store);
    const origin = ctx.store.createTask({ title: "Morning job" });
    ctx.store.assign(origin.id, { date: "2026-11-15", slot: 1, repeat: { interval: 1, unit: "day", anchor: "2026-11-15" } });
    materializeRepeats(ctx.store, ctx.clock.now(), 1);
    expect(ctx.store.blockTasks(MON, 1)).toEqual([]);
    expect(ctx.store.blockTasks("2026-11-17", 1)).toHaveLength(1);
  });

  it("makes copies that roll over like any other task", () => {
    const { store, clock } = weeklyStandup();
    materializeRepeats(store);
    clock.set(at(2026, 11, 18, 13, 0));
    runRollover(store);
    const copy = store.listTasks().find((t) => t.seriesId && store.getAssignment(t.id)?.date === "2026-11-18");
    expect(copy?.status).toBe("open");
    expect(store.getAssignment(copy!.id)?.slot).toBe(2);
  });
});
