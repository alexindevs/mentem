import { describe, expect, it } from "vitest";
import { at, makeStore, standardWeek } from "./helpers";

describe("tasks and subtasks", () => {
  it("completes a parent when all subtasks are done, and reopens it when one is reopened (FR-11)", () => {
    const { store } = makeStore();
    const parent = store.createTask({ title: "p" });
    const a = store.createTask({ title: "a", parentId: parent.id });
    const b = store.createTask({ title: "b", parentId: parent.id });
    store.setStatus(a.id, "done");
    expect(store.getTask(parent.id)!.status).toBe("open");
    store.setStatus(b.id, "done");
    expect(store.getTask(parent.id)!.status).toBe("done");
    expect(store.getTask(parent.id)!.completedAt).not.toBeNull();
    store.setStatus(a.id, "open");
    expect(store.getTask(parent.id)!.status).toBe("open");
    expect(store.getTask(parent.id)!.completedAt).toBeNull();
  });

  it("propagates through three levels", () => {
    const { store } = makeStore();
    const l1 = store.createTask({ title: "l1" });
    const l2 = store.createTask({ title: "l2", parentId: l1.id });
    const l3 = store.createTask({ title: "l3", parentId: l2.id });
    store.setStatus(l3.id, "done");
    expect(store.getTask(l2.id)!.status).toBe("done");
    expect(store.getTask(l1.id)!.status).toBe("done");
  });

  it("reopens a completed parent when a new subtask is added", () => {
    const { store } = makeStore();
    const p = store.createTask({ title: "p" });
    const a = store.createTask({ title: "a", parentId: p.id });
    store.setStatus(a.id, "done");
    expect(store.getTask(p.id)!.status).toBe("done");
    store.createTask({ title: "b", parentId: p.id });
    expect(store.getTask(p.id)!.status).toBe("open");
  });

  it("deleting a parent can delete or detach its subtasks", () => {
    const { store } = makeStore();
    const p1 = store.createTask({ title: "p1" });
    const c1 = store.createTask({ title: "c1", parentId: p1.id });
    store.deleteTask(p1.id, "delete");
    expect(store.getTask(c1.id)).toBeUndefined();

    const p2 = store.createTask({ title: "p2" });
    const c2 = store.createTask({ title: "c2", parentId: p2.id });
    store.deleteTask(p2.id, "detach");
    expect(store.getTask(c2.id)!.parentId).toBeNull();
  });

  it("rejects a parent that does not exist", () => {
    const { store } = makeStore();
    expect(() => store.createTask({ title: "x", parentId: "nope" })).toThrow();
  });

  it("lists unscheduled tasks: open tasks with no assignment", () => {
    const { store } = makeStore();
    standardWeek(store);
    const a = store.createTask({ title: "a" });
    const b = store.createTask({ title: "b" });
    const c = store.createTask({ title: "c" });
    store.assign(b.id, { date: "2026-11-16", slot: 1 });
    store.setStatus(c.id, "done");
    expect(store.listTasks({ unscheduled: true }).map((t) => t.id)).toEqual([a.id]);
    store.unassign(b.id);
    expect(store.listTasks({ unscheduled: true }).map((t) => t.id)).toEqual([a.id, b.id]); // unassigning returns it
  });

  it("generates short, unique, human-typable ids", () => {
    const { store } = makeStore();
    const ids = new Set<string>();
    for (let i = 0; i < 300; i++) ids.add(store.createTask({ title: `t${i}` }).id);
    expect(ids.size).toBe(300);
    for (const id of ids) expect(id).toMatch(/^[a-hj-km-np-z2-9]{4,6}$/);
  });
});

describe("steps", () => {
  it("shows the first step not done, with its place in the list", () => {
    const { store } = makeStore();
    const t = store.createTask({ title: "t", steps: ["one", "two", "three"] });
    expect(store.currentStep(t.id)).toMatchObject({ index: 1, total: 3, step: { text: "one" } });
    store.setStepDone(store.listSteps(t.id)[0]!.id, true);
    expect(store.currentStep(t.id)).toMatchObject({ index: 2, total: 3, step: { text: "two" } });
    store.addStep(t.id, "four");
    expect(store.listSteps(t.id)).toHaveLength(4);
    store.listSteps(t.id).forEach((s) => store.setStepDone(s.id, true));
    expect(store.currentStep(t.id)).toBeNull();
  });
});

