import { afterEach, describe, expect, it, vi } from "vitest";
import * as core from "@mentem/core";
import { FakeClock, Store, TimerEngine, openDatabase } from "@mentem/core";
import { createTimerFeed } from "../src/main/timer";

vi.mock("electron", () => ({ powerMonitor: { on: () => undefined, removeListener: () => undefined } }));

const open: Array<{ close(): void }> = [];
afterEach(() => {
  vi.useRealTimers();
  open.splice(0).forEach((db) => db.close());
});

describe("the timer feed and rollover", () => {
  it("rolls unfinished work forward when a block ends while the app stays open, and leaves a task that was moved back", () => {
    vi.useFakeTimers();
    const clock = new FakeClock(new Date(2026, 10, 16, 11, 50));
    const { db } = openDatabase(":memory:", { clock });
    open.push(db);
    const store = new Store(db, clock);
    const weekday = store.createTemplate({
      name: "Weekday",
      blocks: [
        { slot: 1, name: "Morning", startHour: 9, endHour: 12 },
        { slot: 2, name: "Afternoon", startHour: 13, endHour: 17 },
      ],
    });
    store.setSchedule([0, 1, 2, 3, 4], weekday.id);
    const task = store.createTask({ title: "Write" });
    store.assign(task.id, { date: "2026-11-16", slot: 1 });

    let catchUps = 0;
    const feed = createTimerFeed(new TimerEngine(store, clock), store, core, () => undefined, () => {
      catchUps += 1;
      core.runRollover(store);
    });

    feed.refresh();
    expect(catchUps).toBe(0);

    // The morning block ends: the unfinished task goes to the afternoon.
    clock.set(new Date(2026, 10, 16, 12, 0, 1));
    feed.refresh();
    expect(catchUps).toBe(1);
    expect(store.getAssignment(task.id)).toMatchObject({ slot: 2 });

    // Moved back into the finished block, it stays there until the next block ends.
    store.assign(task.id, { date: "2026-11-16", slot: 1 });
    clock.set(new Date(2026, 10, 16, 12, 30));
    feed.refresh();
    expect(catchUps).toBe(1);
    expect(store.getAssignment(task.id)).toMatchObject({ slot: 1 });

    // Nothing happens while a block simply runs on.
    clock.set(new Date(2026, 10, 16, 15, 0));
    feed.refresh();
    expect(catchUps).toBe(1);

    // The afternoon block ends: now it is rolled again.
    clock.set(new Date(2026, 10, 16, 17, 0, 1));
    feed.refresh();
    expect(catchUps).toBe(2);
    feed.stop();
  });
});
