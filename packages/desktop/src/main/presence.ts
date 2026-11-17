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
  /** Puts the main window away while the mini window is up. */
  hideMain(): void;
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
  /** Set while the mini window is being closed because the main window is opening. */
  let closingForMain = false;
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
      // With no tray icon there would be no way back to the app, so the main window returns.
      if (!tray && !closingForMain) o.showMain();
    });
    tray?.setContextMenu(menu());
    // One at a time: the mini window takes over from the main one.
    o.hideMain();
    return true;
  }

  /** Closes the mini window because the main window is opening. */
  function closeMini(): void {
    if (!mini || mini.isDestroyed()) return;
    closingForMain = true;
    mini.destroy();
    closingForMain = false;
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
      if (s.notificationsEnabled && Notification.isSupported()) new Notification({ title: message.title, body: message.body, silent: true, icon: nativeImage.createFromPath(join(app.getAppPath(), "assets", "icon.png")) }).show();
      if (s.soundEnabled) shell.beep();
    }
    tray?.setToolTip(trayTooltip(s.appName, view, view.now));
    if (mini && !mini.isDestroyed()) {
      const [w] = mini.getSize() as [number, number];
      mini.setSize(w, miniHeight(view), false);
    }
  }

  nativeTheme.on("updated", () => tray?.setImage(icon()));

  /** Shows a notification of its own, if notifications are on. */
  function notify(message: { title: string; body: string }): void {
    if (o.settings().notificationsEnabled && Notification.isSupported()) new Notification({ ...message, silent: true, icon: nativeImage.createFromPath(join(app.getAppPath(), "assets", "icon.png")) }).show();
  }

  return {
    applySettings,
    closeMini,
    notify,
    onView,
    toggleMini,
    dispose() {
      tray?.destroy();
      tray = null;
      if (mini && !mini.isDestroyed()) mini.destroy();
    },
  };
}
