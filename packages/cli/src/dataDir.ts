import { homedir } from "node:os";
import { join } from "node:path";

/** Where the app keeps its data. The same place the desktop app uses, whatever the app is called. */
export function dataDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  if (env.MENTEM_USER_DATA) return env.MENTEM_USER_DATA;
  if (platform === "win32") return join(env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "mentem");
  if (platform === "darwin") return join(homedir(), "Library", "Application Support", "mentem");
  return join(env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "mentem");
}

/** The local socket the running app listens on for timer control. */
export function controlPath(dir: string, platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? String.raw`\\.\pipe\mentem-control` : join(dir, "mentem.sock");
}
