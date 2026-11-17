import { z } from "zod";
import type { RepeatRule, Settings } from "@mentem/core";
import type { ChangeSummary, UpdateState, MeetingDetail, MeetingListItem, MeetingRow, NewProject, PlanningData, CliInfo, SnapshotView, ProjectCard, ProjectDetail, Prompts, ReportDetail, ReportSummary, SessionsData, TaskDetail, TaskPatch, TemplateDetail, TemplatesData, WeekData } from "./pages";
export type * from "./pages";
import { MAX_BLOCKS } from "./pages";
export { CHANNEL, TIMER_CHANNEL } from "./channel";

/**
 * The only way the window talks to the rest of the app. Every call is validated in the
 * main process with these schemas, so the renderer can never pass anything unexpected
 * to the database layer.
 */

export const THEMES = ["white-green", "white-black", "black-orange", "black-white"] as const;

const minutes = z.number().int().min(0).max(24 * 60);
/** A time on a block boundary, in hours: quarter hours allowed, such as 9.25 for 9:15. */
const hour = z.number().min(0).max(24).multipleOf(0.25);
const cliName = z.string().regex(/^[A-Za-z0-9-]{1,30}$/);

export const settingsPatchSchema = z
  .object({
    pomodoroMinutes: z.number().int().min(1).max(180),
    shortBreakMinutes: z.number().int().min(1).max(60),
    longBreakMinutes: z.number().int().min(1).max(120),
    cyclesBeforeLongBreak: z.number().int().min(1).max(12),
    weekEndDay: z.number().int().min(0).max(6),
    soundEnabled: z.boolean(),
    notificationsEnabled: z.boolean(),
    keepRunningInTray: z.boolean(),
    startOnLogin: z.boolean(),
    weekPopupsEnabled: z.boolean(),
    hideDoneTasks: z.boolean(),
    appName: z.string().trim().min(1).max(40),
    cliName,
    userName: z.string().trim().max(60),
    workStyle: z.enum(["freelancer", "full-time"]),
    theme: z.enum(THEMES),
    matchSystem: z.boolean(),
    setupStep: z.number().int().min(0).max(20),
  })
  .partial()
  .strict();

export const onboardingSchema = z
  .object({
    userName: z.string().trim().max(60),
    appName: z.string().trim().min(1).max(40),
    cliName,
    workStyle: z.enum(["freelancer", "full-time"]),
    wakeMin: minutes,
    bedMin: minutes,
    routine: z
      .array(z.object({ title: z.string().trim().min(1).max(80), startMin: minutes, endMin: minutes.nullable() }))
      .max(40),
    blocks: z
      .array(z.object({ name: z.string().trim().min(1).max(30), startHour: hour, endHour: hour }))
      .min(1)
      .max(MAX_BLOCKS),
    templateName: z.string().trim().min(1).max(40),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    weekEndDay: z.number().int().min(0).max(6),
    pomodoro: z.object({
      focus: z.number().int().min(1).max(180),
      short: z.number().int().min(1).max(60),
      long: z.number().int().min(1).max(120),
      cycles: z.number().int().min(1).max(12),
    }),
    alerts: z.object({
      sound: z.boolean(),
      notifications: z.boolean(),
      tray: z.boolean(),
      startOnLogin: z.boolean(),
      weekPopups: z.boolean(),
    }),
    theme: z.enum(THEMES),
    matchSystem: z.boolean(),
  })
  .refine((v) => v.bedMin > v.wakeMin, { message: "Bed time must be after wake time" })
  .refine((v) => v.blocks.every((b) => b.endHour > b.startHour), { message: "A block must end after it starts" });

export type OnboardingInput = z.infer<typeof onboardingSchema>;

export const timerActionSchema = z.enum(["pause", "resume", "skip", "done"]);
export type TimerAction = z.infer<typeof timerActionSchema>;
/** What a pause or skip applies to: the work block, or the routine item running beside it. */
export const timerTargetSchema = z.enum(["block", "routine"]);
export type TimerTarget = z.infer<typeof timerTargetSchema>;

export interface AppInfo {
  version: string;
  platform: string;
  /** Set when the app was opened with a test route, to skip the launch screen. */
  startHash: string;
}

export type TimerKind = "work" | "break" | "routine" | "meeting" | "between" | "rest" | "no-template";

export interface RoutineRun {
  title: string;
  startMin: number;
  endMin: number | null;
  /** Epoch milliseconds when it ends. Null while paused. */
  endsAt: number | null;
  remainingMs: number;
  totalMs: number;
}

