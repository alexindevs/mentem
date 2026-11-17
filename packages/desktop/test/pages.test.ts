import { afterEach, describe, expect, it } from "vitest";
import * as core from "@mentem/core";
import { FakeClock, Store, TimerEngine, openDatabase } from "@mentem/core";
import { createPageApi } from "../src/main/pages";

const open: Array<{ close(): void }> = [];
afterEach(() => open.splice(0).forEach((db) => db.close()));

/** Tuesday 17 November 2026, 10:00, with Weekday (Mon-Fri) and Weekend (Sat-Sun). */
function setup() {
  const clock = new FakeClock(new Date(2026, 10, 17, 10, 0));
  const { db } = openDatabase(":memory:", { clock });
  open.push(db);
  const store = new Store(db, clock);
  const weekday = store.createTemplate({
    name: "Weekday",
    blocks: [
      { slot: 1, name: "Morning", startHour: 9, endHour: 12 },
      { slot: 2, name: "Afternoon", startHour: 13, endHour: 17 },
    ],
  });
  const weekend = store.createTemplate({ name: "Weekend", blocks: [{ slot: 1, name: "Afternoon", startHour: 13, endHour: 17 }] });
  store.setSchedule([0, 1, 2, 3, 4], weekday.id);
  store.setSchedule([5, 6], weekend.id);
  let refreshed = 0;
  const api = createPageApi({ store, engine: new TimerEngine(store, clock), core, refresh: () => (refreshed += 1) });
  return { store, clock, api, weekday, weekend, refreshed: () => refreshed };
}

describe("placing tasks", () => {
  it("puts a task on a day that has not passed", async () => {
    const { api, store } = setup();
    const t = store.createTask({ title: "Plan" });
    const detail = await api.taskPlace(t.id, "2026-11-18", 1);
    expect(detail.assigned).toMatchObject({ date: "2026-11-18", slot: 1, slotName: "Morning" });
  });

  it("refuses a day that has already passed", async () => {
    const { api, store } = setup();
    const t = store.createTask({ title: "Plan" });
    await expect(api.taskPlace(t.id, "2026-11-16", 1)).rejects.toThrow("That day has passed");
    expect(store.getAssignment(t.id)).toBeUndefined();
  });

  it("can put a task back in Unscheduled", async () => {
    const { api, store } = setup();
    const t = store.createTask({ title: "Plan" });
    await api.taskPlace(t.id, "2026-11-17", 2);
    const detail = await api.taskPlace(t.id, null, null);
    expect(detail.assigned).toBeNull();
  });

  it("rejects ids and dates that could not be real", async () => {
    const { api } = setup();
    await expect(api.taskGet("x; DROP TABLE task")).rejects.toThrow("Invalid id");
    await expect(api.taskPlace("abcd", "tomorrow", 1)).rejects.toThrow("Invalid date");
  });
});

describe("the week", () => {
  it("marks days that have passed, and today", async () => {
    const { api } = setup();
    const week = await api.weekGet(0);
    expect(week.label).toBe("16 – 22 November");
    expect(week.days.map((d) => d.past)).toEqual([true, false, false, false, false, false, false]);
    expect(week.days.find((d) => d.isToday)?.date).toBe("2026-11-17");
    expect(week.days[6]).toMatchObject({ isWeekEnd: true, template: "Weekend", summary: "Up 7:00 · Afternoon" });
  });

  it("moves between weeks", async () => {
    const { api } = setup();
    expect((await api.weekGet(1)).days[0]?.date).toBe("2026-11-23");
    expect((await api.weekGet(-1)).days[0]?.date).toBe("2026-11-09");
  });

  it("changes a day's template, moves its tasks, and undoes it", async () => {
    const { api, store, weekday, weekend } = setup();
    const t = store.createTask({ title: "Morning job" });
    store.assign(t.id, { date: "2026-11-18", slot: 1 });
    const result = await api.dayTemplateSet("2026-11-18", weekend.id);
    expect(result).toMatchObject({ canUndo: true });
    expect(store.templateIdFor("2026-11-18")).toBe(weekend.id);
    expect(store.getAssignment(t.id)?.slot).toBe(1);
    await api.dayTemplateUndo();
    expect(store.templateIdFor("2026-11-18")).toBe(weekday.id);
    expect(store.getAssignment(t.id)).toMatchObject({ date: "2026-11-18", slot: 1 });
  });
});

