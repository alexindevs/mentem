import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createUpdates, pickUpdater, type Updater } from "../src/main/updates";

class FakeUpdater extends EventEmitter {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  installed = false;
  /** What a check does: say what it finds. */
  onCheck: () => void = () => this.emit("update-not-available");
  async checkForUpdates() {
    this.emit("checking-for-update");
    this.onCheck();
  }
  quitAndInstall() {
    this.installed = true;
  }
}
const make = (fake = new FakeUpdater()) => {
  const beforeInstall = vi.fn();
  const ready = vi.fn();
  const updates = createUpdates({ updater: fake as unknown as Updater, version: "0.1.0", beforeInstall, ready, now: () => 1000, firstCheckMs: 50, everyMs: 100 });
  return { fake, updates, beforeInstall, ready };
};

describe("finding the updater in the module", () => {
  const updater = new FakeUpdater() as unknown as Updater;

  it("takes the named export when there is one, or the one under default when there is not", () => {
    expect(pickUpdater({ autoUpdater: updater })).toBe(updater);
    expect(pickUpdater({ default: { autoUpdater: updater } })).toBe(updater);
    expect(pickUpdater({ autoUpdater: updater, default: { autoUpdater: new FakeUpdater() } })).toBe(updater);
  });

  it("gives nothing when the module has no updater, so the app says updates are unavailable", () => {
    expect(pickUpdater({})).toBeNull();
    expect(pickUpdater(null)).toBeNull();
    expect(pickUpdater({ default: {} })).toBeNull();
  });
});

describe("updates", () => {
  it("does nothing in a development run", async () => {
    const updates = createUpdates({ updater: null, version: "0.1.0", beforeInstall: vi.fn(), ready: vi.fn() });
    expect(updates.state().status).toBe("unavailable");
    expect((await updates.check()).status).toBe("unavailable");
    updates.start();
    updates.install();
    updates.stop();
  });

  it("downloads in the background and installs when the app quits", () => {
    const { fake } = make();
    expect(fake.autoDownload).toBe(true);
    expect(fake.autoInstallOnAppQuit).toBe(true);
  });

  it("says when it is up to date", async () => {
    const { updates } = make();
    expect(await updates.check()).toMatchObject({ status: "current", checkedAt: 1000, available: null });
  });

  it("follows a new version from found to ready, backing up first and telling the person", async () => {
    const { fake, updates, beforeInstall, ready } = make();
    fake.onCheck = () => {
      fake.emit("update-available", { version: "0.2.0" });
      fake.emit("download-progress", { percent: 41.6 });
    };
    expect(await updates.check()).toMatchObject({ status: "downloading", available: "0.2.0", percent: 42 });
    fake.emit("update-downloaded", { version: "0.2.0" });
    expect(beforeInstall).toHaveBeenCalledOnce();
    expect(ready).toHaveBeenCalledWith("0.2.0");
    expect(updates.state()).toMatchObject({ status: "ready", percent: 100 });
    updates.install();
    expect(fake.installed).toBe(true);
  });

  it("still tells the person when the backup fails, and keeps a finished download through a later error", () => {
    const { fake, updates, beforeInstall, ready } = make();
    beforeInstall.mockImplementation(() => {
      throw new Error("disk full");
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    fake.emit("update-downloaded", { version: "0.2.0" });
    expect(ready).toHaveBeenCalled();
    fake.emit("error", new Error("offline"));
    expect(updates.state().status).toBe("ready");
  });

  it("reports an error without throwing, and will not install what is not downloaded", async () => {
    const { fake, updates } = make();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    fake.onCheck = () => fake.emit("error", new Error("offline"));
    expect((await updates.check()).status).toBe("error");
    updates.install();
    expect(fake.installed).toBe(false);
  });

  it("checks after a delay and then on a schedule, with one timer at a time", async () => {
    vi.useFakeTimers();
    const { fake, updates } = make();
    const spy = vi.spyOn(fake, "checkForUpdates");
    updates.start();
    updates.start();
    await vi.advanceTimersByTimeAsync(49);
    expect(spy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(spy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(spy).toHaveBeenCalledTimes(2);
    updates.stop();
    await vi.advanceTimersByTimeAsync(500);
    expect(spy).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
