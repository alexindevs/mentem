import { z } from "zod";
import type * as Core from "@mentem/core";
import type { Slot, Store, TimerEngine, UndoToken } from "@mentem/core";
import { MAX_BLOCKS } from "../shared/pages";
import type { Api, ChangeSummary, MeetingDetail, MeetingListItem, MeetingRow, PlanningData, Prompts, ReportDetail, ReportSummary, SessionsData, ChipTone, ProjectCard, ProjectDetail, ProjectGroup, TaskDetail, TemplateDetail, TemplatesData, WeekData, WeekDay } from "../shared/api";

interface Deps {
  store: Store;
  engine: TimerEngine;
  core: typeof Core;
  refresh(): unknown;
}

const ID = /^[A-Za-z0-9_-]{1,40}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const id = (v: unknown): string => {
  const s = String(v);
  if (!ID.test(s)) throw new Error("Invalid id");
  return s;
};
const date = (v: unknown): string => {
  const s = String(v);
  if (!DATE.test(s)) throw new Error("Invalid date");
  return s;
};
const slotOf = (v: unknown): Slot => {
  if (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= MAX_BLOCKS) return v;
  throw new Error("Invalid block");
};

const patchSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    status: z.enum(["open", "in_progress", "done"]),
    projectId: z.string().regex(ID).nullable(),
    deliverableId: z.string().regex(ID).nullable(),
    due: z.string().regex(DATE).nullable(),
    estimate: z.number().int().min(1).max(99).nullable(),
    notes: z.string().max(5000),
  })
  .partial()
  .strict();

const minutes = z.number().int().min(0).max(24 * 60);
const meetingSchema = z.object({
  id: z.string().regex(ID).optional(),
  title: z.string().trim().min(1).max(120),
  date: z.string().regex(DATE),
  startMin: minutes,
  endMin: minutes,
  kind: z.enum(["online", "in-person"]),
  link: z.string().trim().max(500).nullable(),
  place: z.string().trim().max(200).nullable(),
  notes: z.string().max(5000),
  attendees: z.array(z.string().trim().max(80)).max(30),
  repeat: z.unknown().nullable(),
});
const templateSchema = z.object({
  id: z.string().regex(ID),
  name: z.string().trim().min(1).max(40),
  wakeMin: minutes,
  bedMin: minutes,
  blocks: z.array(z.object({ name: z.string().trim().min(1).max(30), enabled: z.boolean(), startHour: z.number().min(0).max(24).multipleOf(0.25), endHour: z.number().min(0).max(24).multipleOf(0.25) })).max(MAX_BLOCKS + 3),
  routine: z.array(z.object({ id: z.string().regex(ID).optional(), title: z.string().trim().min(1).max(80), startMin: minutes, endMin: minutes.nullable(), repeat: z.object({ rule: z.unknown() }).nullable() })).max(60),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7),
  summary: z.string(),
});

const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DEFAULT_BLOCKS = [
  { name: "Morning", startHour: 9, endHour: 12 },
  { name: "Afternoon", startHour: 13, endHour: 17 },
  { name: "Evening", startHour: 19, endHour: 21 },
];

/** The task drawer, the week, and the templates: everything beyond the Today page. */
type PageApi = Pick<
  Api,
  | "taskGet" | "taskUpdate" | "stepAdd" | "stepToggle" | "stepsReorder" | "stepUpdate" | "stepDelete" | "subtaskAdd" | "subtaskToggle" | "taskPlace" | "taskRepeatSet" | "taskDelete"
  | "meetingGet" | "meetingSave" | "meetingDelete" | "meetingMinutesSet" | "meetingsList"
  | "weekGet" | "dayTemplateSet" | "dayTemplateUndo"
  | "templatesGet" | "templateNew" | "templateSave" | "templateDelete"
  | "projectsGet" | "projectGet" | "projectCreate" | "projectContextSet" | "deliverableAdd" | "projectTaskAdd"
  | "reportsGet" | "reportGet" | "sessionsGet" | "promptsGet" | "planningGet"
