import { describe, expect, it } from "vitest";
import { TimerEngine } from "../src";
import { at, makeStore, standardWeek } from "./helpers";

const setup = (now = at(2026, 11, 16, 9, 0)) => {
  const ctx = makeStore(now);
  standardWeek(ctx.store);
  return { ...ctx, engine: new TimerEngine(ctx.store, ctx.clock) };
};
const T = (...a: Parameters<typeof at>) => at(...a).getTime();
const min = (h: number, m = 0) => h * 60 + m;
const standup = { title: "Standup", date: "2026-11-16", startMin: min(9, 10), endMin: min(9, 40) };

describe("keeping meetings", () => {
  it("stores the details and lists them in start order", () => {
    const { store } = setup();
    store.createMeeting({ title: "Review", date: "2026-11-16", startMin: min(14), endMin: min(15), link: "https://meet.example.com/abc", notes: "Bring the draft", attendees: ["Sam", " Ola ", "Sam", ""] });
    store.createMeeting(standup);
    const day = store.meetingsOn("2026-11-16");
    expect(day.map((m) => m.title)).toEqual(["Standup", "Review"]);
    expect(day[1]).toMatchObject({ link: "https://meet.example.com/abc", notes: "Bring the draft", attendees: ["Sam", "Ola"] });
    expect(store.meetingsOn("2026-11-17")).toEqual([]);
  });

  it("refuses a meeting that cannot be right", () => {
    const { store } = setup();
    expect(() => store.createMeeting({ ...standup, title: "  " })).toThrow("title");
    expect(() => store.createMeeting({ ...standup, startMin: min(10), endMin: min(9) })).toThrow("end after");
    expect(() => store.createMeeting({ ...standup, endMin: 25 * 60 })).toThrow("end after");
    expect(() => store.createMeeting({ ...standup, link: "javascript:alert(1)" })).toThrow("http");
    expect(() => store.createMeeting({ ...standup, date: "tomorrow" })).toThrow("date");
  });

  it("changes and removes a meeting", () => {
    const { store } = setup();
    const m = store.createMeeting(standup);
    store.updateMeeting(m.id, { title: "Daily", endMin: min(9, 45) });
    expect(store.getMeeting(m.id)).toMatchObject({ title: "Daily", endMin: min(9, 45), startMin: min(9, 10) });
    store.deleteMeeting(m.id);
    expect(store.meetingsOn("2026-11-16")).toEqual([]);
  });

  it("repeats on the days the rule says, and can drop a single day", () => {
    const { store } = setup();
    const m = store.createMeeting({ ...standup, repeat: { interval: 2, unit: "day", anchor: "ignored" } });
    expect(store.meetingsOn("2026-11-18").map((x) => x.title)).toEqual(["Standup"]);
    expect(store.meetingsOn("2026-11-17")).toEqual([]);
    expect(store.meetingsOn("2026-11-14")).toEqual([]);
    store.deleteMeeting(m.id, "2026-11-18");
    expect(store.meetingsOn("2026-11-18")).toEqual([]);
    expect(store.meetingsOn("2026-11-20")).toHaveLength(1);
    store.deleteMeeting(m.id, "2026-11-16");
    expect(store.getMeeting(m.id)).toBeUndefined();
  });
});

