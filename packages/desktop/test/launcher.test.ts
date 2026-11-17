import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { launcherDir, launcherText, onPath, syncLauncher } from "../src/main/launcher";

const dirs: string[] = [];
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), "mentem-launcher-"));
  dirs.push(d);
  return d;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

describe("the command launcher", () => {
  it("runs the command line on the app's own runtime", () => {
    const win = launcherText({ runtime: String.raw`C:\App\Mentem.exe`, script: String.raw`C:\App\cli.js` }, "win32");
    expect(win).toBe(`@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"C:\\App\\Mentem.exe" "C:\\App\\cli.js" %*\r\n`);
    expect(launcherText({ runtime: "/opt/Mentem", script: "/opt/cli.js" }, "linux")).toBe('#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "/opt/Mentem" "/opt/cli.js" "$@"\n');
  });

  it("puts launchers where each system looks for commands", () => {
    expect(launcherDir({ dataDir: "d", platform: "linux", home: "/home/a" })).toBe(join("/home/a", ".local", "bin"));
    expect(launcherDir({ dataDir: "d", platform: "win32", localAppData: String.raw`C:\L` })).toBe(join(String.raw`C:\L`, "Mentem", "bin"));
  });

  it("writes the launcher, and replaces it when the command is renamed", () => {
    const home = temp();
    const dataDir = temp();
    const base = { runtime: "/opt/Mentem", script: "/opt/cli.js", dataDir, platform: "linux" as const, home };
    const first = syncLauncher({ ...base, name: "mentem" });
    expect(readFileSync(first, "utf8")).toContain("/opt/cli.js");
    if (process.platform !== "win32") expect(statSync(first).mode & 0o111).not.toBe(0);
    const second = syncLauncher({ ...base, name: "myday" });
    expect(existsSync(second)).toBe(true);
    expect(existsSync(first)).toBe(false);
  });

  it("refuses a name that could do harm", () => {
    const base = { runtime: "r", script: "s", dataDir: temp(), platform: "linux" as const, home: temp() };
    for (const name of ["../evil", "a b", "x;rm", "", "a".repeat(31)]) expect(() => syncLauncher({ ...base, name })).toThrow();
  });

  it("tells whether the folder is on the PATH, ignoring a trailing slash and case on Windows", () => {
    expect(onPath("/home/a/.local/bin", "/usr/bin:/home/a/.local/bin/", "linux")).toBe(true);
    expect(onPath("/home/a/.local/bin", "/usr/bin", "linux")).toBe(false);
    expect(onPath(String.raw`C:\Users\A\Mentem\bin`, "C:\\Windows;c:\\users\\a\\mentem\\bin\\", "win32")).toBe(true);
  });
});
