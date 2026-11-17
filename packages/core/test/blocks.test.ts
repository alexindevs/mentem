import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MIGRATIONS } from "../src/db/migrations";
import { openDatabase } from "../src/db/open";
import { Store } from "../src/store";
import { MAX_BLOCKS } from "../src/types";
import { at, makeStore } from "./helpers";

const MON = "2026-11-16";
const block = (slot: number, name: string, startHour: number, endHour: number) => ({ slot, name, startHour, endHour });
const dirs: string[] = [];
const open: Array<{ close(): void }> = [];
afterEach(() => {
  for (const db of open.splice(0)) {
    try {
      db.close();
    } catch {
      /* already closed */
    }
  }
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});

describe("any number of work blocks", () => {
  it("keeps five blocks in time order, and numbers them", () => {
    const { store } = makeStore();
    const t = store.createTemplate({
      name: "Busy",
      blocks: [block(1, "Early", 6, 8), block(2, "Morning", 9, 12), block(3, "Afternoon", 13, 15), block(4, "Late", 15, 17), block(5, "Night", 20, 22)],
    });
    store.setSchedule([0], t.id);
    expect(store.blocksFor(MON).map((b) => [b.slot, b.name])).toEqual([[1, "Early"], [2, "Morning"], [3, "Afternoon"], [4, "Late"], [5, "Night"]]);
    const task = store.createTask({ title: "In the fifth" });
    store.assign(task.id, { date: MON, slot: 5 });
    expect(store.blockTasks(MON, 5).map((x) => x.title)).toEqual(["In the fifth"]);
  });

  it("refuses more than the limit, blocks that overlap, and two blocks with one name", () => {
    const { store } = makeStore();
    const many = Array.from({ length: MAX_BLOCKS + 1 }, (_, i) => block(i + 1, `B${i}`, i, i + 1));
    expect(() => store.createTemplate({ name: "Too many", blocks: many })).toThrow(/at most 12/);
    expect(() => store.createTemplate({ name: "Overlap", blocks: [block(1, "A", 9, 12), block(2, "B", 11, 14)] })).toThrow(/overlap/);
    expect(() => store.createTemplate({ name: "Same", blocks: [block(1, "Work", 9, 11), block(2, "work", 13, 15)] })).toThrow(/different names/);
  });

  it("names a block that has no name", () => {
    const { store } = makeStore();
    const t = store.createTemplate({ name: "Plain", blocks: [block(1, "", 8, 9), block(2, "", 10, 11), block(3, "", 12, 13), block(4, "", 14, 15)] });
    expect(t.blocks.map((b) => b.name)).toEqual(["Morning", "Afternoon", "Evening", "Block 4"]);
  });
});

