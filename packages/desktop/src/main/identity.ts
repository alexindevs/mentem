import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { app, nativeImage, shell } from "electron";
import { pngToIco } from "./icofile";

export const APP_ID = "com.mentem.app";

/**
 * Gives Windows notifications the app's own name and logo. Windows takes both from a Start
 * menu shortcut that carries the app's id; an installed build gets that from its installer,
 * but a development run has none and would show up as "Electron".
 */
export function registerWindowsIdentity(name: string): void {
  if (process.platform !== "win32") return;
  app.setAppUserModelId(APP_ID);
  if (app.isPackaged) return;
  try {
    const link = join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs", `${name}.lnk`);
    const icon = join(app.getPath("userData"), "mentem.ico");
    if (!existsSync(icon)) {
      const png = nativeImage.createFromPath(join(app.getAppPath(), "assets", "icon.png")).resize({ width: 256, height: 256 }).toPNG();
      mkdirSync(dirname(icon), { recursive: true });
      writeFileSync(icon, pngToIco(png, 256));
    }
    shell.writeShortcutLink(link, existsSync(link) ? "update" : "create", { target: process.execPath, args: app.getAppPath(), appUserModelId: APP_ID, icon, iconIndex: 0, description: name });
  } catch (error) {
    console.error("[mentem] could not register the app name for notifications:", error);
  }
}