describe("the timer around a meeting", () => {
  it("steps aside during the meeting and carries on with the time that was left", () => {
    const { store, engine, clock } = setup();
    store.createMeeting(standup);
    const task = store.createTask({ title: "Write" });
    store.assign(task.id, { date: "2026-11-16", slot: 1 });

    clock.set(at(2026, 11, 16, 9, 5));
    expect(engine.state()).toMatchObject({ kind: "work", segmentEndsAt: T(2026, 11, 16, 9, 55) });

    clock.set(at(2026, 11, 16, 9, 20));
    const during = engine.state();
    expect(during.kind).toBe("meeting");
    expect(during.meetingRuns[0]).toMatchObject({ endsAt: T(2026, 11, 16, 9, 40), remainingMs: 20 * 60_000 });
    expect(during.task?.id).toBe(task.id);
    expect(during.nextEventAt).toBe(T(2026, 11, 16, 9, 40));

    clock.set(at(2026, 11, 16, 9, 40));
    const after = engine.state();
    expect(after).toMatchObject({ kind: "work", remainingMs: 15 * 60_000, segmentEndsAt: T(2026, 11, 16, 9, 55) });
  });

  it("does not move the end of the block", () => {
    const { store, engine, clock } = setup();
    store.createMeeting({ ...standup, startMin: min(11), endMin: min(12, 30) });
    clock.set(at(2026, 11, 16, 11, 45));
    expect(engine.state().kind).toBe("meeting");
    clock.set(at(2026, 11, 16, 12, 30));
    expect(engine.state().block).toBeNull();
  });

  it("handles meetings that overlap each other, and ones between blocks", () => {
    const { store, engine, clock } = setup();
    store.createMeeting(standup);
    store.createMeeting({ ...standup, title: "Sync", startMin: min(9, 30), endMin: min(10) });
    clock.set(at(2026, 11, 16, 9, 35));
    expect(engine.state().meetingRuns).toHaveLength(2);
    clock.set(at(2026, 11, 16, 10, 0));
    expect(engine.state()).toMatchObject({ kind: "work", remainingMs: 15 * 60_000 });
    store.createMeeting({ title: "Lunch with a client", date: "2026-11-16", startMin: min(12, 15), endMin: min(12, 45) });
    clock.set(at(2026, 11, 16, 12, 20));
    expect(engine.state().kind).toBe("meeting");
  });

  it("reports the next meeting and wakes up when one starts", () => {
    const { store, engine, clock } = setup();
    store.createMeeting({ ...standup, startMin: min(15), endMin: min(16) });
    clock.set(at(2026, 11, 16, 8, 0));
    const s = engine.state();
    expect(s.nextMeeting?.title).toBe("Standup");
    expect(s.nextEventAt).toBeLessThanOrEqual(T(2026, 11, 16, 9, 0));
  });

  it("keeps meetings through export and import", async () => {
    const { store } = setup();
    store.createMeeting(standup);
    const { exportData, importData } = await import("../src");
    const file = exportData(store.db, store.clock.now());
    store.deleteMeeting(store.meetingsOn("2026-11-16")[0]!.id);
    importData(store.db, file);
    expect(store.meetingsOn("2026-11-16")).toHaveLength(1);
  });
});

describe("kind, place and minutes", () => {
  it("keeps a link for online meetings and a place for in-person ones", () => {
    const { store } = setup();
    const online = store.createMeeting({ ...standup, link: "https://meet.example.com/x", place: "Room 2" });
    expect(online).toMatchObject({ kind: "online", link: "https://meet.example.com/x", place: null });
    const room = store.createMeeting({ ...standup, title: "Offsite", kind: "in-person", place: " Room 2 ", link: "https://ignored.example.com" });
    expect(room).toMatchObject({ kind: "in-person", place: "Room 2", link: null });
    expect(store.updateMeeting(room.id, { kind: "online", link: "https://meet.example.com/y" })).toMatchObject({ kind: "online", place: null });
  });

  it("keeps minutes for each day of a repeating meeting, and drops them with the meeting", () => {
    const { store } = setup();
    const m = store.createMeeting({ ...standup, repeat: { interval: 1, unit: "day", anchor: "x" } });
    store.setMinutes(m.id, "2026-11-16", "Agreed the launch date");
    store.setMinutes(m.id, "2026-11-17", "Nothing new");
    expect(store.getMinutes(m.id, "2026-11-16")).toBe("Agreed the launch date");
    expect(store.getMinutes(m.id, "2026-11-18")).toBe("");
    expect([...store.minutesDays("2026-11-16", "2026-11-30")].sort()).toEqual([`${m.id}:2026-11-16`, `${m.id}:2026-11-17`]);
    store.setMinutes(m.id, "2026-11-17", "  ");
    expect(store.getMinutes(m.id, "2026-11-17")).toBe("");
    store.deleteMeeting(m.id);
    expect(store.getMinutes(m.id, "2026-11-16")).toBe("");
  });

  it("lists every occurrence in a range, oldest first, without the removed days", () => {
    const { store } = setup();
    const daily = store.createMeeting({ ...standup, repeat: { interval: 1, unit: "day", anchor: "x" } });
    store.createMeeting({ title: "One-off", date: "2026-11-18", startMin: 480, endMin: 510 });
    store.deleteMeeting(daily.id, "2026-11-17");
    const list = store.meetingsBetween("2026-11-16", "2026-11-18");
    expect(list.map((m) => `${m.date} ${m.title}`)).toEqual(["2026-11-16 Standup", "2026-11-18 One-off", "2026-11-18 Standup"]);
    expect(store.meetingsBetween("2026-11-19", "2026-11-19").map((m) => m.title)).toEqual(["Standup"]);
  });
});
