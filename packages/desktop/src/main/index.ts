import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BrowserWindow, app, dialog, ipcMain, session, shell } from "electron";
import type { Store } from "@mentem/core";
import { CHANNEL, TIMER_CHANNEL } from "../shared/channel";
import type { TimerFeed } from "./timer";
import { controlPath, startControl } from "./control";
import { launcherDir, onPath, syncLauncher } from "./launcher";
import type { Host } from "./data";
import { createPresence } from "./presence";

// The internal id never changes with the display name, so the data can never be orphaned.
const dataDir = process.env.MENTEM_USER_DATA ?? join(app.getPath("appData"), "mentem");
app.setPath("userData", dataDir);

const DB_PATH = join(dataDir, "mentem.db");
const BACKUPS = join(dataDir, "backups");

if (!app.requestSingleInstanceLock()) app.quit();

let mainWindow: BrowserWindow | null = null;
let quitting = false;
let presence: ReturnType<typeof createPresence> | null = null;
let store: Store | null = null;
let core: typeof import("@mentem/core") | null = null;
let feed: TimerFeed | null = null;
let controlServer: import("node:net").Server | null = null;
let onSettingsChanged: () => void = () => undefined;

async function getCore(): Promise<typeof import("@mentem/core")> {
  core ??= await import("@mentem/core");
  return core;
}

/** For checking screens at a known time: MENTEM_NOW="2026-11-16T10:30:00" (development builds only). */
function testClock(): { now(): number } | undefined {
  const fixed = !app.isPackaged && process.env.MENTEM_NOW ? new Date(process.env.MENTEM_NOW).getTime() : NaN;
  if (Number.isNaN(fixed)) return undefined;
  const started = Date.now();
  return { now: () => fixed + (Date.now() - started) };
}

async function openStore(): Promise<Store | null> {
  mkdirSync(dataDir, { recursive: true });
  const api = await getCore();
  try {
    const { db } = api.openDatabase(DB_PATH, { snapshotDir: BACKUPS });
    api.runDailyMaintenance(db, BACKUPS);
    return new api.Store(db, testClock());
  } catch (e) {
    if (e instanceof api.SchemaTooNewError) {
      await dialog.showMessageBox({
        type: "error",
        title: "Mentem",
        message: "Your data is from a newer version of Mentem.",
        detail: "Update the app to open it. Nothing was changed.",
      });
      return null;
    }
    if (e instanceof api.CorruptDatabaseError) {
      const snaps = api.listSnapshots(BACKUPS).filter((s) => s.schemaVersion <= api.LATEST_VERSION);
      const newest = snaps[0];
      const choice = await dialog.showMessageBox({
        type: "error",
        title: "Mentem",
        message: "Your data file is damaged.",
        detail: newest
          ? `The latest backup is from ${new Date(newest.createdAt).toLocaleString()}. Restoring keeps the damaged file aside.`
          : "There is no backup to restore from.",
        buttons: newest ? ["Restore backup", "Quit"] : ["Quit"],
        defaultId: 0,
        cancelId: newest ? 1 : 0,
      });
      if (newest && choice.response === 0) {
        api.restoreSnapshot(DB_PATH, newest.path, BACKUPS, Date.now(), api.LATEST_VERSION);
        return openStore();
      }
      return null;
    }
    throw e;
  }
}

