import type { LocalDate } from "./dates";

/** The most work blocks a day can have. They only have to fit between waking and bed. */
export const MAX_BLOCKS = 12;

/** A block's place in the day, 1 upward in time order. The name is only a label. */
export type Slot = number;

export type ThemeId = "white-green" | "white-black" | "black-orange" | "black-white";

export interface Settings {
  pomodoroMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  cyclesBeforeLongBreak: number;
  /** 0 = Monday ... 6 = Sunday. */
  weekEndDay: number;
  soundEnabled: boolean;
  notificationsEnabled: boolean;
  keepRunningInTray: boolean;
  startOnLogin: boolean;
  weekPopupsEnabled: boolean;
  appName: string;
  cliName: string;
  userName: string;
  workStyle: "freelancer" | "full-time";
  theme: ThemeId;
  matchSystem: boolean;
  setupCompleted: boolean;
  setupStep: number;
}

export const DEFAULT_SETTINGS: Settings = {
  pomodoroMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  cyclesBeforeLongBreak: 4,
  weekEndDay: 6,
  soundEnabled: true,
  notificationsEnabled: true,
  keepRunningInTray: true,
  startOnLogin: true,
  weekPopupsEnabled: true,
  appName: "Mentem",
  cliName: "mentem",
  userName: "",
  workStyle: "full-time",
  theme: "white-green",
  matchSystem: false,
  setupCompleted: false,
  setupStep: 0,
};

/**
 * Every day, week, month or year, or every 2nd, 3rd, 4th and so on (`interval`).
 * `anchor` is the date the rule starts from; every count is made from it.
 */
export interface RepeatRule {
  /** 1 means every, 2 every other, 3 every third, up to 99. */
  interval: number;
  unit: "day" | "week" | "month" | "year";
  anchor: LocalDate;
  /** For week: weekdays, 0 = Monday. Defaults to the anchor's weekday. */
  weekdays?: number[];
  /** For month: day of the month, 1-31 (clamped to the month's length). */
  monthDay?: number;
  /** For year: month 1-12 and day 1-31. */
  yearMonth?: number;
  yearDay?: number;
}

export interface Block {
  slot: Slot;
  name: string;
  startHour: number;
  endHour: number;
}

export interface RoutineItem {
  id: string;
  templateId: string;
  title: string;
  startMin: number;
  endMin: number | null;
  position: number;
  /** null means it happens every time the template is used. */
  repeat: RepeatRule | null;
}

export interface Template {
  id: string;
  name: string;
  wakeMin: number;
  bedMin: number;
  blocks: Block[];
  routine: RoutineItem[];
}

export type TaskStatus = "open" | "in_progress" | "done";

export interface Task {
  id: string;
  parentId: string | null;
  projectId: string | null;
  deliverableId: string | null;
  seriesId: string | null;
  title: string;
  notes: string;
  estimatePomodoros: number | null;
  dueDate: LocalDate | null;
  status: TaskStatus;
  createdAt: number;
  completedAt: number | null;
}

export interface TaskStep {
  id: string;
  taskId: string;
  text: string;
  done: boolean;
  position: number;
}

export interface Assignment {
  id: string;
  taskId: string;
  date: LocalDate;
  slot: Slot;
  position: number;
  repeat: RepeatRule | null;
  createdAt: number;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  context: string;
  createdAt: number;
}

export type DeliverableType = "deliverable" | "milestone" | "deadline";

export interface Deliverable {
  id: string;
  projectId: string;
  title: string;
  type: DeliverableType;
  dueDate: LocalDate | null;
  status: "open" | "done";
}

export type EventKind = "assigned" | "moved" | "rolled" | "unassigned" | "completed" | "reopened";
export type EventReason = "manual" | "rollover" | "template_change";

/** A block occurrence resolved to a date and absolute minutes. */
export interface DayBlock extends Block {
  date: LocalDate;
  startMin: number;
  endMin: number;
}
