import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CorruptDatabaseError, SchemaTooNewError, Store, TimerEngine, openDatabase } from "@mentem/core";
import { runCommand } from "./commands";
import { controlPath, dataDir } from "./dataDir";
import { sendControl } from "./control";

/** The command-line entry. It runs on the app's own bundled Node, so nothing else needs installing. */
async function main(): Promise<number> {
  const dir = dataDir();
  const backups = join(dir, "backups");
  const dbPath = join(dir, "mentem.db");
  mkdirSync(dir, { recursive: true });
  try {
    const { db } = openDatabase(dbPath, { snapshotDir: backups });
    const store = new Store(db);
    const result = await runCommand(process.argv.slice(2), {
      store,
      engine: new TimerEngine(store),
      backups,
      dbPath,
      control: (command) => sendControl(controlPath(dir), command),
      readFile: (path) => readFileSync(path, "utf8"),
      writeFile: (path, text) => writeFileSync(path, text, "utf8"),
    });
    if (result.out) (result.code === 0 ? process.stdout : process.stderr).write(`${result.out}\n`);
    try {
      db.close();
    } catch {
      /* restore already closed it */
    }
    return result.code;
  } catch (e) {
    if (e instanceof SchemaTooNewError) process.stderr.write("Your data is from a newer version of the app. Update it to use the command line.\n");
    else if (e instanceof CorruptDatabaseError) process.stderr.write("Your data file is damaged. Open the app to restore a backup.\n");
    else process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
}

void main().then((code) => process.exit(code));