function createWindow(hash: string): BrowserWindow {
  const win = new BrowserWindow({
    useContentSize: true,
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    title: "Mentem",
    backgroundColor: "#ffffff",
    icon: join(app.getAppPath(), "assets", "icon.png"),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.once("ready-to-show", () => win.show());
  // With "keep running in the tray" on, closing the window only hides it.
  win.on("close", (event) => {
    if (!quitting && store?.getSettings().keepRunningInTray) {
      event.preventDefault();
      win.hide();
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(process.env.ELECTRON_RENDERER_URL ?? "file://")) e.preventDefault();
  });
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) void win.loadURL(`${devUrl}${hash}`);
  else void win.loadFile(join(__dirname, "../renderer/index.html"), { hash: hash.replace(/^#/, "") });
  return win;
}

/** Development only: saves the logo as PNG files (MENTEM_ICONS=folder), the source of the app and tray icons. */
async function renderIcons(dir: string): Promise<void> {
  mkdirSync(dir, { recursive: true });
  const jobs: Array<[string, number]> = [["icon", 512], ["tray", 64], ["tray-dark", 64]];
  // One image per run: a second offscreen window in the same run does not finish loading.
  for (const [name, size] of jobs.filter(([n]) => !process.env.MENTEM_ICON_ONLY || n === process.env.MENTEM_ICON_ONLY)) {
    writeFileSync(join(dir, "log.txt"), `start ${name}
`, { flag: "a" });
    const win = new BrowserWindow({ width: size, height: size, useContentSize: true, frame: false, transparent: true, resizable: false, show: false, webPreferences: { preload: join(__dirname, "../preload/index.js"), sandbox: true, offscreen: true } });
    const devUrl = process.env.ELECTRON_RENDERER_URL;
    if (devUrl) await win.loadURL(`${devUrl}#${name}`);
    else await win.loadFile(join(__dirname, "../renderer/index.html"), { hash: name });
    await new Promise((r) => setTimeout(r, 900));
    writeFileSync(join(dir, "log.txt"), `loaded ${name}
`, { flag: "a" });
    const image = (await win.webContents.capturePage()).resize({ width: size, height: size, quality: "best" });
    writeFileSync(join(dir, `${name}.png`), image.toPNG());
    win.destroy();
  }
}

/** The small always-on-top window with the current task and time left. Created only while shown. */
function createMiniWindow(height: number): BrowserWindow {
  const win = new BrowserWindow({
    width: 340,
    height,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: true,
    show: false,
    title: "Mentem",
    icon: join(app.getAppPath(), "assets", "icon.png"),
    webPreferences: { preload: join(__dirname, "../preload/index.js"), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  win.setAlwaysOnTop(true, "floating");
  win.once("ready-to-show", () => win.showInactive());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) void win.loadURL(`${devUrl}#mini`);
  else void win.loadFile(join(__dirname, "../renderer/index.html"), { hash: "mini" });
  return win;
}

/** For checking screens without a human: MENTEM_SHOT=file.png [MENTEM_SHOT_DELAY=ms]. */
function scheduleScreenshot(win: BrowserWindow): void {
  const file = process.env.MENTEM_SHOT;
  if (!file) {
    // Development only: run a script in the page without taking a picture or quitting.
    if (!app.isPackaged && process.env.MENTEM_EVAL) win.webContents.once("did-finish-load", () => setTimeout(() => void win.webContents.executeJavaScript(process.env.MENTEM_EVAL ?? ""), Number(process.env.MENTEM_SHOT_DELAY ?? 3000)));
    return;
  }
  const delay = Number(process.env.MENTEM_SHOT_DELAY ?? 3000);
  win.webContents.once("did-finish-load", () => {
    setTimeout(async () => {
      // Development only: lets a check script click through screens before the capture.
      if (!app.isPackaged && process.env.MENTEM_EVAL) await win.webContents.executeJavaScript(process.env.MENTEM_EVAL);
      // Development only: MENTEM_SHOT_MINI=1 captures the mini window instead of the main one.
      const target = !app.isPackaged && process.env.MENTEM_SHOT_MINI ? (BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("mini")) ?? win) : win;
      const image = await target.webContents.capturePage();
      writeFileSync(file, image.toPNG());
      app.quit();
    }, delay);
  });
}

app.whenReady().then(async () => {
  if (!app.isPackaged && process.env.MENTEM_ICONS) {
    await renderIcons(process.env.MENTEM_ICONS);
    return app.quit();
  }
  if (app.isPackaged) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; connect-src 'self'",
          ],
        },
      });
    });
  }
  store = await openStore();
  if (!store) return app.quit();
  const { createApi } = await import("./api");
  const { createTimerFeed } = await import("./timer");
  const mentem = await getCore();
  core = mentem;
  const openStoreRef = store;
  mentem.runRollover(openStoreRef);
  mentem.materializeRepeats(openStoreRef);
  const engine = new mentem.TimerEngine(openStoreRef);
  const send = (view: import("../shared/api").TimerView) => {
    presence?.onView(view);
    for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send(TIMER_CHANNEL, view);
  };
  feed = createTimerFeed(engine, openStoreRef, mentem, send, () => {
    mentem.runRollover(openStoreRef);
    mentem.materializeRepeats(openStoreRef);
  });
  const feedRef = feed;
  presence = createPresence({
    settings: () => openStoreRef.getSettings(),
    createMini: (height) => createMiniWindow(height),
    showMain: () => {
      if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createWindow("");
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    },
    act: (command) => {
      if (command === "pause") engine.pause();
      else if (command === "resume") engine.resume();
      else engine.skip();
      feedRef.refresh();
    },
    quit: () => app.quit(),
  });
  presence.applySettings();
  const cliInfo = () => {
    const dir = launcherDir({ dataDir });
    return { name: openStoreRef.getSettings().cliName, dir, onPath: onPath(dir), canAddToPath: process.platform === "win32" };
  };
  const host: Host = {
    dataDir,
    backups: BACKUPS,
    dbPath: DB_PATH,
    chooseSaveFile: async (defaultName) => {
      const r = await dialog.showSaveDialog({ defaultPath: defaultName, filters: [{ name: "Export", extensions: ["json"] }] });
      return r.canceled || !r.filePath ? null : r.filePath;
    },
    chooseOpenFile: async () => {
      const r = await dialog.showOpenDialog({ properties: ["openFile"], filters: [{ name: "Export", extensions: ["json"] }] });
      return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
    },
    readFile: (path) => readFileSync(path, "utf8"),
    writeFile: (path, text) => writeFileSync(path, text, "utf8"),
    relaunch: () => {
      app.relaunch();
      app.exit(0);
    },
    cli: cliInfo,
    toggleMini: () => presence?.toggleMini() ?? false,
    addCliToPath: () => {
      if (process.platform === "win32") {
        const dir = launcherDir({ dataDir });
        // Adds the folder to the person's own PATH only, never the machine's.
        const script = `$d = $env:MENTEM_BIN; $p = [Environment]::GetEnvironmentVariable('Path','User'); if (($p -split ';') -notcontains $d) { [Environment]::SetEnvironmentVariable('Path', ($p.TrimEnd(';') + ';' + $d), 'User') }`;
        execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { env: { ...process.env, MENTEM_BIN: dir } }, () => undefined);
        process.env.PATH = `${process.env.PATH ?? ""};${dir}`;
      }
      return cliInfo();
    },
  };
  const api = createApi({
    store: openStoreRef,
    engine,
    core: mentem,
    info: { version: app.getVersion(), platform: process.platform, startHash: process.env.MENTEM_HASH ?? "" },
    refresh: () => feedRef.refresh(),
    host,
  });
  if (!app.isPackaged && process.env.MENTEM_SEED && !openStoreRef.getSettings().setupCompleted) {
    const { seedSampleDay } = await import("./devSeed");
    await seedSampleDay(process.env.MENTEM_SEED, api, openStoreRef, mentem);
  }
  const makeLauncher = () => {
    try {
      syncLauncher({ name: openStoreRef.getSettings().cliName, runtime: process.execPath, script: join(__dirname, "cli.js"), dataDir });
    } catch (error) {
      console.error("[mentem] could not write the command launcher:", error);
    }
  };
  if (openStoreRef.getSettings().setupCompleted) makeLauncher();
  onSettingsChanged = () => {
    makeLauncher();
    presence?.applySettings();
  };
  controlServer = startControl(controlPath(dataDir), engine, () => feedRef.refresh());
  ipcMain.handle(CHANNEL, async (_event, method: string, ...args: unknown[]) => {
    if (!Object.prototype.hasOwnProperty.call(api, method)) throw new Error(`Unknown call: ${method}`);
    const fn = (api as unknown as Record<string, (...a: unknown[]) => unknown>)[method];
    try {
      const result = await fn?.(...args);
      if (method === "settingsUpdate" || method === "onboardingComplete") onSettingsChanged();
      return result;
    } catch (error) {
      // The window only gets a short message; the full reason belongs in the log.
      console.error(`[mentem] ${method} failed:`, error);
      throw error;
    }
  });
  mainWindow = createWindow(process.env.MENTEM_HASH ?? "");
  scheduleScreenshot(mainWindow);
  feedRef.refresh();
});

app.on("second-instance", () => {
  if (mainWindow) {
    mainWindow.show();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on("before-quit", () => {
  quitting = true;
});

app.on("window-all-closed", () => {
  feed?.stop();
  controlServer?.close();
  presence?.dispose();
  store?.db.close();
  app.quit();
});
