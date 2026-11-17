import type Database from "better-sqlite3";
import { LATEST_VERSION } from "./migrations";

/**
 * A versioned JSON export of everything, so the data is not tied to the database file or to
 * one version of the app (PRD 9a). Rows are written table by table, column names and all.
 */
export interface ExportFile {
  format: "mentem-export";
  /** The database schema version the rows were written under. */
  version: number;
  exportedAt: number;
  tables: Record<string, Array<Record<string, unknown>>>;
}

export class ImportError extends Error {}

const userTables = (db: Database.Database): string[] =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>).map((r) => r.name);

const columnsOf = (db: Database.Database, table: string): string[] => (db.pragma(`table_info(${table})`) as Array<{ name: string }>).map((c) => c.name);

export function exportData(db: Database.Database, now: number): ExportFile {
  const tables: ExportFile["tables"] = {};
  for (const table of userTables(db)) tables[table] = db.prepare(`SELECT * FROM ${table}`).all() as Array<Record<string, unknown>>;
  return { format: "mentem-export", version: LATEST_VERSION, exportedAt: now, tables };
}

/** Checks a parsed file before anything is touched. Throws ImportError with the reason. */
export function validateExport(value: unknown): ExportFile {
  const file = value as Partial<ExportFile> | null;
  if (!file || typeof file !== "object" || file.format !== "mentem-export") throw new ImportError("This is not a Mentem export.");
  if (typeof file.version !== "number" || !Number.isInteger(file.version) || file.version < 1) throw new ImportError("The export has no version.");
  if (file.version > LATEST_VERSION) throw new ImportError("This export is from a newer version of the app. Update the app to import it.");
  if (!file.tables || typeof file.tables !== "object") throw new ImportError("The export has no data.");
  return file as ExportFile;
}

/**
 * Replaces everything with the contents of an export, all or nothing. The caller takes a
 * snapshot first so the import can be undone. Columns the file lacks take their defaults,
 * which is how an export from an older version is carried forward.
 */
export function importData(db: Database.Database, input: unknown): { tables: number; rows: number } {
  const file = validateExport(input);
  const known = new Set(userTables(db));
  let rows = 0;
  const apply = db.transaction(() => {
    db.pragma("defer_foreign_keys = ON");
    for (const table of known) db.prepare(`DELETE FROM ${table}`).run();
    for (const [table, list] of Object.entries(file.tables)) {
      if (!known.has(table)) continue;
      if (!Array.isArray(list)) throw new ImportError(`The data for ${table} is not a list.`);
      const columns = new Set(columnsOf(db, table));
      for (const row of list) {
        const names = Object.keys(row).filter((c) => columns.has(c));
        if (names.length === 0) continue;
        const insert = db.prepare(`INSERT INTO ${table} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`);
        insert.run(...names.map((n) => (row[n] as never)));
        rows += 1;
      }
    }
  });
  apply();
  return { tables: Object.keys(file.tables).filter((t) => known.has(t)).length, rows };
}