describe("task details", () => {
  it("edits fields, steps and subtasks", async () => {
    const { api, store } = setup();
    const t = store.createTask({ title: "Draft" });
    let d = await api.taskUpdate(t.id, { title: "Draft the email", due: "2026-11-20", estimate: 4, notes: "Warm tone" });
    expect(d).toMatchObject({ title: "Draft the email", due: "2026-11-20", estimate: 4, notes: "Warm tone" });
    d = await api.stepAdd(t.id, "Open the draft");
    d = await api.stepToggle(t.id, d.steps[0]!.id, true);
    expect(d.steps).toEqual([{ id: d.steps[0]!.id, text: "Open the draft", done: true }]);
    d = await api.subtaskAdd(t.id, "Write the body");
    expect(d.subtasks).toMatchObject([{ title: "Write the body", done: false, depth: 1 }]);
    d = await api.subtaskToggle(t.id, d.subtasks[0]!.id, true);
    expect(d.subtasks[0]?.done).toBe(true);
  });

  it("records when it was finished", async () => {
    const { api, store, clock } = setup();
    const t = store.createTask({ title: "Quick" });
    clock.set(new Date(2026, 10, 17, 11, 30));
    await api.taskUpdate(t.id, { status: "done" });
    expect(store.getTask(t.id)).toMatchObject({ status: "done", completedAt: new Date(2026, 10, 17, 11, 30).getTime() });
  });

  it("refuses an empty title and an out-of-range estimate", async () => {
    const { api, store } = setup();
    const t = store.createTask({ title: "Draft" });
    await expect(api.taskUpdate(t.id, { title: "  " })).rejects.toThrow();
    await expect(api.taskUpdate(t.id, { estimate: 500 })).rejects.toThrow();
  });
});

describe("templates", () => {
  it("saves blocks, routine items and the days a template runs", async () => {
    const { api, store, weekday } = setup();
    const before = (await api.templatesGet()).templates.find((t) => t.id === weekday.id)!;
    expect(before).toMatchObject({ name: "Weekday", summary: "Mon to Fri" });
    const edited = {
      ...before,
      name: "Office",
      wakeMin: 6 * 60 + 30,
      blocks: before.blocks.map((b, i) => (i === 2 ? { ...b, enabled: true, startHour: 18.25, endHour: 20 } : b)),
      routine: [...before.routine, { title: "Walk", startMin: 12 * 60, endMin: 12 * 60 + 30, repeat: null }],
      weekdays: [0, 1, 2],
    };
    const after = (await api.templateSave(edited)).templates.find((t) => t.id === weekday.id)!;
    expect(after).toMatchObject({ name: "Office", wakeMin: 390, summary: "Mon to Wed" });
    expect(after.blocks[2]).toMatchObject({ enabled: true, startHour: 18.25, endHour: 20 });
    expect(after.routine.map((r) => r.title)).toContain("Walk");
    expect(store.templateIdFor("2026-11-19")).toBeNull();
  });

  it("refuses a bed time before the wake time", async () => {
    const { api, weekday } = setup();
    const t = (await api.templatesGet()).templates.find((x) => x.id === weekday.id)!;
    await expect(api.templateSave({ ...t, wakeMin: 600, bedMin: 500 })).rejects.toThrow("Bed time must be after wake time");
  });

  it("makes a copy and deletes a template, clearing the days it ran on", async () => {
    const { api, store, weekend } = setup();
    const made = await api.templateNew();
    expect(made.templates.map((t) => t.name)).toContain("New template");
    await api.templateDelete(weekend.id);
    expect(store.templateIdFor("2026-11-21")).toBeNull();
  });
});

describe("more than three work blocks", () => {
  it("saves a fourth block and keeps tasks in the block they were in", async () => {
    const { api, store, weekday } = setup();
    const am = store.createTask({ title: "Morning job" });
    const pm = store.createTask({ title: "Afternoon job" });
    store.assign(am.id, { date: "2026-11-18", slot: 1 });
    store.assign(pm.id, { date: "2026-11-18", slot: 2 });
    const t = (await api.templatesGet()).templates.find((x) => x.id === weekday.id)!;
    expect(t.blocks.map((b) => [b.name, b.enabled])).toEqual([["Morning", true], ["Afternoon", true], ["Evening", false]]);
    const edited = {
      ...t,
      blocks: [
        { name: "Early", enabled: true, startHour: 6, endHour: 8 },
        ...t.blocks.map((b) => (b.name === "Evening" ? { ...b, enabled: true, startHour: 19, endHour: 21 } : b)),
        { name: "Late", enabled: true, startHour: 21, endHour: 23 },
      ],
    };
    const after = (await api.templateSave(edited)).templates.find((x) => x.id === weekday.id)!;
    expect(after.blocks.filter((b) => b.enabled).map((b) => b.name)).toEqual(["Morning", "Afternoon", "Evening", "Late", "Early"].sort((a, b) => edited.blocks.find((x) => x.name === a)!.startHour - edited.blocks.find((x) => x.name === b)!.startHour));
    expect(store.blocksFor("2026-11-18").map((b) => b.name)).toEqual(["Early", "Morning", "Afternoon", "Evening", "Late"]);
    expect(store.getAssignment(am.id)?.slot).toBe(2);
    expect(store.getAssignment(pm.id)?.slot).toBe(3);
  });

  it("lets a task be put in the fifth block", async () => {
    const { api, store, weekday } = setup();
    const t = (await api.templatesGet()).templates.find((x) => x.id === weekday.id)!;
    await api.templateSave({
      ...t,
      blocks: [
        ...t.blocks.map((b) => (b.name === "Evening" ? { ...b, enabled: true, startHour: 19, endHour: 20 } : b)),
        { name: "Night", enabled: true, startHour: 20, endHour: 21 },
        { name: "Late", enabled: true, startHour: 21, endHour: 22 },
      ],
    });
    const task = store.createTask({ title: "Late thing" });
    const detail = await api.taskPlace(task.id, "2026-11-18", 5);
    expect(detail.assigned).toMatchObject({ slot: 5, slotName: "Late" });
    await expect(api.taskPlace(task.id, "2026-11-18", 13)).rejects.toThrow("Invalid block");
    await expect(api.taskPlace(task.id, "2026-11-18", 0)).rejects.toThrow("Invalid block");
  });

  it("refuses two blocks with the same name", async () => {
    const { api, weekday } = setup();
    const t = (await api.templatesGet()).templates.find((x) => x.id === weekday.id)!;
    await expect(api.templateSave({ ...t, blocks: [...t.blocks, { name: "morning", enabled: true, startHour: 20, endHour: 21 }] })).rejects.toThrow("different names");
  });
});