export interface MeetingRun {
  id: string;
  title: string;
  startMin: number;
  endMin: number;
  /** Epoch milliseconds when it ends. */
  endsAt: number;
  remainingMs: number;
  totalMs: number;
  link: string | null;
}

/** What the Now card needs, with times as plain numbers so it can cross the bridge. */
export interface TimerView {
  /** The app's current time in epoch milliseconds, so the window counts from the same clock. */
  now: number;
  kind: TimerKind;
  paused: boolean;
  blockName: string | null;
  blockStartMin: number | null;
  blockEndMin: number | null;
  pomodoro: { index: number; total: number } | null;
  breakKind: "short" | "long" | null;
  /** Epoch milliseconds when the running segment ends. Null while paused or untimed. */
  endsAt: number | null;
  remainingMs: number;
  /** Length of the running segment, for the progress bar. */
  totalMs: number;
  /** The whole block's end, for an empty block that counts down to it. */
  blockEndsAt: number | null;
  blockMs: number | null;
  task: { id: string; title: string; context: string | null } | null;
  step: { text: string; index: number; total: number } | null;
  nextTask: string | null;
  emptyBlock: boolean;
  nextBlock: { name: string; startMin: number } | null;
  startsInMs: number | null;
  /** Routine items running right now. With a block, that is an overlap. */
  routine: RoutineRun[];
  /** The routine item that comes next today, for the "Next:" line during a routine item. */
  nextLabel: string | null;
  routinePaused: boolean;
  /** The meeting running now, if any. The pomodoro waits for it. */
  meeting: MeetingRun | null;
  /** The next meeting today, for a quiet "Next" line. */
  nextMeeting: { title: string; startMin: number } | null;
  /** In an empty block you chose to leave empty. */
  idle: boolean;
  /** How many minutes the running block could still be extended today. 0 when there is no room. */
  extendRoomMin: number;
  dayOff: boolean;
  dayComplete: boolean;
  wakeMin: number | null;
  afterBed: boolean;
}

export interface MeetingSave {
  id?: string;
  title: string;
  date: string;
  startMin: number;
  endMin: number;
  kind: "online" | "in-person";
  link: string | null;
  place: string | null;
  notes: string;
  attendees: string[];
  repeat: RepeatRule | null;
}

export interface TaskView {
  id: string;
  title: string;
  done: boolean;
  due: { label: string; tone: "danger" | "neutral" } | null;
}

export interface TodayData {
  date: string;
  userName: string;
  hasTemplate: boolean;
  /** "Tomorrow" while the lists show the next day, after bed time. */
  heading: string | null;
  blocks: Array<{ slot: number; name: string; startMin: number; endMin: number; used: number; capacity: number; tasks: TaskView[] }>;
  routine: Array<{ id: string; title: string; startMin: number; endMin: number | null; past: boolean }>;
  meetings: MeetingRow[];
  unscheduled: TaskView[];
  /** With no template: open tasks that are due soon. */
  dueSoon: TaskView[];
  templates: Array<{ id: string; name: string }>;
  stats: { tasks: number; focusMinutes: number };
}

/** What the renderer can call. Implemented in the main process. */
export interface Api {
  appInfo(): Promise<AppInfo>;
  settingsGet(): Promise<Settings>;
  settingsUpdate(patch: z.infer<typeof settingsPatchSchema>): Promise<Settings>;
  onboardingComplete(input: OnboardingInput): Promise<Settings>;
  todayGet(): Promise<TodayData>;
  timerGet(): Promise<TimerView>;
  timerAct(action: TimerAction, target?: TimerTarget): Promise<TimerView>;
  /** Makes the routine item running now last longer, today only. */
  routineExtend(minutes: number): Promise<TimerView>;
  /** Starts the next block now instead of at its planned time. */
  blockStartNow(): Promise<TimerView>;
  /** Makes the running block last longer, today only. */
  blockExtend(minutes: number): Promise<TimerView>;
  /** Leaves an empty block empty. */
  blockIdle(): Promise<TimerView>;
  /** Marks today as a day off, or takes that back. */
  dayOffSet(off: boolean): Promise<TodayData>;
  /** Makes a new template from the usual one, and uses it for today. */
  templateCreate(): Promise<TodayData>;

