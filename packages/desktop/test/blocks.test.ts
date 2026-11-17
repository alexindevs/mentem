import { describe, expect, it } from "vitest";
import { MAX_BLOCKS as CORE_MAX } from "@mentem/core";
import { freeGap, hasDuplicateName, isStandardBlock, nextBlockName } from "../src/renderer/src/lib/blocks";
import { MAX_BLOCKS } from "../src/shared/pages";

const on = (name: string, startHour: number, endHour: number) => ({ name, enabled: true, startHour, endHour });

describe("adding a work block", () => {
  it("uses the same limit as the core", () => {
    expect(MAX_BLOCKS).toBe(CORE_MAX);
  });

  it("starts the new block in the first free hour of the day", () => {
    const blocks = [on("Morning", 9, 12), on("Afternoon", 13, 17)];
    expect(freeGap(blocks, 7 * 60, 23 * 60)).toEqual({ startHour: 7, endHour: 8 });
    expect(freeGap([on("Early", 7, 9), ...blocks], 7 * 60, 23 * 60)).toEqual({ startHour: 12, endHour: 13 });
  });

  it("ignores blocks that are switched off", () => {
    expect(freeGap([{ name: "Evening", enabled: false, startHour: 7, endHour: 22 }], 7 * 60, 23 * 60)).toEqual({ startHour: 7, endHour: 8 });
  });

  it("starts at the next whole hour after waking, and stays before bed", () => {
    expect(freeGap([], 6 * 60 + 30, 9 * 60)).toEqual({ startHour: 7, endHour: 8 });
    expect(freeGap([on("All day", 7, 9)], 6 * 60 + 30, 9 * 60)).toBeNull();
  });

  it("says there is no room when the day is full", () => {
    expect(freeGap([on("Everything", 8, 22)], 8 * 60, 22 * 60)).toBeNull();
  });

  it("names the new block so nothing clashes", () => {
    expect(nextBlockName([on("Morning", 9, 12), on("Afternoon", 13, 17)])).toBe("Block 3");
    expect(nextBlockName([on("Block 3", 9, 12), on("Afternoon", 13, 17)])).toBe("Block 4");
  });

  it("tells the usual three from the ones you add", () => {
    expect(isStandardBlock("morning")).toBe(true);
    expect(isStandardBlock(" Evening ")).toBe(true);
    expect(isStandardBlock("Block 4")).toBe(false);
  });

  it("spots two blocks with the same name, but not a switched-off one", () => {
    expect(hasDuplicateName([on("Work", 9, 11), on("work", 13, 15)])).toBe(true);
    expect(hasDuplicateName([on("Work", 9, 11), { name: "Work", enabled: false, startHour: 13, endHour: 15 }])).toBe(false);
  });
});

import { shortcutFor } from "../src/renderer/src/lib/shortcuts";

describe("keyboard shortcuts", () => {
  const press = (key: string, extra: Partial<{ ctrlKey: boolean; altKey: boolean; metaKey: boolean; repeat: boolean }> = {}) => ({ key, ctrlKey: false, altKey: false, metaKey: false, ...extra });

  it("maps the keys to what they do", () => {
    expect(shortcutFor(press("n"), false, false)).toEqual({ type: "quick-add" });
    expect(shortcutFor(press("M"), false, false)).toEqual({ type: "meeting" });
    expect(shortcutFor(press("d"), false, false)).toEqual({ type: "done" });
    expect(shortcutFor(press("p"), false, false)).toEqual({ type: "pause" });
    expect(shortcutFor(press("3"), false, false)).toEqual({ type: "page", page: "Meetings" });
    expect(shortcutFor(press("6"), false, false)).toEqual({ type: "page", page: "Reports" });
  });

  it("leaves typing, system shortcuts and open drawers alone", () => {
    expect(shortcutFor(press("n"), true, false)).toBeNull();
    expect(shortcutFor(press("n"), false, true)).toBeNull();
    expect(shortcutFor(press("n", { ctrlKey: true }), false, false)).toBeNull();
    expect(shortcutFor(press("d", { metaKey: true }), false, false)).toBeNull();
    expect(shortcutFor(press("p", { repeat: true }), false, false)).toBeNull();
    expect(shortcutFor(press("7"), false, false)).toBeNull();
    expect(shortcutFor(press("0"), false, false)).toBeNull();
    expect(shortcutFor(press("x"), false, false)).toBeNull();
  });
});