describe("assignments", () => {
  it("appends to the end of a block and breaks position ties by creation order", () => {
    const { store } = makeStore();
    standardWeek(store);
    const a = store.createTask({ title: "a" });
    const b = store.createTask({ title: "b" });
    const c = store.createTask({ title: "c" });
    store.assign(a.id, { date: "2026-11-16", slot: 1 });
    store.assign(b.id, { date: "2026-11-16", slot: 1 });
    store.assign(c.id, { date: "2026-11-16", slot: 1, position: 0 }); // same position as a
    expect(store.listBlock("2026-11-16", 1).map((x) => x.taskId)).toEqual([a.id, c.id, b.id]);
  });

  it("reorders a block", () => {
    const { store } = makeStore();
    standardWeek(store);
    const [a, b, c] = ["a", "b", "c"].map((title) => store.createTask({ title }));
    [a, b, c].forEach((t) => store.assign(t!.id, { date: "2026-11-16", slot: 1 }));
    store.reorderBlock("2026-11-16", 1, [c!.id, a!.id, b!.id]);
    expect(store.listBlock("2026-11-16", 1).map((x) => x.taskId)).toEqual([c!.id, a!.id, b!.id]);
  });

  it("a task has one assignment; assigning again moves it", () => {
    const { store } = makeStore();
    standardWeek(store);
    const a = store.createTask({ title: "a" });
    store.assign(a.id, { date: "2026-11-16", slot: 1 });
    store.assign(a.id, { date: "2026-11-17", slot: 2 });
    expect(store.listDate("2026-11-16")).toHaveLength(0);
    expect(store.getAssignment(a.id)).toMatchObject({ date: "2026-11-17", slot: 2 });
  });

  it("a subtask follows its parent unless it has its own assignment (FR-14)", () => {
    const { store } = makeStore();
    standardWeek(store);
    const p = store.createTask({ title: "p" });
    const c = store.createTask({ title: "c", parentId: p.id });
    store.assign(p.id, { date: "2026-11-16", slot: 1 });
    expect(store.effectiveAssignment(c.id)).toMatchObject({ date: "2026-11-16", slot: 1 });
    store.assign(c.id, { date: "2026-11-18", slot: 2 });
    expect(store.effectiveAssignment(c.id)).toMatchObject({ date: "2026-11-18", slot: 2 });
  });

  it("writes history for assignments and completions", () => {
    const { store } = makeStore();
    standardWeek(store);
    const a = store.createTask({ title: "a" });
    store.assign(a.id, { date: "2026-11-16", slot: 1 });
    store.assign(a.id, { date: "2026-11-17", slot: 1 });
    store.setStatus(a.id, "done");
    store.setStatus(a.id, "open");
    store.unassign(a.id);
    const kinds = (store.db.prepare("select kind from assignment_event where task_id = ? order by id").all(a.id) as { kind: string }[]).map((e) => e.kind);
    expect(kinds).toEqual(["assigned", "moved", "completed", "reopened", "unassigned"]);
  });
});

describe("templates and the weekly schedule", () => {
  it("resolves a date's template: its override first, then its weekday's, else none", () => {
    const { store } = makeStore();
    const { weekday, weekend } = standardWeek(store);
    expect(store.templateIdFor("2026-11-16")).toBe(weekday.id); // Monday
    expect(store.templateIdFor("2026-11-21")).toBe(weekend.id); // Saturday
    store.setDateTemplateRaw("2026-11-16", weekend.id);
    expect(store.templateIdFor("2026-11-16")).toBe(weekend.id);
    store.setDateTemplateRaw("2026-11-16", null);
    expect(store.templateIdFor("2026-11-16")).toBe(weekday.id);
    store.clearSchedule(5);
    expect(store.templateIdFor("2026-11-21")).toBeNull();
    expect(store.blocksFor("2026-11-21")).toEqual([]);
  });

  it("names blocks freely; the names are only labels", () => {
    const { store } = makeStore();
    const t = store.createTemplate({
      name: "Deep work",
      blocks: [
        { slot: 1, name: "Deep work", startHour: 8, endHour: 11 },
        { slot: 2, name: "Admin", startHour: 14, endHour: 16 },
      ],
    });
    store.setSchedule([0], t.id);
    expect(store.blocksFor("2026-11-16").map((b) => [b.name, b.slot, b.startMin, b.endMin])).toEqual([
      ["Deep work", 1, 480, 660],
      ["Admin", 2, 840, 960],
    ]);
  });

  it("numbers blocks in time order and rejects overlaps", () => {
    const { store } = makeStore();
    const t = store.createTemplate({ name: "T", blocks: [{ slot: 2, name: "Later", startHour: 14, endHour: 16 }, { slot: 1, name: "Earlier", startHour: 9, endHour: 12 }] });
    expect(store.getTemplate(t.id)!.blocks.map((b) => [b.slot, b.name])).toEqual([[1, "Earlier"], [2, "Later"]]);
    expect(() => store.setBlocks(t.id, [{ slot: 1, name: "A", startHour: 9, endHour: 12 }, { slot: 2, name: "B", startHour: 11, endHour: 13 }])).toThrow(/overlap/);
  });

  it("applies a routine item's repeat rule, defaulting to every time", () => {
    const { store } = makeStore();
    const { weekday } = standardWeek(store);
    store.addRoutineItem(weekday.id, { title: "Wake up", startMin: 420 });
    store.addRoutineItem(weekday.id, { title: "Walk", startMin: 450, endMin: 480, repeat: { interval: 1, unit: "week", anchor: "2026-11-16", weekdays: [0, 2] } });
    expect(store.routineFor("2026-11-16").map((r) => r.title)).toEqual(["Wake up", "Walk"]); // Monday
    expect(store.routineFor("2026-11-17").map((r) => r.title)).toEqual(["Wake up"]); // Tuesday
    expect(store.routineFor("2026-11-18").map((r) => r.title)).toEqual(["Wake up", "Walk"]); // Wednesday
  });
});

