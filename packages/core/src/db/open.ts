import Database from "better-sqlite3";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { addDays, dateOf } from "../dates";
import { type Clock, systemClock } from "../clock";
import {
  createSnapshot,
  hasDailySnapshotFor,
  integrityCheck,
  pruneSnapshots,
  type Retention,
  DEFAULT_RETENTION,
} from "./backup";
import { LATEST_VERSION, MIGRATIONS } from "./migrations";

export class CorruptDatabaseError extends Error {
  constructor(
    public readonly path: string,
    public readonly messages: string[],
  ) {
    super(`The database file is damaged: ${messages.slice(0, 3).join("; ")}`);
    this.name = "CorruptDatabaseError";
  }
}

/** The database was written by a newer version of the app. We never modify it. */
export class SchemaTooNewError extends Error {
  constructor(
    public readonly found: number,
    public readonly supported: number,
  ) {
    super(`The data is from a newer version (schema ${found}); this version supports up to ${supported}.`);
    this.name = "SchemaTooNewError";
  }
}

export interface OpenOptions {
  /** Where snapshots are written. If omitted, no snapshot is taken before migrating. */
  snapshotDir?: string;
  clock?: Clock;
}

export interface OpenResult {
  db: Database.Database;
  fromVersion: number;
  toVersion: number;
  migrated: boolean;
  /** Path of the pre-migration snapshot, if one was taken. */
  snapshotPath: string | null;
}

function applyPragmas(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.pragma("cache_size = -8000"); // about 8 MB of page cache
}

/**
 * Opens (and if needed creates or migrates) the database.
 * Order matters: check integrity first, refuse newer data, snapshot, then migrate.
 */
export function openDatabase(path: string, options: OpenOptions = {}): OpenResult {
  const clock = options.clock ?? systemClock;
  mkdirSync(dirname(path), { recursive: true });
  const existed = existsSync(path) && statSync(path).size > 0;
  const db = new Database(path);
  try {
    if (existed) {
      const check = integrityCheck(db);
      if (!check.ok) throw new CorruptDatabaseError(path, check.messages);
    }
    const fromVersion = db.pragma("user_version", { simple: true }) as number;
    if (fromVersion > LATEST_VERSION) throw new SchemaTooNewError(fromVersion, LATEST_VERSION);
    applyPragmas(db);

    let snapshotPath: string | null = null;
    const pending = MIGRATIONS.filter((m) => m.version > fromVersion);
    if (pending.length > 0 && existed && fromVersion > 0 && options.snapshotDir) {
      snapshotPath = createSnapshot(db, options.snapshotDir, "pre-migration", clock.now(), fromVersion);
      pruneSnapshots(options.snapshotDir);
    }
    for (const m of pending) {
      db.transaction(() => {
        db.exec(m.sql);
        db.pragma(`user_version = ${m.version}`);
      })();
    }
    return { db, fromVersion, toVersion: LATEST_VERSION, migrated: pending.length > 0, snapshotPath };
  } catch (e) {
    db.close();
    throw e;
  }
}

/**
 * Takes the daily snapshot if today's has not been taken yet, then prunes old ones.
 * Cheap to call on every launch and once a day while running.
 */
export function runDailyMaintenance(
  db: Database.Database,
  snapshotDir: string,
  clock: Clock = systemClock,
  retention: Retention = DEFAULT_RETENTION,
): string | null {
  const today = dateOf(clock.now());
  let taken: string | null = null;
  if (!hasDailySnapshotFor(snapshotDir, today)) {
    taken = createSnapshot(db, snapshotDir, "daily", clock.now(), LATEST_VERSION);
  }
  pruneSnapshots(snapshotDir, retention);
  // One-day adjustments are only useful on their own date.
  const old = addDays(today, -30);
  for (const table of ["routine_override", "block_override", "block_extension", "day_off"]) db.prepare(`DELETE FROM ${table} WHERE date < ?`).run(old);
  return taken;
}
