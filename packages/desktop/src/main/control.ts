import { chmodSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { join } from "node:path";
import type { TimerEngine } from "@mentem/core";

const COMMANDS = new Set(["pause", "resume", "skip", "done", "refresh"]);

export function controlPath(dataDir: string, platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? String.raw`\\.\pipe\mentem-control` : join(dataDir, "mentem.sock");
}

/**
 * Lets the command line control the running timer (FR-50). It listens on a local pipe or
 * socket only, takes a few fixed commands, and ignores anything else. "refresh" has no effect
 * of its own: it makes the app look at the data again after the command line changed it.
 */
export function startControl(path: string, engine: TimerEngine, refresh: () => void): Server {
  if (process.platform !== "win32") rmSync(path, { force: true });
  const server = createServer((socket) => {
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      if (buffer.length > 1000) return socket.destroy();
      if (!buffer.includes("\n")) return;
      let command = "";
      try {
        command = String((JSON.parse(buffer) as { command?: unknown }).command);
      } catch {
        /* handled below */
      }
      if (!COMMANDS.has(command)) {
        socket.end(`${JSON.stringify({ ok: false, message: "Unknown command." })}\n`);
        return;
      }
      if (command === "pause") engine.pause();
      else if (command === "resume") engine.resume();
      else if (command === "skip") engine.skip();
      else if (command === "done") engine.done();
      refresh();
      socket.end(`${JSON.stringify({ ok: true, message: `Done: ${command}.` })}\n`);
    });
    socket.on("error", () => socket.destroy());
  });
  server.on("error", () => undefined);
  server.listen(path, () => {
    if (process.platform !== "win32") chmodSync(path, 0o600);
  });
  return server;
}
