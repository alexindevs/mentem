import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { describeTransition, miniHeight, trayTooltip } from "../src/main/notify";
import type { TimerView } from "../src/shared/api";

const base: TimerView = {
  now: 0,
  kind: "work",
  paused: false,
  blockName: "Morning",
  blockStartMin: 540,
  blockEndMin: 720,
  pomodoro: { index: 1, total: 6 },
  breakKind: null,
  endsAt: 25 * 60_000,
  remainingMs: 25 * 60_000,
  totalMs: 25 * 60_000,
  blockEndsAt: null,
  blockMs: null,
  task: { id: "t1", title: "Draft the onboarding email", context: null },
  step: null,
  nextTask: "Review pricing page",
  emptyBlock: false,
  nextBlock: null,
  startsInMs: null,
  routine: [],
  routinePaused: false,
  meeting: null,
  nextMeeting: null,
  idle: false,
  dayOff: false,
  nextLabel: null,
  dayComplete: false,
  wakeMin: 420,
  afterBed: false,
};
const view = (change: Partial<TimerView>): TimerView => ({ ...base, ...change });

describe("what the app says when the timer moves on", () => {
  it("stays quiet when the app has only just opened", () => {
    expect(describeTransition(null, base)).toBeNull();
  });

  it("stays quiet while time simply passes, or when paused and resumed", () => {
    expect(describeTransition(base, view({ remainingMs: 20 * 60_000 }))).toBeNull();
    expect(describeTransition(base, view({ paused: true, endsAt: null }))).toBeNull();
    expect(describeTransition(view({ paused: true, endsAt: null }), base)).toBeNull();
  });

  it("announces a break with its length and what comes next", () => {
    const next = view({ kind: "break", breakKind: "short", totalMs: 5 * 60_000, task: null });
    expect(describeTransition(base, next)).toEqual({ title: "Break time", body: "5 min. Next: Review pricing page" });
    expect(describeTransition(base, view({ ...next, breakKind: "long", totalMs: 15 * 60_000 }))).toEqual({ title: "Long break", body: "15 min. Next: Review pricing page" });
    expect(describeTransition(next, next)).toBeNull();
  });

  it("announces the return to work with the task", () => {
    const rest = view({ kind: "break", breakKind: "short", task: null });
    expect(describeTransition(rest, base)).toEqual({ title: "Back to work", body: "Draft the onboarding email" });
  });

  it("announces a new block, and one with nothing in it", () => {
    const between = view({ kind: "between", blockName: null, task: null });
    expect(describeTransition(between, base)).toEqual({ title: "Morning starts", body: "Draft the onboarding email" });
    expect(describeTransition(base, view({ blockName: "Afternoon", task: null, emptyBlock: true }))).toEqual({ title: "Afternoon starts", body: "Nothing assigned yet." });
  });

  it("announces a routine item when it begins, and says when it ends", () => {
    const lunchEnds = new Date(2026, 10, 16, 13, 0).getTime();
    const between = view({ kind: "between", blockName: null, task: null });
    const lunch = view({ kind: "routine", blockName: null, task: null, routine: [{ title: "Lunch", startMin: 750, endMin: 780, endsAt: lunchEnds, remainingMs: 1_800_000, totalMs: 1_800_000 }] });
    const message = describeTransition(between, lunch);
    expect(message?.title).toBe("Lunch");
    expect(message?.body).toMatch(/^Until /);
    expect(describeTransition(lunch, lunch)).toBeNull();
  });

  it("announces when the day is complete, once", () => {
    const done = view({ kind: "between", dayComplete: true, task: null });
    expect(describeTransition(view({ kind: "between", task: null }), done)).toEqual({ title: "Day complete", body: "Everything you planned is done." });
    expect(describeTransition(done, done)).toBeNull();
  });
});

describe("the tray tooltip", () => {
  it("shows the task and the time left, and says when paused", () => {
    expect(trayTooltip("Mentem", base, 0)).toBe("Mentem · Draft the onboarding email · 25:00");
    expect(trayTooltip("My Day", view({ endsAt: null, remainingMs: 90_000, paused: true }), 0)).toBe("My Day · Draft the onboarding email · 1:30 (paused)");
  });

  it("describes the other states and falls back to the app name", () => {
    expect(trayTooltip("Mentem", null, 0)).toBe("Mentem");
    expect(trayTooltip("Mentem", view({ kind: "break", task: null }), 0)).toBe("Mentem · Break · 25:00");
    expect(trayTooltip("Mentem", view({ kind: "between", task: null, nextBlock: { name: "Afternoon", startMin: 780 } }), 0)).toBe("Mentem · Next: Afternoon");
    expect(trayTooltip("Mentem", view({ kind: "rest", task: null }), 0)).toBe("Mentem · Rest");
  });
});

describe("the mini window", () => {
  it("is taller only when two things are happening at once", () => {
    expect(miniHeight(null)).toBe(92);
    expect(miniHeight(base)).toBe(92);
    const lunch = { title: "Lunch", startMin: 750, endMin: 780, endsAt: 1, remainingMs: 1, totalMs: 1 };
    expect(miniHeight(view({ routine: [lunch] }))).toBe(124);
    expect(miniHeight(view({ kind: "routine", blockName: null, routine: [lunch] }))).toBe(92);
  });
});

describe("the app icons", () => {
  const size = (file: string) => {
    const png = readFileSync(join(__dirname, "..", "assets", file));
    return { signature: [...png.subarray(0, 8)], width: png.readUInt32BE(16), height: png.readUInt32BE(20), colorType: png[25] };
  };

  it("are the logo as real PNG files with transparency, at the sizes the system needs", () => {
    for (const [file, px] of [["icon.png", 512], ["tray.png", 64], ["tray-dark.png", 64]] as const) {
      const info = size(file);
      expect(info.signature).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      expect([info.width, info.height]).toEqual([px, px]);
      expect(info.colorType).toBe(6);
    }
  });

  it("have a light tray version, because the black leaf disappears on a dark taskbar", () => {
    const light = readFileSync(join(__dirname, "..", "assets", "tray.png"));
    const dark = readFileSync(join(__dirname, "..", "assets", "tray-dark.png"));
    expect(dark.equals(light)).toBe(false);
  });
});

describe("the Windows icon file", () => {
  it("wraps the PNG so notifications can show the logo", async () => {
    const { pngToIco } = await import("../src/main/icofile");
    const png = readFileSync(join(__dirname, "..", "assets", "icon.png"));
    const ico = pngToIco(png, 256);
    expect([...ico.subarray(0, 6)]).toEqual([0, 0, 1, 0, 1, 0]);
    expect(ico.readUInt32LE(14)).toBe(png.length);
    expect(ico.subarray(22).equals(png)).toBe(true);
  });
});
