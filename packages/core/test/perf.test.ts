import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TimerEngine } from "../src/engine";
import { FakeClock } from "../src/clock";
import { addDays } from "../src/dates";
import { openDatabase } from "../src/db/open";
import { runRollover } from "../src/rollover";
import { Store } from "../src/store";
import { createSnapshot } from "../src/db/backup";
import { LATEST_VERSION } from "../src/db/migrations";
import { at, standardWeek } from "./helpers";

/**
 * A year of use: about 4,000 tasks, almost all done and assigned to past blocks,
 * 20,000 sessions, and a few hundred events. These are guard rails with generous
 * limits, not benchmarks; they catch accidental full scans and slow queries.
 */
let dir: string;
let dbPath: string;
const clock = new FakeClock(at(2026, 11, 16, 10, 5));

function time<T>(fn: () => T): { ms: number; value: T } {
  const start = performance.now();
  const value = fn();
  return { ms: performance.now() - start, value };
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "mentem-perf-"));
  dbPath = join(dir, "mentem.db");
  const { db } = openDatabase(dbPath, { clock });
  const store = new Store(db, clock);
  standardWeek(store);
  const ins = {
    task: db.prepare("INSERT INTO task(id, title, status, created_at, completed_at) VALUES(?,?,?,?,?)"),
    asg: db.prepare("INSERT INTO assignment(id, task_id, date, slot, position, created_at) VALUES(?,?,?,?,?,?)"),
    ses: db.prepare("INSERT INTO session(task_id, start_at, end_at, type, completed) VALUES(?,?,?,?,1)"),
  };
  db.transaction(() => {
    let n = 0;
    for (let day = 0; day < 365; day++) {
      const date = addDays("2025-11-17", day);
      for (let k = 0; k < 11; k++) {
        const id = `p${n.toString(36).padStart(5, "0")}`;
        ins.task.run(id, `task ${n}`, "done", 1, 2);
        ins.asg.run(`a${n.toString(36).padStart(5, "0")}`, id, date, (k % 2) + 1, k, 1);
        for (let s = 0; s < 5; s++) ins.ses.run(id, 1_000 + n * 10 + s, 2_000 + n * 10 + s, s % 2 ? "break" : "work");
        n++;
      }
    }
    // A few open tasks for today.
    for (let k = 0; k < 8; k++) {
      const id = `open${k}`;
      ins.task.run(id, `open ${k}`, "open", 1, null);
      ins.asg.run(`aopen${k}`, id, "2026-11-16", 1, k, 1);
    }
  })();
  db.close();
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("a year of data", () => {
  it("opens quickly and stays a reasonable size", () => {
    const t = time(() => openDatabase(dbPath, { clock }));
    expect(t.ms).toBeLessThan(300);
    t.value.db.close();
    expect(statSync(dbPath).size).toBeLessThan(25 * 1024 * 1024);
  });

  it("answers the screens a user opens every day in a few milliseconds", () => {
    const { db } = openDatabase(dbPath, { clock });
    const store = new Store(db, clock);
    const engine = new TimerEngine(store, clock);
    expect(time(() => engine.state()).ms).toBeLessThan(50);
    expect(time(() => store.listBlock("2026-11-16", 1)).ms).toBeLessThan(20);
    expect(time(() => store.blockTasks("2026-11-16", 1)).ms).toBeLessThan(30);
    expect(time(() => store.listTasks({ unscheduled: true })).ms).toBeLessThan(100);
    db.close();
  });

  it("rolls over without scanning the whole history", () => {
    const { db } = openDatabase(dbPath, { clock });
    const store = new Store(db, clock);
    const t = time(() => runRollover(store));
    expect(t.ms).toBeLessThan(500);
    const again = time(() => runRollover(store));
    expect(again.ms).toBeLessThan(500);
    db.close();
  });

  it("takes a snapshot quickly", () => {
    const { db } = openDatabase(dbPath, { clock });
    const t = time(() => createSnapshot(db, join(dir, "backups"), "manual", clock.now(), LATEST_VERSION));
    expect(t.ms).toBeLessThan(1500);
    db.close();
  });
});
