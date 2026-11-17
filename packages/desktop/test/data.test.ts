import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import * as core from "@mentem/core";
import { FakeClock, Store, openDatabase } from "@mentem/core";
import { createDataApi, type Host } from "../src/main/data";

const dirs: string[] = [];
const open: Array<{ close(): void }> = [];
afterEach(() => {
  // Windows will not delete a database file that is still open.
  for (const db of open.splice(0)) {
    try {
      db.close();
    } catch {
      /* already closed by a restore */
    }
  }
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "mentem-data-"));
  dirs.push(dir);
  const clock = new FakeClock(new Date(2026, 10, 16, 9, 0));
  const dbPath = join(dir, "mentem.db");
  const { db } = openDatabase(dbPath, { clock });
  open.push(db);
  const store = new Store(db, clock);
  const files = new Map<string, string>();
  const picks: { save: string | null; open: string | null } = { save: "out.json", open: "out.json" };
  let relaunched = 0;
  const host: Host = {
    dataDir: dir,
    backups: join(dir, "backups"),
    dbPath,
    chooseSaveFile: async () => picks.save,
    chooseOpenFile: async () => picks.open,
    readFile: (path) => {
      const text = files.get(path);
      if (text === undefined) throw new Error("no file");
      return text;
    },
    writeFile: (path, text) => void files.set(path, text),
    relaunch: () => void (relaunched += 1),
    cli: () => ({ name: "mentem", dir: "/bin", onPath: false, canAddToPath: false }),
    addCliToPath: () => ({ name: "mentem", dir: "/bin", onPath: true, canAddToPath: false }),
    toggleMini: () => true,
  };
  return { dir, dbPath, clock, store, host, files, picks, api: createDataApi(store, core, host), relaunched: () => relaunched };
}

describe("backups", () => {
  it("lists nothing at first, then what was backed up", async () => {
    const { api } = setup();
    expect(await api.dataSnapshots()).toEqual([]);
    const after = await api.dataBackup();
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ kind: "manual" });
    expect(after[0]!.bytes).toBeGreaterThan(0);
  });

  it("puts the data back and restarts the app", async () => {
    const { api, store, dbPath, relaunched } = setup();
    store.createTask({ title: "Before the backup" });
    const [snap] = await api.dataBackup();
    store.createTask({ title: "After the backup" });
    await api.dataRestore(snap!.name);
    expect(relaunched()).toBe(1);
    const reopenedDb = openDatabase(dbPath).db;
    open.push(reopenedDb);
    const reopened = new Store(reopenedDb);
    expect(reopened.listTasks().map((t) => t.title)).toEqual(["Before the backup"]);
  });

  it("refuses to restore a backup that does not exist", async () => {
    const { api } = setup();
    await expect(api.dataRestore("mentem-manual-1-v1.db")).rejects.toThrow("No such backup");
    await expect(api.dataRestore("../../elsewhere")).rejects.toThrow("No such backup");
  });
});

describe("export and import", () => {
  it("writes a file to where the person chose, and does nothing when they cancel", async () => {
    const { api, files, picks, store } = setup();
    store.createTask({ title: "Exported" });
    expect(await api.dataExport()).toBe("out.json");
    expect(JSON.parse(files.get("out.json")!)).toMatchObject({ format: "mentem-export" });
    picks.save = null;
    files.clear();
    expect(await api.dataExport()).toBeNull();
    expect(files.size).toBe(0);
  });

  it("replaces everything with the file, and keeps a backup of what was there", async () => {
    const { api, store, files } = setup();
    store.createTask({ title: "Keep" });
    await api.dataExport();
    store.createTask({ title: "Gone after import" });
    const result = await api.dataImport();
    expect(result?.rows).toBeGreaterThan(0);
    expect(store.listTasks().map((t) => t.title)).toEqual(["Keep"]);
    expect((await api.dataSnapshots()).map((s) => s.kind)).toContain("pre-restore");
    expect(files.has("out.json")).toBe(true);
  });

  it("changes nothing when the file is wrong, or when they cancel", async () => {
    const { api, store, files, picks } = setup();
    store.createTask({ title: "Untouched" });
    files.set("out.json", "{ not json");
    await expect(api.dataImport()).rejects.toThrow("isn't readable JSON");
    files.set("out.json", JSON.stringify({ hello: "world" }));
    await expect(api.dataImport()).rejects.toThrow("not a Mentem export");
    picks.open = null;
    expect(await api.dataImport()).toBeNull();
    expect(store.listTasks().map((t) => t.title)).toEqual(["Untouched"]);
    expect(await api.dataSnapshots()).toEqual([]);
  });
});

describe("the command line", () => {
  it("reports where the launcher is and can add it to the PATH", async () => {
    const { api } = setup();
    expect(await api.cliInfo()).toMatchObject({ name: "mentem", onPath: false });
    expect(await api.cliAddToPath()).toMatchObject({ onPath: true });
  });
});
