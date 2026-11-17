import { describe, expect, it } from "vitest";
import { TimerEngine, runRollover } from "../src";
import { at, makeStore, standardWeek } from "./helpers";

const setup = (now = at(2026, 11, 16, 11, 40)) => {
  const ctx = makeStore(now);
  standardWeek(ctx.store);
  return { ...ctx, engine: new TimerEngine(ctx.store, ctx.clock) };
};

describe("extending a work block for one day", () => {
  it("runs the block later, never into the next block, and says how much room is left", () => {
    const { store } = setup();
    expect(store.blockRoom("2026-11-16", 1)).toBe(60);
    expect(store.extendBlock("2026-11-16", 1, 30)).toBe(12 * 60 + 30);
    expect(store.blocksFor("2026-11-16")[0]).toMatchObject({ startMin: 540, endMin: 750 });
    expect(store.blockRoom("2026-11-16", 1)).toBe(30);
    // Asking for more than fits stops at the start of the next block.
    expect(store.extendBlock("2026-11-16", 1, 60)).toBe(13 * 60);
    expect(store.blockRoom("2026-11-16", 1)).toBe(0);
    expect(() => store.extendBlock("2026-11-16", 1, 15)).toThrow("no room");
  });

  it("stops the last block at bed time", () => {
    const { store } = setup();
    const bed = store.getTemplate(store.templateIdFor("2026-11-16")!)!.bedMin;
    expect(store.blockRoom("2026-11-16", 2)).toBe(bed - 17 * 60);
    expect(store.extendBlock("2026-11-16", 2, 120)).toBe(Math.min(19 * 60, bed));
  });

  it("changes only that date, and refuses nonsense", () => {
    const { store } = setup();
    store.extendBlock("2026-11-16", 1, 30);
    expect(store.blocksFor("2026-11-17")[0]!.endMin).toBe(720);
    expect(() => store.extendBlock("2026-11-16", 1, 3)).toThrow("5 to 120");
    expect(() => store.extendBlock("2026-11-16", 1, 2.5)).toThrow("5 to 120");
    expect(() => store.extendBlock("2026-11-16", 9, 30)).toThrow("No such block");
    expect(store.blockRoom("2026-11-16", 9)).toBe(0);
  });

  it("keeps unfinished work in the block until the new end", () => {
    const { store, clock } = setup();
    const t = store.createTask({ title: "Write" });
    store.assign(t.id, { date: "2026-11-16", slot: 1 });
    store.extendBlock("2026-11-16", 1, 30);
    clock.set(at(2026, 11, 16, 12, 10));
    runRollover(store);
    expect(store.getAssignment(t.id)).toMatchObject({ date: "2026-11-16", slot: 1 });
    clock.set(at(2026, 11, 16, 12, 31));
    runRollover(store);
    expect(store.getAssignment(t.id)).toMatchObject({ date: "2026-11-16", slot: 2 });
  });

  it("lets the timer carry on past the planned end of the block", () => {
    const { store, engine, clock } = setup();
    const t = store.createTask({ title: "Write" });
    store.assign(t.id, { date: "2026-11-16", slot: 1 });
    expect(engine.extendBlock(30)).toBe(750);
    clock.set(at(2026, 11, 16, 12, 10));
    const s = engine.state();
    expect(s.block).toMatchObject({ endMin: 750 });
    expect(s.kind === "work" || s.kind === "break").toBe(true);
    expect(s.task?.id).toBe(t.id);
    clock.set(at(2026, 11, 16, 12, 45));
    expect(engine.state().block).toBeNull();
    expect(() => engine.extendBlock(30)).toThrow("No work block");
  });
});
