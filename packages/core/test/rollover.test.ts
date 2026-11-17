import { describe, expect, it } from "vitest";
import { runRollover } from "../src/rollover";
import { at, makeStore, standardWeek } from "./helpers";

const where = (store: ReturnType<typeof makeStore>["store"], taskId: string) => {
  const a = store.getAssignment(taskId);
  return a ? `${a.date} ${a.slot}` : "unscheduled";
};

describe("rollover", () => {
  it("moves open tasks to the next block the same day, ahead of what is already there", () => {
    const { store, clock } = makeStore(at(2026, 11, 16, 8, 0));
    standardWeek(store);
    const a = store.createTask({ title: "A" });
    const b = store.createTask({ title: "B" });
    const done = store.createTask({ title: "Done" });
    const existing = store.createTask({ title: "Existing" });
    store.assign(a.id, { date: "2026-11-16", slot: 1 });
    store.assign(b.id, { date: "2026-11-16", slot: 1 });
    store.assign(done.id, { date: "2026-11-16", slot: 1 });
    store.assign(existing.id, { date: "2026-11-16", slot: 2 });
    store.setStatus(done.id, "done");

    clock.set(at(2026, 11, 16, 12, 0));
    const r = runRollover(store);
    expect(r.moved.map((m) => m.taskId)).toEqual([a.id, b.id]);
    expect(where(store, a.id)).toBe("2026-11-16 2");
    expect(where(store, done.id)).toBe("2026-11-16 1"); // stays put
    expect(store.listBlock("2026-11-16", 2).map((x) => x.taskId)).toEqual([a.id, b.id, existing.id]);
  });

  it("does nothing while a block is still running", () => {
    const { store, clock } = makeStore(at(2026, 11, 16, 8, 0));
    standardWeek(store);
    const t = store.createTask({ title: "A" });
    store.assign(t.id, { date: "2026-11-16", slot: 1 });
    clock.set(at(2026, 11, 16, 11, 59));
    expect(runRollover(store).moved).toHaveLength(0);
    expect(where(store, t.id)).toBe("2026-11-16 1");
  });

  it("rolls the last block of a day to the first block of the next day", () => {
    const { store, clock } = makeStore();
    standardWeek(store);
    const t = store.createTask({ title: "A" });
    store.assign(t.id, { date: "2026-11-16", slot: 2 });
    clock.set(at(2026, 11, 16, 17, 0));
    runRollover(store);
    expect(where(store, t.id)).toBe("2026-11-17 1");
  });

  it("skips days with no template (Friday evening goes to Saturday's first block, which exists)", () => {
    const { store, clock } = makeStore();
    standardWeek(store);
    store.clearSchedule(5); // Saturday is now a day off
    const t = store.createTask({ title: "A" });
    store.assign(t.id, { date: "2026-11-20", slot: 2 }); // Friday afternoon
    clock.set(at(2026, 11, 20, 17, 0));
    runRollover(store);
    expect(where(store, t.id)).toBe("2026-11-22 1"); // Sunday (weekend template)
  });

  it("sends open tasks back to Unscheduled after the last block of the week-end day", () => {
    const { store, clock } = makeStore();
    standardWeek(store);
    const t = store.createTask({ title: "A" });
    store.assign(t.id, { date: "2026-11-22", slot: 1 }); // Sunday afternoon, week ends Sunday
    clock.set(at(2026, 11, 22, 17, 0));
    const r = runRollover(store);
    expect(r.unscheduled.map((u) => u.taskId)).toEqual([t.id]);
    expect(store.getAssignment(t.id)).toBeUndefined();
    expect(store.getTask(t.id)!.status).toBe("open"); // never marked done
    expect(store.listTasks({ unscheduled: true }).map((x) => x.id)).toContain(t.id);
  });

  it("honors a different week-end day", () => {
    const { store, clock } = makeStore();
    standardWeek(store);
    store.updateSettings({ weekEndDay: 4 }); // Friday
    const t = store.createTask({ title: "A" });
    store.assign(t.id, { date: "2026-11-20", slot: 2 });
    clock.set(at(2026, 11, 20, 17, 0));
    runRollover(store);
    expect(store.getAssignment(t.id)).toBeUndefined();
  });

  it("catches up after the app was closed: one move per task, straight to the first open block", () => {
    const { store, clock } = makeStore();
    standardWeek(store);
    const t = store.createTask({ title: "A" });
    store.assign(t.id, { date: "2026-11-16", slot: 1 }); // Monday morning
    clock.set(at(2026, 11, 18, 10, 0)); // opened on Wednesday during the morning block
    const r = runRollover(store);
    expect(r.moved).toHaveLength(1);
    expect(where(store, t.id)).toBe("2026-11-18 1");
    const events = store.db.prepare("select kind from assignment_event where task_id = ? and kind = 'rolled'").all(t.id);
    expect(events).toHaveLength(1);
  });

  it("keeps older tasks ahead of newer ones when several blocks roll into one", () => {
    const { store, clock } = makeStore();
    standardWeek(store);
    const old1 = store.createTask({ title: "old1" });
    const old2 = store.createTask({ title: "old2" });
    const newer = store.createTask({ title: "newer" });
    store.assign(old1.id, { date: "2026-11-16", slot: 1 });
    store.assign(old2.id, { date: "2026-11-16", slot: 1 });
    store.assign(newer.id, { date: "2026-11-17", slot: 1 });
    clock.set(at(2026, 11, 18, 9, 30));
    runRollover(store);
    expect(store.listBlock("2026-11-18", 1).map((a) => a.taskId)).toEqual([old1.id, old2.id, newer.id]);
  });

  it("is idempotent", () => {
    const { store, clock } = makeStore();
    standardWeek(store);
    const t = store.createTask({ title: "A" });
    store.assign(t.id, { date: "2026-11-16", slot: 1 });
    clock.set(at(2026, 11, 16, 12, 30));
    runRollover(store);
    const second = runRollover(store);
    expect(second.moved).toHaveLength(0);
    expect(second.unscheduled).toHaveLength(0);
    expect(where(store, t.id)).toBe("2026-11-16 2");
  });

  it("keeps project and subtask links", () => {
    const { store, clock } = makeStore();
    standardWeek(store);
    const project = store.createProject({ name: "Launch" });
    const parent = store.createTask({ title: "Parent", projectId: project.id });
    const child = store.createTask({ title: "Child", parentId: parent.id, projectId: project.id });
    store.assign(parent.id, { date: "2026-11-16", slot: 1 });
    clock.set(at(2026, 11, 16, 12, 0));
    runRollover(store);
    expect(store.getTask(parent.id)!.projectId).toBe(project.id);
    expect(store.getTask(child.id)!.parentId).toBe(parent.id);
    expect(store.effectiveAssignment(child.id)!.date).toBe("2026-11-16");
    expect(store.effectiveAssignment(child.id)!.slot).toBe(2);
  });
});
