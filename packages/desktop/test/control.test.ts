import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { TimerEngine } from "@mentem/core";
import { controlPath, startControl } from "../src/main/control";

const servers: Array<{ close(): void }> = [];
afterEach(() => servers.splice(0).forEach((s) => s.close()));

const unique = () => `mentem-test-${process.pid}-${Math.random().toString(36).slice(2)}`;
const pathFor = () => (process.platform === "win32" ? String.raw`\\.\pipe\${unique()}` : join(tmpdir(), `${unique()}.sock`));

function fakeEngine() {
  const calls: string[] = [];
  const engine = {
    pause: () => calls.push("pause"),
    resume: () => calls.push("resume"),
    skip: () => calls.push("skip"),
    done: () => calls.push("done"),
  } as unknown as TimerEngine;
  return { engine, calls };
}

function ask(path: string, text: string): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    let data = "";
    socket.on("connect", () => socket.write(text));
    socket.on("data", (d) => (data += d.toString()));
    socket.on("end", () => resolve(JSON.parse(data)));
    socket.on("error", reject);
  });
}

async function listening(path: string): Promise<void> {
  for (let i = 0; i < 40; i += 1) {
    const reachable = await new Promise<boolean>((done) => {
      const probe = createConnection(path);
      probe.on("connect", () => {
        probe.destroy();
        done(true);
      });
      probe.on("error", () => done(false));
    });
    if (reachable) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("the control server never started");
}

describe("timer control from the command line", () => {
  it("names the pipe or socket by system", () => {
    expect(controlPath("/data", "linux")).toBe(join("/data", "mentem.sock"));
    expect(controlPath("/data", "win32")).toBe(String.raw`\\.\pipe\mentem-control`);
  });

  it("runs the four commands and refreshes the window", async () => {
    const path = pathFor();
    const { engine, calls } = fakeEngine();
    let refreshed = 0;
    servers.push(startControl(path, engine, () => (refreshed += 1)));
    await listening(path);
    for (const command of ["pause", "resume", "skip", "done"]) {
      expect(await ask(path, `${JSON.stringify({ command })}\n`)).toEqual({ ok: true, message: `Done: ${command}.` });
    }
    expect(calls).toEqual(["pause", "resume", "skip", "done"]);
    expect(refreshed).toBe(4);
  });

  it("takes a refresh after the command line changed the data, and only refreshes", async () => {
    const path = pathFor();
    const { engine, calls } = fakeEngine();
    let refreshed = 0;
    servers.push(startControl(path, engine, () => (refreshed += 1)));
    await listening(path);
    expect((await ask(path, `${JSON.stringify({ command: "refresh" })}
`)).ok).toBe(true);
    expect(calls).toEqual([]);
    expect(refreshed).toBe(1);
  });

  it("ignores anything that is not one of the commands", async () => {
    const path = pathFor();
    const { engine, calls } = fakeEngine();
    servers.push(startControl(path, engine, () => undefined));
    await listening(path);
    expect((await ask(path, `${JSON.stringify({ command: "delete everything" })}\n`)).ok).toBe(false);
    expect((await ask(path, "not json\n")).ok).toBe(false);
    expect((await ask(path, `${JSON.stringify({ nothing: true })}\n`)).ok).toBe(false);
    expect(calls).toEqual([]);
  });
});
