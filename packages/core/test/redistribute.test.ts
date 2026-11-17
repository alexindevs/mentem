import { describe, expect, it } from "vitest";
import { changeDateTemplate, undoTemplateChange } from "../src/redistribute";
import type { Slot } from "../src/types";
import { at, makeStore, standardWeek } from "./helpers";

const THU = "2026-11-19";

function setup() {
  const ctx = makeStore(at(2026, 11, 16, 8, 0)); // Monday; Thursday is in the future
  const { store } = ctx;
  const { weekend } = standardWeek(store);
  const night = store.createTemplate({ name: "Out at night", blocks: [{ slot: 1, name: "Evening", startHour: 19, endHour: 22 }] });
  const tiny = store.createTemplate({ name: "Tiny", blocks: [{ slot: 1, name: "Morning", startHour: 9, endHour: 10 }] });
  const mk = (title: string, slot: Slot, estimate: number | null = null, date = THU) => {
    const t = store.createTask({ title, estimatePomodoros: estimate });
    store.assign(t.id, { date, slot });
    return t;
  };
  return { ...ctx, weekend, night, tiny, mk };
}

const order = (store: ReturnType<typeof makeStore>["store"], date: string, slot: Slot) => store.listBlock(date, slot).map((a) => store.getTask(a.taskId)!.title);

describe("changeDateTemplate", () => {
  it("keeps the block with the same name and moves the rest to the nearest remaining block", () => {
    const { store, weekend, mk } = setup();
    mk("a", 1);
    mk("b", 1);
    mk("c", 2); // Afternoon
    const r = changeDateTemplate(store, THU, weekend.id); // Weekend has Afternoon only
    expect(store.templateIdFor(THU)).toBe(weekend.id);
    expect(order(store, THU, 1)).toEqual(["a", "b", "c"]); // Morning tasks follow into Afternoon, in order
    expect(r.moved.map((m) => store.getTask(m.taskId)!.title)).toEqual(["a", "b"]);
    expect(r.unchanged).toBe(1);
  });

  it("moves everything into a single evening block", () => {
    const { store, night, mk } = setup();
    mk("a", 1);
    mk("b", 2);
    changeDateTemplate(store, THU, night.id);
    expect(order(store, THU, 1)).toEqual(["a", "b"]);
  });

  it("prefers an earlier block over a later one", () => {
    const { store, mk } = setup();
    const three = store.createTemplate({
      name: "Three",
      blocks: [
        { slot: 1, name: "Early", startHour: 6, endHour: 9 },
        { slot: 2, name: "Midday", startHour: 11, endHour: 14 },
        { slot: 3, name: "Late", startHour: 18, endHour: 21 },
      ],
    });
    mk("b", 2); // Afternoon (13-17) in Weekday; no same name in Three
    changeDateTemplate(store, THU, three.id);
    expect(order(store, THU, 2)).toEqual(["b"]); // Midday (starts 11) is the nearest earlier block
  });

  it("respects block capacity and rolls overflow to the next day", () => {
    const { store, tiny, mk } = setup(); // Tiny: 9-10 holds 2 pomodoros
    mk("a", 1);
    mk("b", 1);
    mk("c", 1);
    const r = changeDateTemplate(store, THU, tiny.id);
    expect(order(store, THU, 1)).toEqual(["a", "b"]);
    expect(order(store, "2026-11-20", 1)).toEqual(["c"]); // Friday's first block
    expect(r.moved.find((m) => store.getTask(m.taskId)!.title === "c")!.to).toEqual({ date: "2026-11-20", slot: 1 });
  });

  it("counts estimates toward capacity", () => {
    const { store, tiny, mk } = setup();
    mk("big", 1, 2);
    mk("small", 1, 1);
    changeDateTemplate(store, THU, tiny.id);
    expect(order(store, THU, 1)).toEqual(["big"]);
    expect(order(store, "2026-11-20", 1)).toEqual(["small"]);
  });

  it("always accepts a task into an empty block even if it is larger than the block", () => {
    const { store, tiny, mk } = setup();
    mk("huge", 1, 10);
    changeDateTemplate(store, THU, tiny.id);
    expect(order(store, THU, 1)).toEqual(["huge"]);
  });

  it("sends overflow to Unscheduled on the week-end day", () => {
    const { store, tiny, mk } = setup();
    const SUN = "2026-11-22"; // week ends Sunday
    mk("a", 1, null, SUN);
    mk("b", 1, null, SUN);
    const c = mk("c", 1, null, SUN);
    changeDateTemplate(store, SUN, tiny.id);
    expect(store.getAssignment(c.id)).toBeUndefined();
    expect(store.getTask(c.id)!.status).toBe("open");
  });

  it("rolls everything forward when the new template has no blocks", () => {
    const { store, mk } = setup();
    const off = store.createTemplate({ name: "Off" });
    const a = mk("a", 1);
    changeDateTemplate(store, THU, off.id);
    expect(store.getAssignment(a.id)!.date).toBe("2026-11-20");
  });

  it("subtasks without their own assignment follow their parent", () => {
    const { store, night, mk } = setup();
    const parent = mk("parent", 1);
    const child = store.createTask({ title: "child", parentId: parent.id });
    changeDateTemplate(store, THU, night.id);
    expect(store.effectiveAssignment(child.id)).toMatchObject({ date: THU, slot: 1 });
  });

  it("leaves dates in the past alone", () => {
    const { store, clock, night, mk } = setup();
    clock.set(at(2026, 11, 25, 8, 0));
    const a = mk("a", 1);
    const r = changeDateTemplate(store, THU, night.id);
    expect(r.moved).toHaveLength(0);
    expect(store.getAssignment(a.id)).toMatchObject({ date: THU, slot: 1 });
  });

  it("undo restores the template, every position, and removes the history it wrote", () => {
    const { store, tiny, mk } = setup();
    const a = mk("a", 1);
    mk("b", 1);
    const c = mk("c", 2);
    const eventsBefore = (store.db.prepare("select count(*) n from assignment_event").get() as { n: number }).n;
    const snapshot = store.listDate(THU).map((x) => [x.taskId, x.slot, x.position]);
    const r = changeDateTemplate(store, THU, tiny.id);
    expect(store.getAssignment(c.id)!.date).not.toBe(THU); // c did not fit
    undoTemplateChange(store, r.undo);
    expect(store.getDateOverride(THU)).toBeNull();
    expect(store.templateIdFor(THU)).toBe(store.templateIdFor("2026-11-18")); // back to Weekday
    expect(store.listDate(THU).map((x) => [x.taskId, x.slot, x.position])).toEqual(snapshot);
    expect(store.getAssignment(a.id)!.slot).toBe(1);
    const eventsAfter = (store.db.prepare("select count(*) n from assignment_event").get() as { n: number }).n;
    expect(eventsAfter).toBe(eventsBefore);
  });
});
