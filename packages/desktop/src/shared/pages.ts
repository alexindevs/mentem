import type { RepeatRule } from "@mentem/core";

/** Data shapes for the pages beyond Today. */

/** The most work blocks a day can have. The same number as in the core package, which a test keeps true. */
export const MAX_BLOCKS = 12;

export type TaskStatus = "open" | "in_progress" | "done";

export interface TaskDetail {
  id: string;
  title: string;
  status: TaskStatus;
  projectId: string | null;
  deliverableId: string | null;
  due: string | null;
  estimate: number | null;
  notes: string;
  steps: Array<{ id: string; text: string; done: boolean }>;
  /** Subtasks and their own subtasks, in order, with how deep each is. */
  subtasks: Array<{ id: string; title: string; done: boolean; depth: number }>;
  /** Where it sits, or null when it is Unscheduled. */
  assigned: { date: string; label: string; slot: number; slotName: string } | null;
  /** The blocks on the day it sits on (or today), to move it between. */
  blocks: Array<{ slot: number; name: string }>;
  projects: Array<{ id: string; name: string; deliverables: Array<{ id: string; title: string }> }>;
  /** How it repeats, or null when it does not. */
  repeat: { rule: RepeatRule; label: string } | null;
  /** Today's date, for placing it in one of today's blocks. */
  today: string;
  /** It belongs to the block that is running now, so it can be worked on now. */
  workable: boolean;
}

export interface TaskPatch {
  title?: string;
  status?: TaskStatus;
  projectId?: string | null;
  deliverableId?: string | null;
  due?: string | null;
  estimate?: number | null;
  notes?: string;
}

export interface WeekDay {
  date: string;
  weekday: string;
  day: number;
  isToday: boolean;
  /** Before today. Nothing can be placed on it any more. */
  past: boolean;
  isWeekEnd: boolean;
  /** Name of the template, or null on a day with none. */
  template: string | null;
  templateId: string | null;
  /** "Up 7:00 · Morning, Afternoon". */
  summary: string;
  blocks: Array<{
    slot: number;
    name: string;
    startMin: number;
    endMin: number;
    tasks: Array<{ id: string; title: string; done: boolean; overdue: boolean; current: boolean }>;
  }>;
  meetings: MeetingRow[];
}

/** A meeting as a row in a day's list. */
export interface MeetingRow {
  id: string;
  title: string;
  startMin: number;
  endMin: number;
  hasLink: boolean;
  /** It has already finished today. */
  past: boolean;
}

/** Everything the meeting drawer edits. */
export interface MeetingDetail {
  id: string;
  title: string;
  /** The day it happens, or the first day of a repeating meeting. */
  date: string;
  startMin: number;
  endMin: number;
  kind: "online" | "in-person";
  link: string | null;
  place: string | null;
  notes: string;
  attendees: string[];
  repeat: { rule: RepeatRule; label: string } | null;
  /** The day these minutes belong to: the one it was opened from. */
  day: string;
  minutes: string;
}

/** One meeting on one day, as a row on the Meetings page. */
export interface MeetingListItem {
  id: string;
  date: string;
  title: string;
  startMin: number;
  endMin: number;
  kind: "online" | "in-person";
  place: string | null;
  people: number;
  hasMinutes: boolean;
  repeatLabel: string | null;
  /** Past meetings with nothing written down yet. */
  needsMinutes: boolean;
}

/** Whether a newer version is on its way. */
export interface UpdateState {
  status: "unavailable" | "idle" | "checking" | "downloading" | "ready" | "current" | "error";
  /** The version that is running. */
  version: string;
  /** The newer version, once one is found. */
  available: string | null;
  percent: number | null;
  checkedAt: number | null;
}

export interface WeekData {
  label: string;
  days: WeekDay[];
  unscheduled: Array<{ id: string; title: string }>;
  templates: Array<{ id: string; name: string }>;
}

export interface TemplateRoutineItem {
  /** Missing on an item that was just added. */
  id?: string;
  title: string;
  startMin: number;
  endMin: number | null;
  /** Null means it shows every time the template runs. */
  repeat: { rule: RepeatRule; label: string } | null;
}

export interface TemplateDetail {
  id: string;
  name: string;
  wakeMin: number;
  bedMin: number;
  blocks: Array<{ name: string; enabled: boolean; startHour: number; endHour: number }>;
  routine: TemplateRoutineItem[];
  weekdays: number[];
  /** "Mon to Fri", "Sat, Sun", or "Dates only". */
  summary: string;
}

export interface TemplatesData {
  /** Today, the date a new repeat counts from. */
  today: string;
  templates: TemplateDetail[];
}

export interface ChangeSummary {
  moved: number;
  /** Whether the change can be undone right now. */
  canUndo: boolean;
}

// ------------------------------------------------------------------ projects

export type ChipTone = "danger" | "neutral" | "accent";

export interface ProjectCard {
  id: string;
  name: string;
  description: string;
  done: number;
  total: number;
  chip: { label: string; tone: ChipTone } | null;
}

export interface ProjectGroup {
  /** Null for tasks that belong to the project but to no deliverable. */
  id: string | null;
  type: "deliverable" | "milestone" | "deadline" | null;
  title: string;
  due: { label: string; tone: ChipTone } | null;
  tasks: Array<{ id: string; title: string; done: boolean; due: { label: string; tone: "danger" | "neutral" } | null }>;
}

export interface ProjectDetail {
  id: string;
  name: string;
  context: string;
  done: number;
  total: number;
  groups: ProjectGroup[];
}

export interface NewProject {
  name: string;
  description: string;
  context: string;
  deliverables: Array<{ type: "deliverable" | "milestone" | "deadline"; title: string }>;
}

// ------------------------------------------------------------------- reports

export interface ReportSummary {
  weekStart: string;
  label: string;
  planned: number;
  done: number;
  onTimePct: number;
  level: "Low" | "Medium" | "High";
  /** Percentage points against the week before; positive means more procrastination. */
  change: number | null;
}

export interface ReportDetail {
  weekStart: string;
  label: string;
  onTimePct: number;
  onTimeCount: number;
  planned: number;
  done: number;
  unfinished: number;
  rescheduled: number;
  procrastination: { level: "Low" | "Medium" | "High"; change: number | null; previousPct: number | null };
  mostRescheduled: { title: string; times: number } | null;
  bestTime: { label: string; onTime: number; total: number } | null;
  streak: { current: number; best: number };
  lists: Record<"planned" | "done" | "rescheduled" | "unfinished", Array<{ id: string; title: string; done: boolean; move: string | null }>>;
}

export interface SessionsData {
  focusMinutes: number;
  pomodoros: number;
  tasksDone: number;
  days: Array<{ label: string; rows: Array<{ time: string; title: string | null; kind: "work" | "break"; minutes: number }> }>;
}

export interface Prompts {
  report: { weekStart: string; label: string } | null;
  planning: { weekStart: string; label: string } | null;
}

export interface PlanningData {
  week: WeekData;
  /** Unscheduled tasks that were sent back to Unscheduled when last week ended. */
  lastWeek: string[];
}

// ---------------------------------------------------------------------- data

export interface SnapshotView {
  name: string;
  kind: "daily" | "pre-migration" | "pre-update" | "pre-restore" | "manual";
  createdAt: number;
  bytes: number;
}

export interface CliInfo {
  name: string;
  /** The folder the launcher is in, and whether that folder is on the PATH. */
  dir: string;
  onPath: boolean;
  /** Only Windows can add it from here. */
  canAddToPath: boolean;
}
