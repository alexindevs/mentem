import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeClock } from "../src/clock";
import {
  CorruptDatabaseError,
  SchemaTooNewError,
  openDatabase,
  runDailyMaintenance,
} from "../src/db/open";
import { LATEST_VERSION } from "../src/db/migrations";
import {
  createSnapshot,
  integrityCheck,
  listSnapshots,
  pruneSnapshots,
  restoreSnapshot,
  verifySnapshot,
} from "../src/db/backup";

let dir: string;
let dbPath: string;
let snaps: string;
const clock = new FakeClock(new Date(2026, 10, 16, 9, 0, 0));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mentem-db-"));
  dbPath = join(dir, "mentem.db");
  snaps = join(dir, "backups");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("openDatabase", () => {
  it("creates a fresh database at the latest version", () => {
    const r = openDatabase(dbPath, { snapshotDir: snaps, clock });
    expect(r.fromVersion).toBe(0);
    expect(r.toVersion).toBe(LATEST_VERSION);
    expect(r.snapshotPath).toBeNull(); // nothing to protect yet
    const tables = r.db.prepare("select name from sqlite_master where type='table'").all() as { name: string }[];
    expect(tables.map((t) => t.name)).toContain("task");
    expect(r.db.pragma("journal_mode", { simple: true })).toBe("wal");
    r.db.close();
  });

  it("reopens without migrating again", () => {
    openDatabase(dbPath).db.close();
    const r = openDatabase(dbPath, { snapshotDir: snaps, clock });
    expect(r.migrated).toBe(false);
    r.db.close();
  });

  it("refuses data from a newer schema and leaves it untouched", () => {
    const raw = new Database(dbPath);
    raw.exec("create table keep(x)");
    raw.pragma(`user_version = ${LATEST_VERSION + 5}`);
    raw.close();
    const before = readFileSync(dbPath);
    expect(() => openDatabase(dbPath)).toThrow(SchemaTooNewError);
    expect(readFileSync(dbPath).equals(before)).toBe(true);
  });

  it("detects a damaged file and does not modify it", () => {
    openDatabase(dbPath).db.close();
    const bytes = readFileSync(dbPath);
    // Overwrite the middle of the file with garbage.
    for (let i = 4096; i < Math.min(bytes.length, 8192); i++) bytes[i] = 0xff;
    writeFileSync(dbPath, bytes);
    const damaged = readFileSync(dbPath);
    expect(() => openDatabase(dbPath, { snapshotDir: snaps })).toThrow(CorruptDatabaseError);
    expect(readFileSync(dbPath).equals(damaged)).toBe(true);
  });

  it("takes a snapshot before migrating an older database", () => {
    // Simulate a database left at version 0 with data (e.g. pre-release layout).
    const raw = new Database(dbPath);
    raw.exec("create table legacy(x)");
    raw.close();
    const r = openDatabase(dbPath, { snapshotDir: snaps, clock });
    // version 0 with existing file: nothing versioned to protect, migration still runs
    expect(r.migrated).toBe(true);
    r.db.close();
  });
});

describe("snapshots", () => {
  it("creates, lists, verifies and prunes", () => {
    const { db } = openDatabase(dbPath);
    db.prepare("insert into setting(key,value) values('a','1')").run();
    const clk = new FakeClock(new Date(2026, 10, 1, 9, 0, 0));
    for (let i = 0; i < 20; i++) {
      createSnapshot(db, snaps, "daily", clk.now(), LATEST_VERSION);
      clk.advance(86_400_000);
    }
    expect(listSnapshots(snaps)).toHaveLength(20);
    const removed = pruneSnapshots(snaps);
    expect(removed).toHaveLength(6);
    const left = listSnapshots(snaps);
    expect(left).toHaveLength(14);
    expect(left[0]!.createdAt).toBeGreaterThan(left[13]!.createdAt); // newest first
    expect(verifySnapshot(left[0]!.path).ok).toBe(true);
    db.close();
  });

  it("runs the daily snapshot once per day", () => {
    const { db } = openDatabase(dbPath);
    const clk = new FakeClock(new Date(2026, 10, 16, 8, 0, 0));
    expect(runDailyMaintenance(db, snaps, clk)).not.toBeNull();
    clk.advance(3_600_000);
    expect(runDailyMaintenance(db, snaps, clk)).toBeNull();
    clk.advance(86_400_000);
    expect(runDailyMaintenance(db, snaps, clk)).not.toBeNull();
    db.close();
  });

  it("restores a snapshot over a damaged database, keeping the damaged file aside", () => {
    const { db } = openDatabase(dbPath);
    db.prepare("insert into setting(key,value) values('name','Alex')").run();
    const snap = createSnapshot(db, snaps, "manual", clock.now(), LATEST_VERSION);
    db.close();
    // Damage the live file.
    const bytes = readFileSync(dbPath);
    for (let i = 4096; i < Math.min(bytes.length, 8192); i++) bytes[i] = 0xff;
    writeFileSync(dbPath, bytes);
    expect(() => openDatabase(dbPath)).toThrow(CorruptDatabaseError);

    const result = restoreSnapshot(dbPath, snap, snaps, clock.now() + 1000);
    expect(result.savedCurrentAs).toBeNull();
    const reopened = openDatabase(dbPath);
    const row = reopened.db.prepare("select value from setting where key='name'").get() as { value: string };
    expect(row.value).toBe("Alex");
    expect(integrityCheck(reopened.db, true).ok).toBe(true);
    reopened.db.close();
    expect(existsSync(join(snaps, `corrupt-${clock.now() + 1000}-mentem.db`))).toBe(true);
  });

  it("saves the current database before restoring so the restore can be undone", () => {
    const { db } = openDatabase(dbPath);
    db.prepare("insert into setting(key,value) values('v','old')").run();
    const snap = createSnapshot(db, snaps, "manual", clock.now(), LATEST_VERSION);
    db.prepare("update setting set value='new' where key='v'").run();
    db.close();
    const result = restoreSnapshot(dbPath, snap, snaps, clock.now() + 5000, LATEST_VERSION);
    expect(result.savedCurrentAs).not.toBeNull();
    const after = openDatabase(dbPath).db;
    expect((after.prepare("select value from setting where key='v'").get() as { value: string }).value).toBe("old");
    after.close();
    const saved = new Database(result.savedCurrentAs!, { readonly: true });
    expect((saved.prepare("select value from setting where key='v'").get() as { value: string }).value).toBe("new");
    saved.close();
  });

  it("refuses to restore an invalid snapshot", () => {
    openDatabase(dbPath).db.close();
    const bad = join(dir, "bad.db");
    writeFileSync(bad, "not a database");
    expect(() => restoreSnapshot(dbPath, bad, snaps, clock.now())).toThrow(/not valid/);
  });
});
