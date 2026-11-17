import { BrowserWindow, Menu, Notification, Tray, app, nativeImage, nativeTheme, screen, shell } from "electron";
import { join } from "node:path";
import type { Settings } from "@mentem/core";
import type { TimerView } from "../shared/api";
import { describeTransition, miniHeight, trayTooltip } from "./notify";

interface Options {
  settings(): Settings;
  /** Opens the mini window's page in a new, locked-down window. */
  createMini(height: number): BrowserWindow;
  showMain(): void;
  act(command: "pause" | "resume" | "skip"): void;
  quit(): void;
}

/**
 * Everything the app does outside its main window: the tray icon, notifications and sounds at
 * transitions, the always-on-top mini window, and starting on login.
 */
export function createPresence(o: Options) {
  let tray: Tray | null = null;
  let mini: BrowserWindow | null = null;
  let last: TimerView | null = null;

  // The logo, in a version that shows on dark taskbars (the black leaf is drawn light there).
  const icon = () => nativeImage.createFromPath(join(app.getAppPath(), "assets", nativeTheme.shouldUseDarkColors ? "tray-dark.png" : "tray.png"));

  const menu = () =>
    Menu.buildFromTemplate([
      { label: `Open ${o.settings().appName}`, click: o.showMain },
      { label: mini ? "Hide mini window" : "Mini window", click: () => toggleMini() },
      { type: "separator" },
      { label: last?.paused ? "Resume" : "Pause", click: () => o.act(last?.paused ? "resume" : "pause") },
      { label: "Skip", click: () => o.act("skip") },
      { type: "separator" },
      { label: "Quit", click: o.quit },
    ]);

  function toggleMini(): boolean {
    if (mini && !mini.isDestroyed()) {
      mini.close();
      return false;
    }
    mini = o.createMini(miniHeight(last));
    const { workArea } = screen.getPrimaryDisplay();
    const [w, h] = mini.getSize() as [number, number];
    mini.setPosition(workArea.x + workArea.width - w - 24, workArea.y + workArea.height - h - 24);
    mini.on("closed", () => {
      mini = null;
      tray?.setContextMenu(menu());
    });
    tray?.setContextMenu(menu());
    return true;
  }

  function applySettings(): void {
    const s = o.settings();
    if (s.keepRunningInTray && !tray) {
      tray = new Tray(icon());
      tray.on("click", o.showMain);
      tray.setContextMenu(menu());
    } else if (!s.keepRunningInTray && tray) {
      tray.destroy();
      tray = null;
    } else {
      tray?.setImage(icon());
    }
    tray?.setToolTip(trayTooltip(s.appName, last, Date.now()));
    // Starting on login only makes sense for the installed app, never a development run.
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: s.startOnLogin });
  }

  function onView(view: TimerView): void {
    const s = o.settings();
    const message = describeTransition(last, view);
    last = view;
    if (message) {
      if (s.notificationsEnabled && Notification.isSupported()) new Notification({ title: message.title, body: message.body, silent: true }).show();
      if (s.soundEnabled) shell.beep();
    }
    tray?.setToolTip(trayTooltip(s.appName, view, view.now));
    if (mini && !mini.isDestroyed()) {
      const [w] = mini.getSize() as [number, number];
      mini.setSize(w, miniHeight(view), false);
    }
  }

  nativeTheme.on("updated", () => tray?.setImage(icon()));

  return {
    applySettings,
    onView,
    toggleMini,
    dispose() {
      tray?.destroy();
      tray = null;
      if (mini && !mini.isDestroyed()) mini.destroy();
    },
  };
}