describe("settings", () => {
  it("returns defaults and persists changes", () => {
    const { store } = makeStore();
    expect(store.getSettings()).toMatchObject({ pomodoroMinutes: 25, appName: "Mentem", cliName: "mentem", weekEndDay: 6, theme: "white-green" });
    store.updateSettings({ pomodoroMinutes: 50, userName: "Alex", theme: "black-orange" });
    expect(store.getSettings()).toMatchObject({ pomodoroMinutes: 50, userName: "Alex", theme: "black-orange", shortBreakMinutes: 5 });
  });

  it("ignores unknown keys", () => {
    const { store } = makeStore();
    store.updateSettings({ nonsense: 1 } as never);
    expect(store.db.prepare("select count(*) n from setting").get()).toEqual({ n: 0 });
    expect(at(2026, 11, 16).getDay()).toBe(1);
  });
});

describe("projects", () => {
  it("links tasks to deliverables and lists deliverables by due date", () => {
    const { store } = makeStore();
    const p = store.createProject({ name: "Launch", context: "notes" });
    const late = store.addDeliverable(p.id, { title: "Launch day", type: "deadline", dueDate: "2026-12-10" });
    const early = store.addDeliverable(p.id, { title: "Beta", type: "milestone", dueDate: "2026-11-20" });
    const undated = store.addDeliverable(p.id, { title: "Docs", type: "deliverable" });
    expect(store.listDeliverables(p.id).map((d) => d.id)).toEqual([early.id, late.id, undated.id]);
    const t = store.createTask({ title: "t", projectId: p.id, deliverableId: early.id });
    expect(store.listTasks({ projectId: p.id }).map((x) => x.id)).toEqual([t.id]);
    store.deleteTemplate("none"); // deleting something absent is harmless
  });
});

describe("ordering steps", () => {
  it("lets any step come first, and the timer follows the new order", () => {
    const { store } = makeStore();
    const t = store.createTask({ title: "Write", steps: ["outline", "draft", "send"] });
    const [a, b, c] = store.listSteps(t.id).map((s) => s.id) as [string, string, string];
    expect(store.currentStep(t.id)?.step.text).toBe("outline");
    store.reorderSteps(t.id, [c, a, b]);
    expect(store.listSteps(t.id).map((s) => s.text)).toEqual(["send", "outline", "draft"]);
    expect(store.currentStep(t.id)).toMatchObject({ index: 1, total: 3, step: { text: "send" } });
    store.addStep(t.id, "review");
    expect(store.listSteps(t.id).map((s) => s.text).at(-1)).toBe("review");
  });

  it("refuses an order that is missing a step, repeats one or names another task's step", () => {
    const { store } = makeStore();
    const t = store.createTask({ title: "A", steps: ["one", "two"] });
    const other = store.createTask({ title: "B", steps: ["x"] });
    const [a, b] = store.listSteps(t.id).map((s) => s.id) as [string, string];
    expect(() => store.reorderSteps(t.id, [a])).toThrow();
    expect(() => store.reorderSteps(t.id, [a, a])).toThrow();
    expect(() => store.reorderSteps(t.id, [a, store.listSteps(other.id)[0]!.id])).toThrow();
    expect(store.listSteps(t.id).map((s) => s.id)).toEqual([a, b]);
  });
});

describe("editing and removing steps", () => {
  it("rewords a step, removes one, and keeps the rest in order", () => {
    const { store } = makeStore();
    const t = store.createTask({ title: "Write", steps: ["outline", "draft", "send"] });
    const [a, b, c] = store.listSteps(t.id).map((s) => s.id) as [string, string, string];
    store.updateStep(b, "  write the draft  ");
    store.removeStep(a);
    expect(store.listSteps(t.id).map((s) => s.text)).toEqual(["write the draft", "send"]);
    expect(store.currentStep(t.id)).toMatchObject({ index: 1, total: 2, step: { id: b } });
    store.addStep(t.id, "review");
    expect(store.listSteps(t.id).map((s) => s.id).slice(0, 2)).toEqual([b, c]);
    expect(() => store.updateStep(b, "   ")).toThrow("text");
  });
});
