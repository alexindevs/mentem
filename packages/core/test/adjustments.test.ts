import { describe, expect, it } from "vitest";
import { TimerEngine } from "../src/engine";
import { at, makeStore, standardWeek } from "./helpers";

const MIN = 60_000;
const MON = "2026-11-16";

function lunchDay(now: Date) {
  const ctx = makeStore(now);
  const { weekday } = standardWeek(ctx.store);
  const lunch = ctx.store.addRoutineItem(weekday.id, { title: "Lunch", startMin: 12 * 60 + 30, endMin: 13 * 60 });
  const engine = new TimerEngine(ctx.store, ctx.clock);
  return { ...ctx, lunch, engine };
}

describe("one-day adjustments", () => {
  it("extends a routine item for that date only", () => {
    const { engine, store, lunch, clock } = lunchDay(at(2026, 11, 16, 12, 40));
    expect(engine.state().routineRuns[0]!.remainingMs).toBe(20 * MIN);
    engine.extendRoutine(15);
    expect(engine.state().routineRuns[0]!.remainingMs).toBe(35 * MIN);
    expect(store.routineFor(MON).find((r) => r.id === lunch.id)!.endMin).toBe(13 * 60 + 15);
    expect(store.routineFor("2026-11-17").find((r) => r.id === lunch.id)!.endMin).toBe(13 * 60);
    clock.set(at(2026, 11, 16, 13, 10));
    expect(engine.state().routine.map((r) => r.title)).toEqual(["Lunch"]);
  });

  it("ends a routine item early when skipped", () => {
    const { engine, clock } = lunchDay(at(2026, 11, 16, 12, 40));
    engine.skipRoutine();
    clock.advance(MIN);
    expect(engine.state().routine).toEqual([]);
  });

  it("holds a routine item while paused and gives the time back", () => {
    const { engine, clock } = lunchDay(at(2026, 11, 16, 12, 40));
    engine.state();
    engine.pauseRoutine();
    clock.advance(10 * MIN);
    const paused = engine.state();
    expect(paused.routinePaused).toBe(true);
    expect(paused.routineRuns[0]!.remainingMs).toBe(20 * MIN);
    expect(paused.routineRuns[0]!.endsAt).toBeNull();
    engine.resumeRoutine();
    const resumed = engine.state();
    expect(resumed.routineRuns[0]!.remainingMs).toBe(20 * MIN);
    expect(resumed.routineRuns[0]!.endsAt).toBe(at(2026, 11, 16, 13, 10).getTime());
  });

  it("starts the next block now", () => {
    const { engine, store, clock } = lunchDay(at(2026, 11, 16, 12, 22));
    expect(engine.state().kind).toBe("between");
    engine.startNow();
    expect(engine.state().kind).toBe("work");
    expect(store.blocksFor(MON)[1]!.startMin).toBe(12 * 60 + 22);
    expect(store.blocksFor("2026-11-17")[1]!.startMin).toBe(13 * 60);
    clock.advance(MIN);
    expect(engine.state().block!.name).toBe("Afternoon");
  });

  it("remembers that an empty block was left idle, until the block changes", () => {
    const { engine, clock } = lunchDay(at(2026, 11, 16, 10, 0));
    expect(engine.state()).toMatchObject({ emptyBlock: true, idle: false });
    engine.idle();
    expect(engine.state().idle).toBe(true);
    clock.set(at(2026, 11, 16, 14, 0));
    expect(engine.state().idle).toBe(false);
  });

  it("marks a day off and takes it back", () => {
    const { engine, store } = lunchDay(at(2026, 11, 16, 10, 0));
    store.setDayOff(MON, true);
    expect(store.templateIdFor(MON)).toBeNull();
    expect(engine.state()).toMatchObject({ kind: "no-template", dayOff: true });
    store.setDayOff(MON, false);
    expect(store.templateIdFor(MON)).not.toBeNull();
  });
});

describe("quarter-hour blocks", () => {
  it("keeps a block that starts and ends between whole hours", () => {
    const { store } = makeStore(at(2026, 11, 16, 8, 0));
    const t = store.createTemplate({ name: "Odd", blocks: [{ slot: 1, name: "Focus", startHour: 9.25, endHour: 12.5 }] });
    store.setSchedule([0], t.id);
    const block = store.blocksFor(MON)[0]!;
    expect([block.startMin, block.endMin]).toEqual([9 * 60 + 15, 12 * 60 + 30]);
    expect(store.getTemplate(t.id)!.blocks[0]).toMatchObject({ startHour: 9.25, endHour: 12.5 });
  });
});