  // ---- task drawer
  taskGet(id: string): Promise<TaskDetail>;
  taskUpdate(id: string, patch: TaskPatch): Promise<TaskDetail>;
  stepAdd(taskId: string, text: string): Promise<TaskDetail>;
  stepToggle(taskId: string, stepId: string, done: boolean): Promise<TaskDetail>;
  /** Puts the steps in a new order, so the first one is the one to do first. */
  stepsReorder(taskId: string, order: string[]): Promise<TaskDetail>;
  stepUpdate(taskId: string, stepId: string, text: string): Promise<TaskDetail>;
  stepDelete(taskId: string, stepId: string): Promise<TaskDetail>;
  subtaskAdd(parentId: string, title: string): Promise<TaskDetail>;
  subtaskToggle(parentId: string, id: string, done: boolean): Promise<TaskDetail>;
  taskPlace(id: string, date: string | null, slot: number | null): Promise<TaskDetail>;
  /** Makes a task come back on a schedule, or stops it. It must be scheduled first. */
  taskRepeatSet(id: string, rule: RepeatRule | null): Promise<TaskDetail>;
  taskDelete(id: string, subtasks: "delete" | "detach"): Promise<void>;

  // ---- meetings
  meetingGet(id: string, day: string): Promise<MeetingDetail>;
  /** Writes down what was said at the meeting on that day. */
  meetingMinutesSet(id: string, day: string, text: string): Promise<void>;
  /** Meetings from today on, or the ones before, newest first. Optionally narrowed by a search. */
  meetingsList(view: "upcoming" | "past", query: string): Promise<MeetingListItem[]>;
  /** Makes a meeting, or changes one when `id` is given. A repeating meeting changes on every day. */
  meetingSave(input: MeetingSave): Promise<MeetingDetail>;
  /** Removes a meeting, or only the given day of a repeating one. */
  meetingDelete(id: string, onlyDate: string | null): Promise<void>;

  // ---- week
  weekGet(offset: number): Promise<WeekData>;
  dayTemplateSet(date: string, templateId: string | null): Promise<ChangeSummary>;
  dayTemplateUndo(): Promise<void>;

  // ---- templates
  templatesGet(): Promise<TemplatesData>;
  templateNew(): Promise<TemplatesData>;
  templateSave(template: TemplateDetail): Promise<TemplatesData>;
  templateDelete(id: string): Promise<TemplatesData>;

  // ---- projects
  projectsGet(): Promise<ProjectCard[]>;
  projectGet(id: string): Promise<ProjectDetail>;
  projectCreate(project: NewProject): Promise<ProjectCard[]>;
  projectContextSet(id: string, context: string): Promise<ProjectDetail>;
  deliverableAdd(projectId: string, type: "deliverable" | "milestone" | "deadline", title: string): Promise<ProjectDetail>;
  projectTaskAdd(projectId: string, deliverableId: string | null, title: string): Promise<ProjectDetail>;

  // ---- reports and the weekly prompts
  reportsGet(): Promise<ReportSummary[]>;
  reportGet(weekStart: string): Promise<ReportDetail>;
  sessionsGet(): Promise<SessionsData>;
  promptsGet(): Promise<Prompts>;
  planningGet(): Promise<PlanningData>;

  // ---- data safety and the command line
  dataSnapshots(): Promise<SnapshotView[]>;
  dataBackup(): Promise<SnapshotView[]>;
  /** Restores a backup, then restarts the app. */
  dataRestore(name: string): Promise<void>;
  /** Asks where to save, then writes the JSON export. Null when cancelled. */
  dataExport(): Promise<string | null>;
  /** Asks for a file, takes a backup, then replaces everything with it. Null when cancelled. */
  dataImport(): Promise<{ rows: number } | null>;
  updateGet(): Promise<UpdateState>;
  /** Looks for a newer version now. */
  updateCheck(): Promise<UpdateState>;
  /** Restarts into a downloaded update. */
  updateInstall(): Promise<void>;
  cliInfo(): Promise<CliInfo>;
  cliAddToPath(): Promise<CliInfo>;
  /** Shows or hides the always-on-top mini window. Returns whether it is now showing. */
  miniToggle(): Promise<boolean>;
  taskCreate(title: string): Promise<TodayData>;
  taskSetDone(id: string, done: boolean): Promise<TodayData>;
  /** Puts a task in one of today's blocks, or back in Unscheduled when slot is null. */
  taskAssign(id: string, slot: number | null): Promise<TodayData>;
  /** Works on this task now instead of the first one in the block. */
  taskFocus(id: string): Promise<TimerView>;
  /** Uses this template for today and moves today's tasks into its blocks. */
  templateSetToday(id: string): Promise<TodayData>;
}

/** The bridge the window sees: the calls plus a subscription to timer changes. */
export interface Bridge extends Api {
  onTimer(listener: (view: TimerView) => void): () => void;
}
