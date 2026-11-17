import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface LauncherOptions {
  /** The command name chosen in setup, such as "mentem". */
  name: string;
  /** The app's own executable and the built command-line script it runs. */
  runtime: string;
  script: string;
  /** The app's data folder, where the record of the last launcher is kept. */
  dataDir: string;
  platform?: NodeJS.Platform;
  home?: string;
  localAppData?: string;
}

const NAME = /^[A-Za-z0-9-]{1,30}$/;

/** The folder launchers go in: ~/.local/bin where it exists on most PATHs, a folder of our own on Windows. */
export function launcherDir(o: Pick<LauncherOptions, "dataDir" | "platform" | "home" | "localAppData">): string {
  const platform = o.platform ?? process.platform;
  if (platform === "win32") return join(o.localAppData ?? process.env.LOCALAPPDATA ?? join(o.home ?? homedir(), "AppData", "Local"), "Mentem", "bin");
  return join(o.home ?? homedir(), ".local", "bin");
}

export function launcherText(o: Pick<LauncherOptions, "runtime" | "script">, platform: NodeJS.Platform): string {
  return platform === "win32"
    ? `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${o.runtime}" "${o.script}" %*\r\n`
    : `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${o.runtime}" "${o.script}" "$@"\n`;
}

/**
 * Writes the launcher for the chosen command name and removes the one it replaces
 * (FR-53, FR-54). Returns the file written.
 */
export function syncLauncher(o: LauncherOptions): string {
  if (!NAME.test(o.name)) throw new Error("The command name can only use letters, numbers and hyphens.");
  const platform = o.platform ?? process.platform;
  const dir = launcherDir(o);
  const file = (name: string) => join(dir, platform === "win32" ? `${name}.cmd` : name);
  const record = join(o.dataDir, "launcher.json");
  mkdirSync(dir, { recursive: true });
  try {
    const old = (JSON.parse(readFileSync(record, "utf8")) as { name?: string }).name;
    if (old && old !== o.name && NAME.test(old)) rmSync(file(old), { force: true });
  } catch {
    /* no earlier launcher */
  }
  const target = file(o.name);
  writeFileSync(target, launcherText(o, platform), "utf8");
  if (platform !== "win32") chmodSync(target, 0o755);
  mkdirSync(o.dataDir, { recursive: true });
  writeFileSync(record, JSON.stringify({ name: o.name }), "utf8");
  return target;
}

export function onPath(dir: string, pathValue = process.env.PATH ?? "", platform: NodeJS.Platform = process.platform): boolean {
  const norm = (p: string) => (platform === "win32" ? p.toLowerCase().replace(/[\\/]+$/, "") : p.replace(/\/+$/, ""));
  return pathValue.split(platform === "win32" ? ";" : ":").some((p) => p && norm(p) === norm(dir));
}

export const launcherExists = (o: LauncherOptions): boolean => existsSync(join(launcherDir(o), (o.platform ?? process.platform) === "win32" ? `${o.name}.cmd` : o.name));
