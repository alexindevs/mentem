import { describe, expect, it } from "vitest";
import { describeRule, occurrences, occursOn } from "../src/repeat";
import type { RepeatRule } from "../src/types";

// 2026-11-16 is a Monday.
describe("weekly repeat", () => {
  const rule: RepeatRule = { interval: 1, unit: "week", anchor: "2026-11-16", weekdays: [0, 2] };

  it("occurs on the chosen weekdays from the anchor on", () => {
    expect(occurrences(rule, "2026-11-16", "2026-11-29")).toEqual([
      "2026-11-16",
      "2026-11-18",
      "2026-11-23",
      "2026-11-25",
    ]);
  });

  it("never occurs before the anchor", () => {
    expect(occursOn(rule, "2026-11-09")).toBe(false);
  });

  it("every other week skips alternate weeks", () => {
    const biweekly: RepeatRule = { ...rule, interval: 2 };
    expect(occurrences(biweekly, "2026-11-16", "2026-12-13")).toEqual([
      "2026-11-16",
      "2026-11-18",
      "2026-11-30",
      "2026-12-02",
    ]);
    expect(occursOn(biweekly, "2026-11-23")).toBe(false);
    expect(occursOn(biweekly, "2026-11-30")).toBe(true);
  });

  it("defaults to the anchor's weekday", () => {
    const r: RepeatRule = { interval: 1, unit: "week", anchor: "2026-11-18" };
    expect(occurrences(r, "2026-11-16", "2026-11-30")).toEqual(["2026-11-18", "2026-11-25"]);
  });

  it("counts weeks from Monday even if the anchor is mid-week", () => {
    const r: RepeatRule = { interval: 2, unit: "week", anchor: "2026-11-19", weekdays: [3, 0] };
    expect(occursOn(r, "2026-11-19")).toBe(true);
    expect(occursOn(r, "2026-11-23")).toBe(false); // the next week is skipped
    expect(occursOn(r, "2026-11-30")).toBe(true);
  });
});

describe("monthly repeat", () => {
  it("occurs on a date of the month", () => {
    const r: RepeatRule = { interval: 1, unit: "month", anchor: "2026-11-16", monthDay: 16 };
    expect(occurrences(r, "2026-11-01", "2027-02-28")).toEqual(["2026-11-16", "2026-12-16", "2027-01-16", "2027-02-16"]);
  });

  it("clamps the 31st to the end of shorter months", () => {
    const r: RepeatRule = { interval: 1, unit: "month", anchor: "2026-01-31", monthDay: 31 };
    expect(occurrences(r, "2026-01-01", "2026-04-30")).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  });

  it("every other month", () => {
    const r: RepeatRule = { interval: 2, unit: "month", anchor: "2026-11-16", monthDay: 16 };
    expect(occurrences(r, "2026-11-01", "2027-03-31")).toEqual(["2026-11-16", "2027-01-16", "2027-03-16"]);
  });
});

describe("yearly repeat", () => {
  it("occurs on a date of the year", () => {
    const r: RepeatRule = { interval: 1, unit: "year", anchor: "2026-11-16", yearMonth: 11, yearDay: 16 };
    expect(occurrences(r, "2026-01-01", "2028-12-31")).toEqual(["2026-11-16", "2027-11-16", "2028-11-16"]);
  });

  it("every other year", () => {
    const r: RepeatRule = { interval: 2, unit: "year", anchor: "2026-11-16" };
    expect(occurrences(r, "2026-01-01", "2030-12-31")).toEqual(["2026-11-16", "2028-11-16", "2030-11-16"]);
  });

  it("moves 29 February to the 28th in non-leap years", () => {
    const r: RepeatRule = { interval: 1, unit: "year", anchor: "2024-02-29", yearMonth: 2, yearDay: 29 };
    expect(occurrences(r, "2024-01-01", "2026-12-31")).toEqual(["2024-02-29", "2025-02-28", "2026-02-28"]);
  });
});

describe("describeRule", () => {
  it("gives short labels", () => {
    expect(describeRule({ interval: 2, unit: "week", anchor: "2026-11-16", weekdays: [4, 0, 2] })).toBe(
      "Every other week · Mon, Wed, Fri",
    );
    expect(describeRule({ interval: 1, unit: "month", anchor: "2026-11-16", monthDay: 16 })).toBe("Every month · day 16");
    expect(describeRule({ interval: 1, unit: "year", anchor: "2026-11-16" })).toBe("Every year · Nov 16");
  });
});
