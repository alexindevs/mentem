import type { UpdateState } from "../shared/pages";

/** The few parts of electron-updater the app uses, so the rest can be tested without it. */
export interface Updater {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on(event: string, listener: (...args: any[]) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

/**
 * Finds the updater inside the electron-updater module. It is a CommonJS module whose
 * `autoUpdater` is a lazy getter, so when it is loaded with import() the named export may be
 * missing and the object sits under `default` instead. Either way, this returns it.
 */
export function pickUpdater(mod: unknown): Updater | null {
  const m = mod as { autoUpdater?: Updater; default?: { autoUpdater?: Updater } } | null | undefined;
  return m?.autoUpdater ?? m?.default?.autoUpdater ?? null;
}

export interface UpdatesOptions {
  /** Null in a development run, where there is nothing installed to update. */
  updater: Updater | null;
  /** The version that is running. */
  version: string;
  /** Called once an update has been downloaded, before it can be installed: take a snapshot here. */
  beforeInstall(): void;
  /** Called when an update is ready, to tell the person. */
  ready(version: string): void;
  now?(): number;
  /** First check after this long, then every `every`. Both in milliseconds. */
  firstCheckMs?: number;
  everyMs?: number;
}

/**
 * Looks for a new version a little after launch and every few hours after that, downloads it
 * quietly, and installs it when the app is next quit. A single timer is armed at a time, so
 * an idle app does nothing in between.
 */
export function createUpdates(o: UpdatesOptions) {
  const now = o.now ?? Date.now;
  let state: UpdateState = { status: o.updater ? "idle" : "unavailable", version: o.version, available: null, percent: null, checkedAt: null };
  let timer: ReturnType<typeof setTimeout> | null = null;
  const set = (change: Partial<UpdateState>) => void (state = { ...state, ...change });

  if (o.updater) {
    const u = o.updater;
    u.autoDownload = true;
    u.autoInstallOnAppQuit = true;
    u.on("checking-for-update", () => set({ status: "checking" }));
    u.on("update-available", (info: { version: string }) => set({ status: "downloading", available: info.version, percent: 0 }));
    u.on("download-progress", (p: { percent: number }) => set({ status: "downloading", percent: Math.round(p.percent) }));
    u.on("update-not-available", () => set({ status: "current", available: null, percent: null, checkedAt: now() }));
    u.on("update-downloaded", (info: { version: string }) => {
      try {
        o.beforeInstall();
      } catch (error) {
        console.error("[mentem] could not back up before the update:", error);
      }
      set({ status: "ready", available: info.version, percent: 100, checkedAt: now() });
      o.ready(info.version);
    });
    u.on("error", (error: unknown) => {
      console.error("[mentem] update check failed:", error);
      // Keep a finished download: it still installs on quit.
      if (state.status !== "ready") set({ status: "error", percent: null, checkedAt: now() });
    });
  }

  async function check(): Promise<UpdateState> {
    if (!o.updater || state.status === "checking" || state.status === "downloading" || state.status === "ready") return state;
    try {
      await o.updater.checkForUpdates();
    } catch {
      /* the error event has already recorded it */
    }
    return state;
  }

  function schedule(ms: number): void {
    timer = setTimeout(() => {
      void check().finally(() => schedule(o.everyMs ?? 6 * 60 * 60_000));
    }, ms);
    timer.unref?.();
  }

  return {
    state: () => state,
    check,
    install() {
      if (o.updater && state.status === "ready") o.updater.quitAndInstall(false, true);
    },
    start() {
      if (o.updater && !timer) schedule(o.firstCheckMs ?? 30_000);
    },
    stop() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
