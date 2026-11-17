import { describe, expect, it } from "vitest";
import { TimerEngine } from "../src/engine";
import { at, makeStore, standardWeek } from "./helpers";

const MIN = 60_000;
const MON = "2026-11-16";

function setup(now = at(2026, 11, 16, 9, 10)) {
  const ctx = makeStore(now);
  const { store } = ctx;
  const { weekday } = standardWeek(store);
  const t1 = store.createTask({ title: "t1", steps: ["open it", "write it"] });
  const t2 = store.createTask({ title: "t2" });
  store.assign(t1.id, { date: MON, slot: 1 });
  store.assign(t2.id, { date: MON, slot: 1 });
  const engine = new TimerEngine(store, ctx.clock);
  return { ...ctx, weekday, t1, t2, engine };
}

describe("TimerEngine: following the schedule", () => {
  it("starts on the first open task and shows how long is left", () => {
    const { engine, t1, t2, clock } = setup();
    const s = engine.state();
    expect(s.kind).toBe("work");
    expect(s.segment!.pomodoro).toBe(1);
    expect(s.remainingMs).toBe(15 * MIN);
    expect(s.task!.id).toBe(t1.id);
    expect(s.nextTask!.id).toBe(t2.id);
    expect(s.step).toMatchObject({ index: 1, total: 2 });
    expect(s.nextEventAt).toBe(at(2026, 11, 16, 9, 25).getTime());
    expect(clock.now()).toBe(at(2026, 11, 16, 9, 10).getTime());
  });

  it("continues on the same task after a break", () => {
    const { engine, clock, t1 } = setup();
    clock.set(at(2026, 11, 16, 9, 26));
    const b = engine.state();
    expect(b.kind).toBe("break");
    expect(b.remainingMs).toBe(4 * MIN);
    expect(b.task!.id).toBe(t1.id);
    clock.set(at(2026, 11, 16, 9, 31));
    const w = engine.state();
    expect(w.kind).toBe("work");
    expect(w.segment!.pomodoro).toBe(2);
    expect(w.task!.id).toBe(t1.id);
  });

  it("moves to the next task when one is marked done, and prompts when the block is empty", () => {
    const { engine, t1, t2 } = setup();
    expect(engine.done().task!.id).toBe(t2.id);
    expect(engine.state().nextTask).toBeNull();
    const last = engine.done();
    expect(last.task).toBeNull();
    expect(last.emptyBlock).toBe(true);
    expect(last.dayComplete).toBe(true);
    expect(t1.id).not.toBe(t2.id);
  });

  it("joins at the right point after the app was closed (it follows the clock)", () => {
    const { store, clock } = setup(at(2026, 11, 16, 8, 0));
    clock.set(at(2026, 11, 16, 10, 5)); // opened mid-block
    const s = new TimerEngine(store, clock).state();
    expect(s.kind).toBe("work");
    expect(s.segment!.pomodoro).toBe(3);
    expect(s.remainingMs).toBe(20 * MIN);
  });

  it("describes the gap between blocks", () => {
    const { engine, clock } = setup();
    clock.set(at(2026, 11, 16, 12, 30));
    const s = engine.state();
    expect(s.kind).toBe("between");
    expect(s.nextBlock!.name).toBe("Afternoon");
    expect(s.startsInMs).toBe(30 * MIN);
    expect(s.nextEventAt).toBe(at(2026, 11, 16, 13, 0).getTime());
  });

  it("is between blocks before the first one, and rests before wake and after bed", () => {
    const { engine, clock } = setup();
    clock.set(at(2026, 11, 16, 8, 0));
    expect(engine.state().kind).toBe("between");
    clock.set(at(2026, 11, 16, 6, 0));
    expect(engine.state().kind).toBe("rest");
    clock.set(at(2026, 11, 16, 23, 30));
    expect(engine.state().kind).toBe("rest");
  });

  it("reports a day with no template", () => {
    const { store, clock, engine } = setup();
    store.clearSchedule(5);
    clock.set(at(2026, 11, 21, 10, 0)); // Saturday
    expect(engine.state().kind).toBe("no-template");
  });
});

