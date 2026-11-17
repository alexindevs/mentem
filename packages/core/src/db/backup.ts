import Database from "better-sqlite3";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, copyFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { dateOf } from "../dates";

export type SnapshotKind = "daily" | "pre-migration" | "pre-update" | "pre-restore" | "manual";

export interface SnapshotInfo {
  path: string;
  name: string;
  kind: SnapshotKind;
  createdAt: number;
  schemaVersion: number;
  bytes: number;
}

const NAME_RE = /^mentem-(daily|pre-migration|pre-update|pre-restore|manual)-(\d{13})-v(\d+)\.db$/;

export interface IntegrityResult {
  ok: boolean;
  messages: string[];
}

/** quick_check reads each page once and is much cheaper than a full integrity_check. */
export function integrityCheck(db: Database.Database, full = false): IntegrityResult {
  try {
    const rows = db.pragma(full ? "integrity_check" : "quick_check") as Array<Record<string, string>>;
    const messages = rows.map((r) => Object.values(r)[0] ?? "");
    return { ok: messages.length === 1 && messages[0] === "ok", messages };
  } catch (e) {
    // Badly damaged files make SQLite throw instead of reporting problems.
    const code = (e as { code?: string }).code ?? "";
    if (code.startsWith("SQLITE_CORRUPT") || code === "SQLITE_NOTADB") {
      return { ok: false, messages: [e instanceof Error ? e.message : String(e)] };
    }
    throw e;
  }
}

/**
 * Writes a consistent snapshot of the open database. VACUUM INTO produces a single,
 * compact, self-contained file even while the database is in WAL mode.
 */
export function createSnapshot(
  db: Database.Database,
  dir: string,
  kind: SnapshotKind,
  now: number,
  schemaVersion: number,
): string {
  mkdirSync(dir, { recursive: true });
  let at = now;
  let target = join(dir, `mentem-${kind}-${at}-v${schemaVersion}.db`);
  while (existsSync(target)) {
    at += 1;
    target = join(dir, `mentem-${kind}-${at}-v${schemaVersion}.db`);
  }
  const temp = `${target}.tmp`;
  rmSync(temp, { force: true });
  db.prepare("VACUUM INTO ?").run(temp);
  renameSync(temp, target);
  return target;
}

export function listSnapshots(dir: string): SnapshotInfo[] {
  if (!existsSync(dir)) return [];
  const out: SnapshotInfo[] = [];
  for (const name of readdirSync(dir)) {
    const m = NAME_RE.exec(name);
    if (!m) continue;
    const path = join(dir, name);
    out.push({
      path,
      name,
      kind: m[1] as SnapshotKind,
      createdAt: Number(m[2]),
      schemaVersion: Number(m[3]),
      bytes: statSync(path).size,
    });
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

export function hasDailySnapshotFor(dir: string, date: string): boolean {
  return listSnapshots(dir).some((s) => s.kind === "daily" && dateOf(s.createdAt) === date);
}

export interface Retention {
  daily: number;
  preMigration: number;
  preUpdate: number;
  preRestore: number;
}

export const DEFAULT_RETENTION: Retention = { daily: 14, preMigration: 5, preUpdate: 5, preRestore: 3 };

/** Deletes the oldest snapshots beyond the retention limits. Manual snapshots are never pruned. */
export function pruneSnapshots(dir: string, retention: Retention = DEFAULT_RETENTION): string[] {
  const limits: Partial<Record<SnapshotKind, number>> = {
    daily: retention.daily,
    "pre-migration": retention.preMigration,
    "pre-update": retention.preUpdate,
    "pre-restore": retention.preRestore,
  };
  const removed: string[] = [];
  for (const kind of Object.keys(limits) as SnapshotKind[]) {
    const keep = limits[kind]!;
    listSnapshots(dir)
      .filter((s) => s.kind === kind)
      .slice(keep)
      .forEach((s) => {
        rmSync(s.path, { force: true });
        removed.push(s.path);
      });
  }
  return removed;
}

/** Opens a snapshot read-only and checks it, without touching it. */
export function verifySnapshot(path: string): IntegrityResult {
  let db: Database.Database | undefined;
  try {
    db = new Database(path, { readonly: true, fileMustExist: true });
    return integrityCheck(db, true);
  } catch (e) {
    return { ok: false, messages: [e instanceof Error ? e.message : String(e)] };
  } finally {
    db?.close();
  }
}

/**
 * Replaces the live database file with a snapshot. The caller must have closed its
 * connection first. The snapshot is verified before anything is changed, and the
 * current database (if it is still readable) is saved as a "pre-restore" snapshot so
 * the restore itself can be undone.
 */
export function restoreSnapshot(
  dbPath: string,
  snapshotPath: string,
  snapshotDir: string,
  now: number,
  schemaVersionOfCurrent = 0,
): { restoredFrom: string; savedCurrentAs: string | null } {
  const check = verifySnapshot(snapshotPath);
  if (!check.ok) throw new Error(`Snapshot is not valid: ${check.messages.join("; ")}`);

  let savedCurrentAs: string | null = null;
  if (existsSync(dbPath)) {
    try {
      const cur = new Database(dbPath, { fileMustExist: true });
      try {
        if (integrityCheck(cur).ok) {
          savedCurrentAs = createSnapshot(cur, snapshotDir, "pre-restore", now, schemaVersionOfCurrent);
        }
      } finally {
        cur.close();
      }
    } catch {
      // The current file is unreadable; there is nothing safe to save.
    }
  }
  if (savedCurrentAs === null && existsSync(dbPath)) {
    // Keep the unreadable original aside instead of deleting it.
    mkdirSync(snapshotDir, { recursive: true });
    copyFileSync(dbPath, join(snapshotDir, `corrupt-${now}-${basename(dbPath)}`));
  }

  const temp = join(dirname(dbPath), `${basename(dbPath)}.restore`);
  rmSync(temp, { force: true });
  copyFileSync(snapshotPath, temp);
  for (const suffix of ["-wal", "-shm"]) rmSync(`${dbPath}${suffix}`, { force: true });
  rmSync(dbPath, { force: true });
  renameSync(temp, dbPath);
  return { restoredFrom: snapshotPath, savedCurrentAs };
}