>;

export function createPageApi({ store, engine, core, refresh }: Deps): PageApi {
  const today = () => core.dateOf(store.clock.now());
  const local = (d: string) => {
    const [y, m, day] = d.split("-").map(Number);
    return new Date(y ?? 1970, (m ?? 1) - 1, day ?? 1);
  };
  const short = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric" });
  let lastUndo: UndoToken | null = null;

  const meetingDetail = (meetingId: string, day: string): MeetingDetail => {
    const m = store.getMeeting(meetingId);
    if (!m) throw new Error("No such meeting");
    return { id: m.id, title: m.title, date: m.date, startMin: m.startMin, endMin: m.endMin, kind: m.kind, link: m.link, place: m.place, notes: m.notes, attendees: m.attendees, repeat: m.repeat ? { rule: m.repeat, label: core.describeRule(m.repeat) } : null, day, minutes: store.getMinutes(meetingId, day) };
  };
  const meetingRows = (d: string): MeetingRow[] => {
    const nowMs = store.clock.now();
    return store.meetingsOn(d).map((m) => ({ id: m.id, title: m.title, startMin: m.startMin, endMin: m.endMin, hasLink: m.link !== null, past: d < today() || (d === today() && core.instantOf(d, m.endMin) <= nowMs) }));
  };

  // ------------------------------------------------------------------ task
  const detail = (taskId: string): TaskDetail => {
    const task = store.getTask(taskId);
    if (!task) throw new Error("No such task");
    const subtasks: TaskDetail["subtasks"] = [];
    const walk = (parent: string, depth: number) => {
      for (const child of store.childrenOf(parent)) {
        subtasks.push({ id: child.id, title: child.title, done: child.status === "done", depth });
        if (depth < 2) walk(child.id, depth + 1);
      }
    };
    walk(taskId, 1);
    const placed = store.effectiveAssignment(taskId);
    const on = placed?.date ?? today();
    const blocks = store.blocksFor(on).map((b) => ({ slot: b.slot, name: b.name }));
    const running = engine.state();
    return {
      id: task.id,
      title: task.title,
      status: task.status,
      projectId: task.projectId,
      deliverableId: task.deliverableId,
      due: task.dueDate,
      estimate: task.estimatePomodoros,
      notes: task.notes,
      steps: store.listSteps(taskId).map((s) => ({ id: s.id, text: s.text, done: s.done })),
      subtasks,
      assigned: placed ? { date: placed.date, label: short.format(local(placed.date)).replace(",", ""), slot: placed.slot, slotName: blocks.find((b) => b.slot === placed.slot)?.name ?? "" } : null,
      blocks,
      projects: store.listProjects().map((p) => ({ id: p.id, name: p.name, deliverables: store.listDeliverables(p.id).map((d) => ({ id: d.id, title: d.title })) })),
      repeat: (() => {
        const series = task.seriesId ? store.getSeries(task.seriesId) : undefined;
        return series?.active ? { rule: series.rule, label: core.describeRule(series.rule) } : null;
      })(),
      today: today(),
      workable: placed !== undefined && placed.date === today() && running.block?.slot === placed.slot && !!running.block,
    };
  };

  // ------------------------------------------------------------------ week
  const upSummary = (t: ReturnType<Store["getTemplate"]>) => (t ? `Up ${Math.floor(t.wakeMin / 60)}:${String(t.wakeMin % 60).padStart(2, "0")}${t.blocks.length ? ` · ${t.blocks.map((b) => b.name).join(", ")}` : ""}` : "No template");
  const weekLabel = (start: string, end: string) => {
    const a = local(start);
    const b = local(end);
    const month = new Intl.DateTimeFormat("en-GB", { month: "long" });
    return a.getMonth() === b.getMonth() ? `${a.getDate()} – ${b.getDate()} ${month.format(b)}` : `${a.getDate()} ${month.format(a)} – ${b.getDate()} ${month.format(b)}`;
  };

  // ------------------------------------------------------------- templates
  const templateDetail = (templateId: string): TemplateDetail => {
    const t = store.getTemplate(templateId)!;
    const schedule = store.getSchedule();
    const weekdays = Object.entries(schedule).filter(([, tid]) => tid === templateId).map(([d]) => Number(d)).sort((a, b) => a - b);
    const first = weekdays[0];
    const last = weekdays[weekdays.length - 1];
    const summary =
      weekdays.length === 0 ? "Dates only" : weekdays.length > 2 && first !== undefined && last !== undefined && last - first === weekdays.length - 1 ? `${DAY_SHORT[first]} to ${DAY_SHORT[last]}` : weekdays.map((d) => DAY_SHORT[d]).join(", ");
    // The blocks the template has, then the usual three it does not use, switched off, so they can be turned on.
    const blocks = [
      ...t.blocks.map((b) => ({ name: b.name, enabled: true, startHour: b.startHour, endHour: b.endHour })),
      ...DEFAULT_BLOCKS.filter((def) => !t.blocks.some((b) => b.name.toLowerCase() === def.name.toLowerCase())).map((def) => ({ ...def, enabled: false })),
    ];
    return {
      id: t.id,
      name: t.name,
      wakeMin: t.wakeMin,
      bedMin: t.bedMin,
      blocks,
      routine: t.routine.map((r) => ({ id: r.id, title: r.title, startMin: r.startMin, endMin: r.endMin, repeat: r.repeat ? { rule: r.repeat, label: core.describeRule(r.repeat) } : null })),
      weekdays,
      summary,
    };
  };
  // The ones the week actually uses come first.
  const templates = (): TemplatesData => ({ today: today(), templates: store.listTemplates().map((t) => templateDetail(t.id)).sort((a, b) => b.weekdays.length - a.weekdays.length || a.name.localeCompare(b.name)) });

  // -------------------------------------------------------------- projects
  const projectTasks = (projectId: string) => store.listTasks({ projectId, parentId: null });
  const countOf = (projectId: string) => {
    const tasks = projectTasks(projectId);
    return { done: tasks.filter((t) => t.status === "done").length, total: tasks.length };
  };
  /** "in 3 days", red when it is close. */
  const dueIn = (due: string | null): { label: string; tone: ChipTone } | null => {
    if (!due) return null;
    const days = core.daysBetween(today(), due);
    if (days < 0) return { label: "overdue", tone: "danger" };
    return { label: days === 0 ? "today" : `in ${days} ${days === 1 ? "day" : "days"}`, tone: days <= 3 ? "danger" : days <= 14 ? "neutral" : "accent" };
  };
  const card = (p: { id: string; name: string; description: string }): ProjectCard => {
    const next = store.listDeliverables(p.id).filter((d) => d.status === "open" && d.dueDate !== null).sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""))[0];
    const when = next ? dueIn(next.dueDate) : null;
    return { id: p.id, name: p.name, description: p.description, ...countOf(p.id), chip: next && when ? { label: `${next.title} ${when.label}`, tone: when.tone } : null };
  };
  const projectDetail = (projectId: string): ProjectDetail => {
    const p = store.listProjects().find((x) => x.id === projectId);
    if (!p) throw new Error("No such project");
    const now = today();
    const tasks = projectTasks(projectId);
    const row = (t: (typeof tasks)[number]) => ({
      id: t.id,
      title: t.title,
      done: t.status === "done",
      due: t.dueDate && t.status !== "done" ? (core.daysBetween(now, t.dueDate) <= 0 ? ({ label: core.daysBetween(now, t.dueDate) < 0 ? "Overdue" : "Due today", tone: "danger" } as const) : ({ label: `${core.daysBetween(now, t.dueDate)} days left`, tone: "neutral" } as const)) : null,
    });
    const groups: ProjectGroup[] = store.listDeliverables(projectId).map((d) => ({ id: d.id, type: d.type, title: d.title, due: dueIn(d.dueDate), tasks: tasks.filter((t) => t.deliverableId === d.id).map(row) }));
    const loose = tasks.filter((t) => !t.deliverableId || !groups.some((g) => g.id === t.deliverableId));
    if (loose.length) groups.push({ id: null, type: null, title: "Other tasks", due: null, tasks: loose.map(row) });
    return { id: p.id, name: p.name, context: p.context, ...countOf(projectId), groups };
  };

  // --------------------------------------------------------------- reports
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const part = (d: string) => ({ day: Number(d.slice(8)), month: Number(d.slice(5, 7)) - 1 });
  const range = (start: string, end: string, names: string[]) => {
    const a = part(start);
    const b = part(end);
    return a.month === b.month ? `${a.day} – ${b.day} ${names[b.month]}` : `${a.day} ${names[a.month]} – ${b.day} ${names[b.month]}`;
  };
  const dayName = (d: string) => DAY_SHORT[core.weekdayOf(d)] ?? "";
  const clock = (minute: number) => `${Math.floor(minute / 60) % 12 || 12}:${String(minute % 60).padStart(2, "0")}`;

  const api: PageApi = {
    async reportsGet() {
      const settings = store.getSettings();
      const earliest = (store.db.prepare("SELECT MIN(to_date) AS d FROM assignment_event").get() as { d: string | null }).d;
      if (!earliest) return [];
      const out: ReportSummary[] = [];
      let start = core.weekStart(today(), settings.weekEndDay);
      for (let i = 0; i < 52 && start >= core.weekStart(earliest, settings.weekEndDay); i += 1) {
        const r = core.weeklyReport(store, start);
        if (r.planned > 0) out.push({ weekStart: start, label: range(start, r.weekEnd, MONTHS), planned: r.planned, done: r.done, onTimePct: r.onTimePct, level: r.procrastination.level, change: r.procrastination.change });
        start = core.addDays(start, -7);
      }
      return out;
    },

    async reportGet(raw) {
      const start = date(raw);
      const r = core.weeklyReport(store, start);
      const label = (t: { move: { from: string; to: string } | null }) => (t.move ? `${dayName(t.move.from)} → ${dayName(t.move.to)}` : null);
      const list = (tasks: typeof r.lists.planned) => tasks.map((t) => ({ id: t.id, title: t.title, done: t.done, move: label(t) }));
      const detail: ReportDetail = {
        weekStart: start,
        label: range(start, r.weekEnd, LONG),
        inProgress: r.inProgress,
        onTimePct: r.onTimePct,
        onTimeCount: r.onTimeCount,
        planned: r.planned,
        done: r.done,
        unfinished: r.unfinished,
        rescheduled: r.rescheduled,
        procrastination: { level: r.procrastination.level, change: r.procrastination.change, previousPct: r.procrastination.previousPct },
        mostRescheduled: r.mostRescheduled,
        bestTime: r.bestTime ? { label: `${["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][r.bestTime.weekday]} ${r.bestTime.block.toLowerCase()}`, onTime: r.bestTime.onTime, total: r.bestTime.total } : null,
        streak: r.streak,
        lists: { planned: list(r.lists.planned), done: list(r.lists.done), rescheduled: list(r.lists.rescheduled), unfinished: list(r.lists.unfinished) },
      };
      return detail;
    },

    async sessionsGet() {
      const now = today();
      const since = core.instantOf(core.addDays(now, -13), 0);
      const rows = store.db
        .prepare("SELECT s.start_at AS startAt, s.end_at AS endAt, s.type AS type, t.title AS title FROM session s LEFT JOIN task t ON t.id = s.task_id WHERE s.start_at >= ? ORDER BY s.start_at")
        .all(since) as Array<{ startAt: number; endAt: number; type: "work" | "break"; title: string | null }>;
      const byDay = new Map<string, SessionsData["days"][number]["rows"]>();
      for (const r of rows) {
        const d = core.dateOf(r.startAt);
        const list = byDay.get(d) ?? [];
        const a = core.minutesOfDay(r.startAt);
        const b = core.minutesOfDay(r.endAt);
        list.push({ time: `${clock(a)} – ${clock(b)}`, title: r.type === "work" ? r.title : null, kind: r.type, minutes: Math.max(1, Math.round((r.endAt - r.startAt) / 60_000)) });
        byDay.set(d, list);
      }
      const label = (d: string) => (d === now ? "Today" : d === core.addDays(now, -1) ? "Yesterday" : `${dayName(d)} ${part(d).day} ${MONTHS[part(d).month]}`);
      const todays = byDay.get(now) ?? [];
      const dayStart = core.instantOf(now, 0);
      const doneToday = store.db.prepare("SELECT COUNT(*) AS n FROM task WHERE status = 'done' AND completed_at >= ? AND completed_at < ?").get(dayStart, dayStart + 86_400_000) as { n: number };
      const data: SessionsData = {
        focusMinutes: todays.filter((r) => r.kind === "work").reduce((sum, r) => sum + r.minutes, 0),
        pomodoros: todays.filter((r) => r.kind === "work").length,
        tasksDone: doneToday.n,
        days: [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([d, list]) => ({ label: label(d), rows: list })),
      };
      return data;
    },

    async promptsGet() {
      const settings = store.getSettings();
      const none: Prompts = { report: null, planning: null };
      if (!settings.weekPopupsEnabled || !settings.setupCompleted) return none;
      const now = today();
      const start = core.weekStart(now, settings.weekEndDay);
      const minute = core.minutesOfDay(store.clock.now());
      // On the last day of the week, the report is due once the last block has finished (5 PM when there are none).
      const lastBlockEnd = Math.max(0, ...store.blocksFor(now).map((b) => b.endMin)) || 17 * 60;
      const endOfWeek = core.weekdayOf(now) === settings.weekEndDay && minute >= lastBlockEnd;
      const reportStart = endOfWeek ? start : core.addDays(start, -7);
      const reportable = core.weeklyReport(store, reportStart, 1).planned > 0;
      // A week that already has work placed in it has been planned: do not ask again.
      const planned = (store.db.prepare("SELECT COUNT(*) AS n FROM assignment WHERE date >= ? AND date <= ?").get(start, core.addDays(start, 6)) as { n: number }).n > 0;
      return {
        report: reportable ? { weekStart: reportStart, label: range(reportStart, core.addDays(reportStart, 6), LONG) } : null,
        planning: planned ? null : { weekStart: start, label: range(start, core.addDays(start, 6), LONG) },
      };
    },

    async planningGet() {
      const settings = store.getSettings();
      const start = core.weekStart(today(), settings.weekEndDay);
      const prevLo = core.instantOf(core.addDays(start, -7), 0);
      const prevHi = core.instantOf(start, 0);
      const back = new Set((store.db.prepare("SELECT DISTINCT task_id AS id FROM assignment_event WHERE kind = 'unassigned' AND reason = 'rollover' AND at >= ? AND at < ?").all(prevLo, prevHi) as Array<{ id: string }>).map((r) => r.id));
      const week = await api.weekGet(0);
      const data: PlanningData = { week, lastWeek: week.unscheduled.filter((t) => back.has(t.id)).map((t) => t.id) };
      return data;
    },

    async projectsGet() {
      return store.listProjects().map(card);
    },

    async projectGet(raw) {
      return projectDetail(id(raw));
    },

    async projectCreate(raw) {
      const input = z
        .object({
          name: z.string().trim().min(1).max(60),
          description: z.string().trim().max(200),
          context: z.string().max(2000),
          deliverables: z.array(z.object({ type: z.enum(["deliverable", "milestone", "deadline"]), title: z.string().trim().min(1).max(80) })).max(20),
        })
        .parse(raw);
      store.transaction(() => {
        const project = store.createProject({ name: input.name, description: input.description, context: input.context });
        for (const d of input.deliverables) store.addDeliverable(project.id, { title: d.title, type: d.type });
      });
      return store.listProjects().map(card);
    },

    async projectContextSet(raw, context) {
      const projectId = id(raw);
      store.db.prepare("UPDATE project SET context = ? WHERE id = ?").run(String(context).slice(0, 2000), projectId);
      return projectDetail(projectId);
    },

    async deliverableAdd(raw, type, title) {
      const projectId = id(raw);
      const clean = String(title).trim();
      if (!clean || clean.length > 80 || !["deliverable", "milestone", "deadline"].includes(type)) throw new Error("Invalid deliverable");
      store.addDeliverable(projectId, { title: clean, type });
      return projectDetail(projectId);
    },

    async projectTaskAdd(raw, rawDeliverable, title) {
      const projectId = id(raw);
      const clean = String(title).trim();
      if (!clean || clean.length > 160) throw new Error("Invalid title");
      store.createTask({ title: clean, projectId, deliverableId: rawDeliverable === null ? null : id(rawDeliverable) });
      refresh();
      return projectDetail(projectId);
    },

    async taskGet(raw) {
      return detail(id(raw));
    },

    async taskUpdate(raw, rawPatch) {
      const taskId = id(raw);
      const patch = patchSchema.parse(rawPatch);
      store.transaction(() => {
        if (patch.status) store.setStatus(taskId, patch.status);
        const rest: Parameters<Store["updateTask"]>[1] = {};
        if (patch.title !== undefined) rest.title = patch.title;
        if (patch.notes !== undefined) rest.notes = patch.notes;
        if (patch.projectId !== undefined) rest.projectId = patch.projectId;
        if (patch.deliverableId !== undefined) rest.deliverableId = patch.deliverableId;
        if (patch.due !== undefined) rest.dueDate = patch.due;
        if (patch.estimate !== undefined) rest.estimatePomodoros = patch.estimate;
        if (Object.keys(rest).length) store.updateTask(taskId, rest);
      });
      refresh();
      return detail(taskId);
    },

    async stepAdd(raw, text) {
      const taskId = id(raw);
      const clean = String(text).trim();
      if (!clean || clean.length > 200) throw new Error("Invalid step");
      store.addStep(taskId, clean);
      refresh();
      return detail(taskId);
    },

    async stepToggle(raw, stepId, done) {
      store.setStepDone(id(stepId), done === true);
      refresh();
      return detail(id(raw));
    },

    async stepUpdate(raw, stepId, text) {
      store.updateStep(id(stepId), String(text));
      refresh();
      return detail(id(raw));
    },

    async stepDelete(raw, stepId) {
      store.removeStep(id(stepId));
      refresh();
      return detail(id(raw));
    },

    async stepsReorder(raw, order) {
      const taskId = id(raw);
      store.reorderSteps(taskId, z.array(z.string().regex(ID)).max(200).parse(order));
      refresh();
      return detail(taskId);
    },

    async subtaskAdd(raw, title) {
      const parentId = id(raw);
      const clean = String(title).trim();
      if (!clean || clean.length > 160) throw new Error("Invalid title");
      store.createTask({ title: clean, parentId });
      refresh();
      return detail(parentId);
    },

    async subtaskToggle(raw, childId, done) {
      store.setStatus(id(childId), done === true ? "done" : "open");
      refresh();
      return detail(id(raw));
    },

    async taskPlace(raw, rawDate, rawSlot) {
      const taskId = id(raw);
      if (rawDate === null || rawSlot === null) store.unassign(taskId);
      else {
        const target = date(rawDate);
        if (target < today()) throw new Error("That day has passed");
        store.assign(taskId, { date: target, slot: slotOf(rawSlot) });
      }
      refresh();
      return detail(taskId);
    },

    async taskRepeatSet(raw, rawRule) {
      const taskId = id(raw);
      const task = store.getTask(taskId);
      if (!task) throw new Error("No such task");
      if (rawRule === null) {
        if (task.seriesId) store.endSeries(task.seriesId);
      } else {
        const rule = core.parseRule(rawRule);
        const placed = store.getAssignment(taskId);
        if (!placed) throw new Error("Schedule the task first");
        store.startSeries(taskId, placed.slot, rule);
        core.materializeRepeats(store);
      }
      refresh();
      return detail(taskId);
    },

    async taskDelete(raw, mode) {
      store.deleteTask(id(raw), mode === "detach" ? "detach" : "delete");
      refresh();
    },

    async meetingGet(raw, rawDay) {
      return meetingDetail(id(raw), date(rawDay));
    },

    async meetingMinutesSet(raw, rawDay, text) {
      store.setMinutes(id(raw), date(rawDay), String(text));
    },

    async meetingsList(view, rawQuery) {
      const query = String(rawQuery ?? "").trim().toLowerCase().slice(0, 80);
      const nowMs = store.clock.now();
      const day = today();
      const upcoming = view === "upcoming";
      const from = upcoming ? day : core.addDays(day, -120);
      const to = upcoming ? core.addDays(day, 120) : day;
      const ended = (m: { date: string; endMin: number }) => m.date < day || (m.date === day && core.instantOf(m.date, m.endMin) <= nowMs);
      const withMinutes = store.minutesDays(from, to);
      const rows = store
        .meetingsBetween(from, to)
        .filter((m) => (upcoming ? !ended(m) : ended(m)))
        .filter((m) => !query || [m.title, m.place ?? "", ...m.attendees].some((s) => s.toLowerCase().includes(query)))
        .map((m): MeetingListItem => {
          const has = withMinutes.has(`${m.id}:${m.date}`);
          return { id: m.id, date: m.date, title: m.title, startMin: m.startMin, endMin: m.endMin, kind: m.kind, place: m.place, people: m.attendees.length, hasMinutes: has, repeatLabel: m.repeat ? core.describeRule(m.repeat) : null, needsMinutes: ended(m) && !has };
        });
      return (upcoming ? rows : rows.reverse()).slice(0, 300);
    },

    async meetingSave(raw) {
      const input = meetingSchema.parse(raw);
      const fields = { title: input.title, date: input.date, startMin: input.startMin, endMin: input.endMin, kind: input.kind, link: input.link, place: input.place, notes: input.notes, attendees: input.attendees, repeat: input.repeat ? core.parseRule(input.repeat) : null };
      if (input.id && !store.getMeeting(input.id)) throw new Error("No such meeting");
      const saved = input.id ? store.updateMeeting(input.id, fields) : store.createMeeting(fields);
      refresh();
      return meetingDetail(saved.id, input.date);
    },

    async meetingDelete(raw, rawDate) {
      store.deleteMeeting(id(raw), rawDate === null ? undefined : date(rawDate));
      refresh();
    },

    async weekGet(offset) {
      const settings = store.getSettings();
      const now = today();
      const start = core.addDays(core.weekStart(now, settings.weekEndDay), Math.trunc(Number(offset) || 0) * 7);
      const running = engine.state();
      const days: WeekDay[] = Array.from({ length: 7 }, (_, i) => {
        const d = core.addDays(start, i);
        const tid = store.templateIdFor(d);
        const names = short.formatToParts(local(d));
        return {
          date: d,
          weekday: names.find((p) => p.type === "weekday")?.value ?? "",
          day: local(d).getDate(),
          isToday: d === now,
          past: d < now,
          isWeekEnd: core.weekdayOf(d) === settings.weekEndDay,
          template: tid ? (store.getTemplate(tid)?.name ?? null) : null,
          templateId: tid,
          summary: tid ? upSummary(store.getTemplate(tid)) : "No template",
          meetings: meetingRows(d),
          blocks: store.blocksFor(d).map((b) => ({
            slot: b.slot,
            name: b.name,
            startMin: b.startMin,
            endMin: b.endMin,
            tasks: store.blockTasks(d, b.slot, true).map((t) => ({ id: t.id, title: t.title, done: t.status === "done", overdue: t.status !== "done" && t.dueDate !== null && t.dueDate < d, current: running.task?.id === t.id })),
          })),
        };
      });
      const data: WeekData = {
        label: weekLabel(start, core.addDays(start, 6)),
        days,
        unscheduled: store.listTasks({ unscheduled: true }).map((t) => ({ id: t.id, title: t.title })),
        templates: store.listTemplates().map((t) => ({ id: t.id, name: t.name })),
      };
      return data;
    },

    async dayTemplateSet(rawDate, rawTemplate) {
      const d = date(rawDate);
      const tid = rawTemplate === null ? null : id(rawTemplate);
      if (tid && !store.getTemplate(tid)) throw new Error("No such template");
      store.setDayOff(d, false);
      const result = core.changeDateTemplate(store, d, tid);
      lastUndo = result.undo;
      refresh();
      const summary: ChangeSummary = { moved: result.moved.length, canUndo: true };
      return summary;
    },

    async dayTemplateUndo() {
      if (!lastUndo) return;
      core.undoTemplateChange(store, lastUndo);
      lastUndo = null;
      refresh();
    },

    async templatesGet() {
      return templates();
    },

    async templateNew() {
      const source = store.listTemplates()[0];
      const names = new Set(store.listTemplates().map((t) => t.name));
      let name = "New template";
      for (let n = 2; names.has(name); n += 1) name = `New template ${n}`;
      store.transaction(() => {
        const made = store.createTemplate({ name, wakeMin: source?.wakeMin, bedMin: source?.bedMin, blocks: source?.blocks ?? [] });
        for (const item of source?.routine ?? []) store.addRoutineItem(made.id, { title: item.title, startMin: item.startMin, endMin: item.endMin, repeat: item.repeat });
      });
      return templates();
    },

    async templateSave(raw) {
      const input = templateSchema.parse(raw);
      const current = store.getTemplate(input.id);
      if (!current) throw new Error("No such template");
      if (input.bedMin <= input.wakeMin) throw new Error("Bed time must be after wake time");
      store.transaction(() => {
        store.updateTemplate(input.id, { name: input.name, wakeMin: input.wakeMin, bedMin: input.bedMin });
        const blocks = input.blocks.filter((b) => b.enabled).sort((a, b) => a.startHour - b.startHour).map((b, index) => ({ slot: index + 1, name: b.name, startHour: b.startHour, endHour: b.endHour }));
        store.applyBlocks(input.id, blocks, today());
        const keep = new Set(input.routine.flatMap((r) => (r.id ? [r.id] : [])));
        for (const old of current.routine) if (!keep.has(old.id)) store.removeRoutineItem(old.id);
        for (const item of input.routine) {
          const repeat = item.repeat ? core.parseRule(item.repeat.rule) : null;
          if (item.id && current.routine.some((r) => r.id === item.id)) store.updateRoutineItem(item.id, { title: item.title, startMin: item.startMin, endMin: item.endMin, repeat });
          else store.addRoutineItem(input.id, { title: item.title, startMin: item.startMin, endMin: item.endMin, repeat });
        }
        const before = Object.entries(store.getSchedule()).filter(([, tid]) => tid === input.id).map(([d]) => Number(d));
        for (const d of before) if (!input.weekdays.includes(d)) store.clearSchedule(d);
        if (input.weekdays.length) store.setSchedule(input.weekdays, input.id);
      });
      refresh();
      return templates();
    },

    async templateDelete(raw) {
      const tid = id(raw);
      store.transaction(() => {
        for (const [d, used] of Object.entries(store.getSchedule())) if (used === tid) store.clearSchedule(Number(d));
        store.deleteTemplate(tid);
      });
      refresh();
      return templates();
    },
  };
  return api;
}