describe("changing a template's blocks", () => {
  function week() {
    const ctx = makeStore(at(2026, 11, 16, 8, 0));
    const t = ctx.store.createTemplate({ name: "Weekday", blocks: [block(1, "Morning", 9, 12), block(2, "Afternoon", 13, 17)] });
    ctx.store.setSchedule([0, 1, 2], t.id);
    const am = ctx.store.createTask({ title: "Morning job" });
    const pm = ctx.store.createTask({ title: "Afternoon job" });
    ctx.store.assign(am.id, { date: MON, slot: 1 });
    ctx.store.assign(pm.id, { date: MON, slot: 2 });
    return { ...ctx, t, am, pm };
  }

  it("keeps tasks in their block when a new one is added before it", () => {
    const { store, t, am, pm } = week();
    const result = store.applyBlocks(t.id, [block(1, "Early", 6, 8), block(2, "Morning", 9, 12), block(3, "Afternoon", 13, 17)], MON);
    expect(result).toEqual({ moved: 2, unscheduled: 0 });
    expect(store.getAssignment(am.id)?.slot).toBe(2);
    expect(store.getAssignment(pm.id)?.slot).toBe(3);
    expect(store.blockTasks(MON, 3).map((x) => x.title)).toEqual(["Afternoon job"]);
  });

  it("follows a renamed block by its hours", () => {
    const { store, t, am } = week();
    store.applyBlocks(t.id, [block(1, "Deep work", 9, 12), block(2, "Afternoon", 13, 17)], MON);
    expect(store.getAssignment(am.id)?.slot).toBe(1);
    expect(store.blocksFor(MON)[0]?.name).toBe("Deep work");
  });

  it("sends tasks back to Unscheduled when their block is removed, but leaves past days alone", () => {
    const { store, t, am, pm, clock } = week();
    clock.set(at(2026, 11, 17, 8, 0));
    const result = store.applyBlocks(t.id, [block(1, "Morning", 9, 12)], "2026-11-17");
    expect(result.unscheduled).toBe(0);
    expect(store.getAssignment(pm.id)).toMatchObject({ date: MON, slot: 2 });
    const later = store.createTask({ title: "Tomorrow afternoon" });
    store.assign(later.id, { date: "2026-11-18", slot: 1 });
    store.applyBlocks(t.id, [block(1, "Morning", 9, 12), block(2, "Afternoon", 13, 17)], "2026-11-17");
    store.assign(later.id, { date: "2026-11-18", slot: 2 });
    const final = store.applyBlocks(t.id, [block(1, "Morning", 9, 12)], "2026-11-17");
    expect(final.unscheduled).toBe(1);
    expect(store.getAssignment(later.id)).toBeUndefined();
    expect(store.getAssignment(am.id)?.slot).toBe(1);
  });
});

describe("the move from three blocks to many", () => {
  it("carries every earlier table across, including repeat dates", () => {
    const dir = mkdtempSync(join(tmpdir(), "mentem-migrate-"));
    dirs.push(dir);
    const path = join(dir, "mentem.db");
    const old = new Database(path);
    open.push(old);
    old.pragma("foreign_keys = ON");
    for (const m of MIGRATIONS.filter((x) => x.version <= 3)) {
      old.exec(m.sql);
      old.pragma(`user_version = ${m.version}`);
    }
    old.exec(`
      INSERT INTO day_template(id, name) VALUES('tpl1', 'Weekday');
      INSERT INTO template_block(template_id, slot, name, start_hour, end_hour) VALUES('tpl1', 1, 'Morning', 9, 12), ('tpl1', 2, 'Afternoon', 13, 17);
      INSERT INTO task(id, title, status, created_at) VALUES('t1', 'Task', 'open', 1);
      INSERT INTO assignment(id, task_id, date, slot, position, created_at) VALUES('a1', 't1', '${MON}', 2, 0, 1);
      INSERT INTO repeat_series(id, slot, rule, active) VALUES('t1', 2, '{"interval":1,"unit":"day","anchor":"${MON}"}', 1);
      INSERT INTO series_occurrence(series_id, date) VALUES('t1', '${MON}'), ('t1', '2026-11-17');
    `);
    old.close();

    const result = openDatabase(path);
    open.push(result.db);
    expect(result.fromVersion).toBe(3);
    const store = new Store(result.db);
    expect(store.getTemplate("tpl1")?.blocks.map((b) => b.name)).toEqual(["Morning", "Afternoon"]);
    expect(store.getAssignment("t1")).toMatchObject({ date: MON, slot: 2 });
    expect([...store.seriesDates("t1")].sort()).toEqual([MON, "2026-11-17"]);
    expect(store.getSeries("t1")).toMatchObject({ slot: 2, active: true });
    // And the new limit is in place.
    store.createTask({ title: "Fifth" });
    result.db.prepare("INSERT INTO assignment(id, task_id, date, slot, position, created_at) VALUES('a2', ?, ?, 9, 0, 1)").run(store.listTasks().find((t) => t.title === "Fifth")!.id, MON);
  });
});