describe("projects", () => {
  it("creates a project with deliverables and counts its tasks", async () => {
    const { api, store } = setup();
    const cards = await api.projectCreate({ name: "Launch", description: "Ship it", context: "Warm tone", deliverables: [{ type: "milestone", title: "Beta" }] });
    const id = cards[0]!.id;
    let detail = await api.projectTaskAdd(id, store.listDeliverables(id)[0]!.id, "Write the notes");
    expect(detail).toMatchObject({ name: "Launch", done: 0, total: 1 });
    expect(detail.groups[0]).toMatchObject({ title: "Beta", type: "milestone" });
    store.setStatus(detail.groups[0]!.tasks[0]!.id, "done");
    detail = await api.projectGet(id);
    expect(detail).toMatchObject({ done: 1, total: 1 });
    expect((await api.projectContextSet(id, "New context")).context).toBe("New context");
  });
});

describe("repeating", () => {
  it("makes a task come back, and shows how in the drawer", async () => {
    const { api, store } = setup();
    const t = store.createTask({ title: "Standup notes" });
    await expect(api.taskRepeatSet(t.id, { interval: 1, unit: "day", anchor: "2026-11-17" })).rejects.toThrow("Schedule the task first");
    await api.taskPlace(t.id, "2026-11-17", 1);
    const detail = await api.taskRepeatSet(t.id, { interval: 2, unit: "day", anchor: "2026-11-17" });
    expect(detail.repeat).toMatchObject({ label: "Every other day", rule: { interval: 2, unit: "day" } });
    expect(store.blockTasks("2026-11-19", 1).map((x) => x.title)).toEqual(["Standup notes"]);
    expect(store.blockTasks("2026-11-18", 1)).toEqual([]);
  });

  it("stops repeating when asked, without removing what was already made", async () => {
    const { api, store } = setup();
    const t = store.createTask({ title: "Water plants" });
    await api.taskPlace(t.id, "2026-11-17", 1);
    await api.taskRepeatSet(t.id, { interval: 1, unit: "day", anchor: "2026-11-17" });
    const copies = store.blockTasks("2026-11-18", 1);
    expect(copies).toHaveLength(1);
    expect((await api.taskRepeatSet(t.id, null)).repeat).toBeNull();
    expect(store.blockTasks("2026-11-18", 1)).toHaveLength(1);
    // A copy shows the same repeat as the task it came from.
    expect((await api.taskGet(copies[0]!.id)).repeat).toBeNull();
  });

  it("refuses a rule that makes no sense", async () => {
    const { api, store } = setup();
    const t = store.createTask({ title: "Nope" });
    await api.taskPlace(t.id, "2026-11-17", 1);
    await expect(api.taskRepeatSet(t.id, { interval: 0, unit: "day", anchor: "2026-11-17" })).rejects.toThrow("Invalid repeat");
    await expect(api.taskRepeatSet(t.id, { interval: 1, unit: "hour", anchor: "2026-11-17" } as never)).rejects.toThrow("Invalid repeat");
  });

  it("lets a routine item show on some days only, and remembers the rule", async () => {
    const { api, store, weekday } = setup();
    const t = (await api.templatesGet()).templates.find((x) => x.id === weekday.id)!;
    const rule = { interval: 3, unit: "day" as const, anchor: "2026-11-17" };
    await api.templateSave({ ...t, routine: [...t.routine, { title: "Water plants", startMin: 8 * 60, endMin: 8 * 60 + 15, repeat: { rule, label: "" } }] });
    const shown = (d: string) => store.routineFor(d).map((r) => r.title);
    expect(shown("2026-11-17")).toContain("Water plants");
    expect(shown("2026-11-18")).not.toContain("Water plants");
    expect(shown("2026-11-20")).toContain("Water plants");
    const saved = (await api.templatesGet()).templates.find((x) => x.id === weekday.id)!.routine.find((r) => r.title === "Water plants")!;
    expect(saved.repeat).toMatchObject({ label: "Every 3 days", rule });
    // Back to every time.
    await api.templateSave({ ...t, routine: [{ ...saved, repeat: null }] });
    expect(shown("2026-11-18")).toContain("Water plants");
  });
});
