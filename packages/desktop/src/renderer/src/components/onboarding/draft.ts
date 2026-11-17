import type { ThemeId } from "@mentem/core";
import type { OnboardingInput } from "@shared/api";
import { hasDuplicateName } from "../../lib/blocks";
import { blockTime, formatSpan, formatTime } from "../../lib/time";

export interface RoutineDraft {
  id: number;
  title: string;
  startMin: number;
  endMin: number | null;
}

export interface BlockDraft {
  name: string;
  enabled: boolean;
  startHour: number;
  endHour: number;
}

export interface Pomodoro {
  focus: number;
  short: number;
  long: number;
  cycles: number;
}

export interface Draft {
  userName: string;
  customName: boolean;
  appName: string;
  cliName: string;
  workStyle: "freelancer" | "full-time";
  wakeMin: number;
  bedMin: number;
  routine: RoutineDraft[];
  blocks: BlockDraft[];
  templateName: string;
  weekdays: number[];
  weekEndDay: number;
  pomodoro: Pomodoro;
  /** True after choosing Custom, so the pill stays chosen even when the numbers match a preset. */
  rhythmCustom: boolean;
  alerts: { sound: boolean; notifications: boolean; tray: boolean; startOnLogin: boolean };
  theme: ThemeId;
  matchSystem: boolean;
}

export const PRESETS: Array<{ key: string; label: string; values: Pomodoro }> = [
  { key: "classic", label: "Classic 25 / 5", values: { focus: 25, short: 5, long: 15, cycles: 4 } },
  { key: "deep", label: "Deep 50 / 10", values: { focus: 50, short: 10, long: 30, cycles: 3 } },
  { key: "light", label: "Light 15 / 5", values: { focus: 15, short: 5, long: 15, cycles: 4 } },
];

const at = (hour: number, minute = 0) => hour * 60 + minute;

/** Tapping one adds it at a suggested start time and length. */
export const SUGGESTIONS: Array<{ title: string; startMin: number; endMin: number }> = [
  { title: "Brush teeth", startMin: at(7, 15), endMin: at(7, 25) },
  { title: "Morning walk", startMin: at(7, 30), endMin: at(8) },
  { title: "Breakfast", startMin: at(8, 30), endMin: at(9) },
  { title: "Shower", startMin: at(8), endMin: at(8, 20) },
  { title: "Lunch", startMin: at(12, 30), endMin: at(13) },
  { title: "Exercise", startMin: at(17, 30), endMin: at(18, 30) },
  { title: "Meditate", startMin: at(7), endMin: at(7, 10) },
  { title: "Journal", startMin: at(21, 30), endMin: at(21, 50) },
  { title: "Stretch", startMin: at(15), endMin: at(15, 10) },
  { title: "Dinner", startMin: at(19, 30), endMin: at(20, 30) },
  { title: "Tidy up", startMin: at(20, 30), endMin: at(21) },
  { title: "Wind down", startMin: at(22, 30), endMin: at(23) },
];

const DEFAULT_ROUTINE = ["Brush teeth", "Morning walk", "Breakfast", "Lunch", "Dinner", "Wind down"];

export const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export const THEME_NAMES: Record<ThemeId, string> = {
  "white-green": "White and green",
  "white-black": "White and black",
  "black-orange": "Black and orange",
  "black-white": "Black and white",
};

export function defaultDraft(): Draft {
  return {
    userName: "",
    customName: false,
    appName: "Mentem",
    cliName: "mentem",
    workStyle: "full-time",
    wakeMin: at(7),
    bedMin: at(23),
    routine: DEFAULT_ROUTINE.map((title, id) => {
      const s = SUGGESTIONS.find((x) => x.title === title)!;
      return { id: id + 1, title, startMin: s.startMin, endMin: s.endMin };
    }),
    blocks: [
      { name: "Morning", enabled: true, startHour: 9, endHour: 12 },
      { name: "Afternoon", enabled: true, startHour: 13, endHour: 17 },
      { name: "Evening", enabled: false, startHour: 19, endHour: 21 },
    ],
    templateName: "Weekday",
    weekdays: [0, 1, 2, 3, 4],
    weekEndDay: 6,
    pomodoro: PRESETS[0]!.values,
    rhythmCustom: false,
    alerts: { sound: true, notifications: true, tray: true, startOnLogin: true },
    theme: "white-green",
    matchSystem: false,
  };
}

/** Which preset the numbers match, or "custom". */
export function presetKey(draft: Draft): string {
  if (draft.rhythmCustom) return "custom";
  const p = draft.pomodoro;
  return PRESETS.find((x) => x.values.focus === p.focus && x.values.short === p.short && x.values.long === p.long && x.values.cycles === p.cycles)?.key ?? "custom";
}

export function pomodorosIn(block: BlockDraft, p: Pomodoro): number {
  return Math.max(0, Math.floor(((block.endHour - block.startHour) * 60) / (p.focus + p.short)));
}

