import type * as Core from "@mentem/core";
import type { Store } from "@mentem/core";
import type { Api, CliInfo, SnapshotView, UpdateState } from "../shared/api";

/** What the data tools need from the operating system, so they can be tested without a window. */
export interface Host {
  dataDir: string;
  backups: string;
  dbPath: string;
  /** Asks where to save or what to open. Null when the person cancels. */
  chooseSaveFile(defaultName: string): Promise<string | null>;
  chooseOpenFile(): Promise<string | null>;
  readFile(path: string): string;
  writeFile(path: string, text: string): void;
  /** Quits and starts the app again, after the database file has been replaced. */
  relaunch(): void;
  cli(): CliInfo;
  addCliToPath(): CliInfo;
  toggleMini(): boolean;
  updateState(): UpdateState;
  updateCheck(): Promise<UpdateState>;
  updateInstall(): void;
}

type DataApi = Pick<Api, "dataSnapshots" | "dataBackup" | "dataRestore" | "dataExport" | "dataImport" | "cliInfo" | "cliAddToPath" | "miniToggle" | "updateGet" | "updateCheck" | "updateInstall">;

export function createDataApi(store: Store, core: typeof Core, host: Host): DataApi {
  const snapshots = (): SnapshotView[] =>
    core
      .listSnapshots(host.backups)
      .filter((s) => s.schemaVersion <= core.LATEST_VERSION)
      .map((s) => ({ name: s.name, kind: s.kind, createdAt: s.createdAt, bytes: s.bytes }));

  return {
    async dataSnapshots() {
      return snapshots();
    },

    async dataBackup() {
      core.createSnapshot(store.db, host.backups, "manual", store.clock.now(), core.LATEST_VERSION);
      return snapshots();
    },

    async dataRestore(name) {
      const snap = core.listSnapshots(host.backups).find((s) => s.name === String(name));
      if (!snap || snap.schemaVersion > core.LATEST_VERSION) throw new Error("No such backup");
      store.db.close();
      core.restoreSnapshot(host.dbPath, snap.path, host.backups, store.clock.now(), core.LATEST_VERSION);
      host.relaunch();
    },

    async dataExport() {
      const stamp = core.dateOf(store.clock.now());
      const path = await host.chooseSaveFile(`mentem-export-${stamp}.json`);
      if (!path) return null;
      host.writeFile(path, JSON.stringify(core.exportData(store.db, store.clock.now()), null, 2));
      return path;
    },

    async dataImport() {
      const path = await host.chooseOpenFile();
      if (!path) return null;
      let parsed: unknown;
      try {
        parsed = JSON.parse(host.readFile(path));
      } catch {
        throw new Error("That file isn't readable JSON.");
      }
      core.validateExport(parsed);
      core.createSnapshot(store.db, host.backups, "pre-restore", store.clock.now(), core.LATEST_VERSION);
      const result = core.importData(store.db, parsed);
      return { rows: result.rows };
    },

    async updateGet() {
      return host.updateState();
    },

    async updateCheck() {
      return host.updateCheck();
    },

    async updateInstall() {
      host.updateInstall();
    },

    async cliInfo() {
      return host.cli();
    },

    async cliAddToPath() {
      return host.addCliToPath();
    },

    async miniToggle() {
      return host.toggleMini();
    },
  };
}