describe("TimerEngine: controls", () => {
  it("pause freezes the countdown and resume continues from where it stopped", () => {
    const { engine, clock } = setup();
    engine.pause();
    clock.advance(10 * MIN);
    const frozen = engine.state();
    expect(frozen.paused).toBe(true);
    expect(frozen.remainingMs).toBe(15 * MIN);
    expect(frozen.segmentEndsAt).toBeNull(); // no end time while paused
    engine.resume();
    clock.advance(5 * MIN);
    expect(engine.state().remainingMs).toBe(10 * MIN);
  });

  it("skip jumps to the end of the pomodoro", () => {
    const { engine } = setup();
    engine.skip();
    const s = engine.state();
    expect(s.kind).toBe("break");
    expect(s.remainingMs).toBe(5 * MIN);
  });

  it("skip does nothing in the last segment of a block", () => {
    const { engine, clock } = setup();
    // 9-12 ends with a shortened final pomodoro (11:40-12:00).
    clock.set(at(2026, 11, 16, 11, 57));
    expect(engine.state().kind).toBe("work");
    engine.skip();
    expect(engine.state().remainingMs).toBe(3 * MIN);
  });

  it("forgets pause and skip when the block changes, so blocks end on time", () => {
    const { engine, clock } = setup();
    engine.pause();
    clock.set(at(2026, 11, 16, 13, 5));
    const s = engine.state();
    expect(s.paused).toBe(false);
    expect(s.block!.name).toBe("Afternoon");
  });

  it("switchTask works on another task from the block", () => {
    const { engine, t2 } = setup();
    engine.switchTask(t2.id);
    expect(engine.state().task!.id).toBe(t2.id);
  });
});

describe("TimerEngine: routine items and subtasks", () => {
  it("shows an overlap: a work block and a routine item at once", () => {
    const { store, weekday, engine, clock } = setup();
    store.addRoutineItem(weekday.id, { title: "Lunch", startMin: 11 * 60 + 30, endMin: 12 * 60 + 30 });
    clock.set(at(2026, 11, 16, 11, 45));
    const s = engine.state();
    expect(s.kind).toBe("work");
    expect(s.routine.map((r) => r.title)).toEqual(["Lunch"]);
  });

  it("wakes at routine boundaries too", () => {
    const { store, weekday, engine, clock } = setup();
    store.addRoutineItem(weekday.id, { title: "Walk", startMin: 9 * 60 + 12, endMin: 9 * 60 + 20 });
    expect(engine.state().nextEventAt).toBe(at(2026, 11, 16, 9, 12).getTime());
    clock.set(at(2026, 11, 16, 9, 13));
    expect(engine.state().nextEventAt).toBe(at(2026, 11, 16, 9, 20).getTime());
  });

  it("skips a routine item that does not repeat today", () => {
    const { store, weekday, engine, clock } = setup();
    // Every other week from last Monday: this Monday is the off week.
    store.addRoutineItem(weekday.id, {
      title: "Gym",
      startMin: 9 * 60,
      endMin: 10 * 60,
      repeat: { interval: 2, unit: "week", anchor: "2026-11-09", weekdays: [0] },
    });
    clock.set(at(2026, 11, 16, 9, 30));
    expect(engine.state().routine).toHaveLength(0); // the off week
    clock.set(at(2026, 11, 23, 9, 30));
    expect(engine.state().routine.map((r) => r.title)).toEqual(["Gym"]); // two weeks after the anchor
  });

  it("works through the open subtasks of a task instead of the parent", () => {
    const { store, engine } = setup();
    const parent = store.createTask({ title: "parent" });
    store.assign(parent.id, { date: MON, slot: 1, position: "start" });
    const c1 = store.createTask({ title: "c1", parentId: parent.id });
    store.createTask({ title: "c2", parentId: parent.id });
    expect(engine.state().task!.id).toBe(c1.id);
  });
});

describe("TimerEngine: logging time", () => {
  it("logs the time the timer actually ran, and not time while the app was closed", () => {
    const { store, clock, engine } = setup(at(2026, 11, 16, 9, 0));
    engine.state(); // observed from 9:00
    clock.set(at(2026, 11, 16, 9, 25, ));
    clock.advance(30_000);
    engine.state(); // now in the break; the work pomodoro is logged
    clock.set(at(2026, 11, 16, 9, 30, ));
    clock.advance(10_000);
    engine.state(); // break logged
    const rows = store.db.prepare("select type, start_at, end_at, completed, task_id from session order by id").all() as Array<{
      type: string; start_at: number; end_at: number; completed: number; task_id: string | null;
    }>;
    expect(rows.map((r) => [r.type, r.completed])).toEqual([["work", 1], ["break", 1]]);
    expect(rows[0]!.start_at).toBe(at(2026, 11, 16, 9, 0).getTime());
    expect(rows[0]!.end_at).toBe(at(2026, 11, 16, 9, 25).getTime());
    expect(rows[0]!.task_id).not.toBeNull();
    expect(rows[1]!.task_id).toBeNull();
  });

  it("does not log time before the engine started watching", () => {
    const { store, clock } = setup(at(2026, 11, 16, 8, 0));
    clock.set(at(2026, 11, 16, 9, 10)); // opened late
    const engine = new TimerEngine(store, clock);
    engine.state();
    clock.set(at(2026, 11, 16, 9, 26));
    engine.state();
    const row = store.db.prepare("select start_at, end_at from session").get() as { start_at: number; end_at: number };
    expect(row.start_at).toBe(at(2026, 11, 16, 9, 10).getTime());
  });
});