const NAME_PATTERN = /^[A-Za-z0-9-]{1,30}$/;

export function nameProblem(draft: Draft): string | null {
  if (!draft.customName) return null;
  if (!draft.appName.trim()) return "Give the app a name";
  if (!NAME_PATTERN.test(draft.cliName)) return "Command: letters, numbers and hyphens only";
  return null;
}

export interface Overlap {
  item: RoutineDraft;
  block: BlockDraft;
  /** The part of the day both cover, in minutes. */
  from: number;
  to: number;
}

/** Routine items that run during a work block. Shown as a note, never a blocker. */
export function overlapsOf(draft: Draft): Overlap[] {
  const out: Overlap[] = [];
  for (const block of draft.blocks.filter((b) => b.enabled)) {
    for (const item of draft.routine) {
      if (item.endMin === null) continue;
      const from = Math.max(item.startMin, block.startHour * 60);
      const to = Math.min(item.endMin, block.endHour * 60);
      if (from < to) out.push({ item, block, from, to });
    }
  }
  return out;
}

/** Why a step can't continue yet, or null when it can. */
export function stepProblem(step: number, draft: Draft): string | null {
  if (step === 2) return nameProblem(draft);
  if (step === 4) return draft.bedMin - draft.wakeMin >= 60 ? null : "Bed time must be at least an hour after wake time";
  if (step === 6) {
    const on = draft.blocks.filter((b) => b.enabled).sort((a, b) => a.startHour - b.startHour);
    if (on.length === 0) return "Turn on at least one block";
    if (hasDuplicateName(draft.blocks)) return "Blocks need different names";
    for (const [i, block] of on.entries()) {
      if (!block.name.trim()) return "Every block needs a name";
      if (block.endHour <= block.startHour) return `${block.name} must end after it starts`;
      if (block.startHour * 60 < draft.wakeMin || block.endHour * 60 > draft.bedMin) return `${block.name} must fit between wake and bed`;
      const next = on[i + 1];
      if (next && block.endHour > next.startHour) return `${block.name} overlaps ${next.name}`;
    }
  }
  if (step === 7) {
    if (!draft.templateName.trim()) return "Name the template";
    if (draft.weekdays.length === 0) return "Pick at least one day";
  }
  return null;
}

export function toInput(draft: Draft): OnboardingInput {
  return {
    userName: draft.userName.trim(),
    appName: draft.customName ? draft.appName.trim() : "Mentem",
    cliName: draft.customName ? draft.cliName : "mentem",
    workStyle: draft.workStyle,
    wakeMin: draft.wakeMin,
    bedMin: draft.bedMin,
    routine: draft.routine.map(({ title, startMin, endMin }) => ({ title: title.trim(), startMin, endMin })),
    blocks: draft.blocks.filter((b) => b.enabled).sort((a, b) => a.startHour - b.startHour).map((b) => ({ name: b.name.trim(), startHour: b.startHour, endHour: b.endHour })),
    templateName: draft.templateName.trim(),
    weekdays: draft.weekdays,
    weekEndDay: draft.weekEndDay,
    pomodoro: draft.pomodoro,
    alerts: { ...draft.alerts, weekPopups: true },
    theme: draft.theme,
    matchSystem: draft.matchSystem,
  };
}

// ----------------------------------------------------------------- summary text

/** "Mon to Fri" for a run of days, otherwise the days listed. */
export function daysLabel(days: number[]): string {
  const sorted = [...days].sort((a, b) => a - b);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (first === undefined || last === undefined) return "";
  if (sorted.length > 2 && last - first === sorted.length - 1) return `${DAY_SHORT[first]} to ${DAY_SHORT[last]}`;
  return sorted.map((d) => DAY_SHORT[d]).join(", ");
}


export function summaryRows(draft: Draft): Array<[string, string]> {
  const blocks = draft.blocks.filter((b) => b.enabled);
  return [
    ["App name", draft.customName ? `${draft.appName.trim()} · command: ${draft.cliName}` : "Mentem · command: mentem"],
    ["Work style", draft.workStyle === "full-time" ? "Full-time" : "Freelancer"],
    ["Day template", `${draft.templateName.trim()} · ${daysLabel(draft.weekdays)} · up ${formatTime(draft.wakeMin)}, bed ${formatTime(draft.bedMin)}`],
    ["Routine items", `${draft.routine.length + 1} items`],
    ["Work blocks", blocks.map((b) => `${b.name} ${blockTime(b.startHour * 60)} – ${blockTime(b.endHour * 60)}`).join(" · ")],
    ["Focus rhythm", `${draft.pomodoro.focus} min focus · ${draft.pomodoro.short} min break · ${draft.pomodoro.long} min long break`],
    ["Week ends", DAY_NAMES[draft.weekEndDay] ?? ""],
    ["Theme", THEME_NAMES[draft.theme]],
  ];
}

export const awake = (draft: Draft) => formatSpan(Math.max(0, draft.bedMin - draft.wakeMin));
