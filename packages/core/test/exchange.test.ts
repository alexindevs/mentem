import { describe, expect, it } from "vitest";
import { ImportError, exportData, importData, validateExport } from "../src/db/exchange";
import { LATEST_VERSION } from "../src/db/migrations";
import { Store } from "../src/store";
import { at, makeStore, standardWeek } from "./helpers";

function busyStore() {
  const ctx = makeStore(at(2026, 11, 16, 9, 0));
  const { weekday } = standardWeek(ctx.store);
  ctx.store.addRoutineItem(weekday.id, { title: "Lunch", startMin: 750, endMin: 780 });
  const project = ctx.store.createProject({ name: "Launch", context: "Warm tone" });
  const deliverable = ctx.store.addDeliverable(project.id, { title: "Welcome flow", type: "deliverable" });
  const task = ctx.store.createTask({ title: "Draft", projectId: project.id, deliverableId: deliverable.id, steps: ["one", "two"] });
  ctx.store.assign(task.id, { date: "2026-11-16", slot: 1 });
  ctx.store.setStatus(task.id, "done");
  ctx.store.updateSettings({ userName: "Alex", theme: "black-orange" });
  return { ...ctx, task };
}

describe("export and import", () => {
  it("carries everything across and back", () => {
    const a = busyStore();
    const file = JSON.parse(JSON.stringify(exportData(a.store.db, a.clock.now())));
    expect(file).toMatchObject({ format: "mentem-export", version: LATEST_VERSION });

    const b = makeStore(at(2026, 12, 1, 8, 0));
    const result = importData(b.store.db, file);
    expect(result.rows).toBeGreaterThan(10);
    expect(b.store.getSettings()).toMatchObject({ userName: "Alex", theme: "black-orange" });
    expect(b.store.listTemplates().map((t) => t.name).sort()).toEqual(["Weekday", "Weekend"]);
    const task = b.store.getTask(a.task.id)!;
    expect(task).toMatchObject({ title: "Draft", status: "done" });
    expect(b.store.listSteps(task.id).map((s) => s.text)).toEqual(["one", "two"]);
    expect(b.store.blocksFor("2026-11-16").map((x) => x.name)).toEqual(["Morning", "Afternoon"]);
    expect(exportData(b.store.db, 1).tables).toEqual(exportData(a.store.db, 1).tables);
  });

  it("replaces what was there instead of adding to it", () => {
    const a = busyStore();
    const b = makeStore();
    b.store.createTask({ title: "Left over" });
    importData(b.store.db, exportData(a.store.db, 1));
    expect(b.store.listTasks().map((t) => t.title)).toEqual(["Draft"]);
  });

  it("changes nothing when the file is wrong", () => {
    const b = makeStore();
    b.store.createTask({ title: "Keep me" });
    const bad = { format: "mentem-export", version: LATEST_VERSION, exportedAt: 1, tables: { task: [{ id: "x", title: "T", status: "not-a-status", created_at: 1 }] } };
    expect(() => importData(b.store.db, bad)).toThrow();
    expect(b.store.listTasks().map((t) => t.title)).toEqual(["Keep me"]);
  });

  it("refuses files that are not exports or are from a newer version", () => {
    expect(() => validateExport({ hello: 1 })).toThrow(ImportError);
    expect(() => validateExport(null)).toThrow(ImportError);
    expect(() => validateExport({ format: "mentem-export", version: LATEST_VERSION + 1, tables: {} })).toThrow(/newer version/);
    expect(() => validateExport({ format: "mentem-export", version: 1 })).toThrow(ImportError);
  });

  it("ignores tables and columns this version does not have", () => {
    const b = makeStore();
    const file = { format: "mentem-export" as const, version: LATEST_VERSION, exportedAt: 1, tables: { from_the_future: [{ a: 1 }], setting: [{ key: "userName", value: JSON.stringify("Sam"), extra_column: 5 }] } };
    importData(b.store.db, file);
    expect(new Store(b.store.db, b.clock).getSettings().userName).toBe("Sam");
  });
});
