import { describe, expect, it } from "vitest";
import { blockCapacity, buildSegments, segmentAt } from "../src/schedule";

const cfg = { pomodoroMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, cyclesBeforeLongBreak: 4 };

describe("buildSegments", () => {
  it("fits 25 + 5 exactly twice per hour", () => {
    const s = buildSegments(9 * 60, 10 * 60, cfg);
    expect(s.map((x) => [x.kind, x.startMin - 540, x.endMin - 540])).toEqual([
      ["work", 0, 25],
      ["break", 25, 30],
      ["work", 30, 55],
      ["break", 55, 60],
    ]);
  });

  it("uses the long break after every fourth pomodoro", () => {
    const s = buildSegments(9 * 60, 12 * 60, cfg);
    const breaks = s.filter((x) => x.kind === "break");
    expect(breaks.filter((b) => b.long).map((b) => b.pomodoro)).toEqual([4]);
    expect(breaks.find((b) => b.long)!.endMin - breaks.find((b) => b.long)!.startMin).toBe(15);
  });

  it("always fills the block exactly, with no gaps or overlaps", () => {
    for (const [pom, short, long, cycles, hours] of [
      [25, 5, 15, 4, 3],
      [50, 10, 20, 3, 4],
      [45, 7, 20, 2, 2],
      [30, 10, 25, 4, 1],
    ] as const) {
      const c = { pomodoroMinutes: pom, shortBreakMinutes: short, longBreakMinutes: long, cyclesBeforeLongBreak: cycles };
      const s = buildSegments(540, 540 + hours * 60, c);
      expect(s[0]!.startMin).toBe(540);
      expect(s[s.length - 1]!.endMin).toBe(540 + hours * 60);
      for (let i = 1; i < s.length; i++) expect(s[i]!.startMin).toBe(s[i - 1]!.endMin);
    }
  });

  it("shortens the final pomodoro when the cycle does not divide the block", () => {
    const c = { ...cfg, pomodoroMinutes: 50, shortBreakMinutes: 10 };
    const s = buildSegments(0, 120, c); // 50w 10b 50w 10b = 120
    expect(s.map((x) => x.endMin - x.startMin)).toEqual([50, 10, 50, 10]);
    const odd = buildSegments(0, 90, c); // 50w 10b 30w
    expect(odd.map((x) => x.endMin - x.startMin)).toEqual([50, 10, 30]);
    expect(odd[2]!.kind).toBe("work");
  });

  it("restarts the cycle at each block", () => {
    const a = buildSegments(540, 720, cfg);
    const b = buildSegments(780, 960, cfg);
    expect(a.map((x) => [x.kind, x.pomodoro])).toEqual(b.map((x) => [x.kind, x.pomodoro]));
  });
});

describe("segmentAt", () => {
  const s = buildSegments(540, 600, cfg);
  it("finds the segment for a minute", () => {
    expect(segmentAt(s, 540)!.kind).toBe("work");
    expect(segmentAt(s, 564)!.kind).toBe("work");
    expect(segmentAt(s, 565)!.kind).toBe("break");
    expect(segmentAt(s, 599)!.kind).toBe("break");
  });
  it("returns null outside the block", () => {
    expect(segmentAt(s, 539)).toBeNull();
    expect(segmentAt(s, 600)).toBeNull();
  });
});

describe("blockCapacity", () => {
  it("counts pomodoros", () => {
    expect(blockCapacity(9, 12, cfg)).toBe(6);
    expect(blockCapacity(13, 17, cfg)).toBe(8);
  });
});
