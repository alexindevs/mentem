import type * as Core from "@mentem/core";
import type { Slot, Store, Task, TimerEngine } from "@mentem/core";
import {
  type Api,
  type AppInfo,
  type TaskView,
  type TimerView,
  type TodayData,
  onboardingSchema,
  settingsPatchSchema,
  timerActionSchema,
  timerTargetSchema,
} from "../shared/api";
import { createDataApi, type Host } from "./data";
import { createPageApi } from "./pages";
import { MAX_BLOCKS } from "../shared/pages";
import { toView } from "./timer";

interface Deps {
  store: Store;
  engine: TimerEngine;
  core: typeof Core;
  info: AppInfo;
  /** Recompute the timer and tell the window. */
  refresh(): TimerView;
  host: Host;
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const slotOf = (value: unknown): Slot | null => {
  if (value === null) return null;
  if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_BLOCKS) return value;
  throw new Error("Invalid block");
};

const idOf = (value: unknown): string => {
  const id = String(value);
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) throw new Error("Invalid id");
  return id;
};

/** Implements the calls the window may make. Everything arriving here is validated first. */
export function createApi({ store, engine, core, info, refresh, host }: Deps): Api {
  const today = () => core.dateOf(store.clock.now());

  /** "Due today", "Due tomorrow", "Due Friday" within a week, otherwise "12 days left". */
  const dueOf = (task: Task, date: string): TaskView["due"] => {
    if (!task.dueDate || task.status === "done") return null;
    const days = core.daysBetween(date, task.dueDate);
    if (days < 0) return { label: "Overdue", tone: "danger" };
    if (days === 0) return { label: "Due today", tone: "danger" };
    if (days === 1) return { label: "Due tomorrow", tone: "neutral" };
    if (days <= 7) return { label: `Due ${WEEKDAYS[core.weekdayOf(task.dueDate)]}`, tone: "neutral" };
    return { label: `${days} days left`, tone: "neutral" };
  };

  const view = (task: Task, date: string): TaskView => ({ id: task.id, title: task.title, done: task.status === "done", due: dueOf(task, date) });

  const readToday = (): TodayData => {
    const date = today();
    const settings = store.getSettings();
    const templateId = store.templateIdFor(date);
    const template = templateId ? store.getTemplate(templateId) : undefined;
    const now = store.clock.now();
    const minute = core.minutesOfDay(now);
    // After bed time the lists look ahead to tomorrow.
    const after = template !== undefined && minute >= template.bedMin;
    const listDate = after ? core.addDays(date, 1) : date;
    const hasTemplate = store.templateIdFor(listDate) !== null || template !== undefined;
    const cfg = {
      pomodoroMinutes: settings.pomodoroMinutes,
      shortBreakMinutes: settings.shortBreakMinutes,
      longBreakMinutes: settings.longBreakMinutes,
      cyclesBeforeLongBreak: settings.cyclesBeforeLongBreak,
    };

    const dayStart = core.instantOf(date, 0);
    const focus = store.db
      .prepare("SELECT COALESCE(SUM(end_at - start_at), 0) AS ms FROM session WHERE type = 'work' AND start_at >= ? AND start_at < ?")
      .get(dayStart, dayStart + 24 * 60 * 60_000) as { ms: number };
    const doneToday = store.db
      .prepare("SELECT COUNT(*) AS n FROM task WHERE status = 'done' AND completed_at >= ? AND completed_at < ?")
      .get(dayStart, dayStart + 24 * 60 * 60_000) as { n: number };

    const unscheduled = store.listTasks({ unscheduled: true });
    const dueLimit = core.addDays(date, 3);
    const scheduledIds = new Set(unscheduled.map((t) => t.id));

    return {
      date,
      userName: settings.userName,
      hasTemplate,
      heading: after ? "Tomorrow" : null,
      blocks: store.blocksFor(listDate).map((block) => {
        const tasks = store.blockTasks(listDate, block.slot, true);
        return {
          slot: block.slot,
          name: block.name,
          startMin: block.startMin,
          endMin: block.endMin,
          used: tasks.reduce((sum, t) => sum + (t.estimatePomodoros ?? 1), 0),
          capacity: core.blockCapacity(block.startMin / 60, block.endMin / 60, cfg),
          tasks: tasks.map((t) => view(t, date)),
        };
      }),
      routine: store.routineFor(listDate).map((item) => ({
        id: item.id,
        title: item.title,
        startMin: item.startMin,
        endMin: item.endMin,
        past: !after && (item.endMin ?? item.startMin) <= minute,
      })),
      meetings: store.meetingsOn(listDate).map((m) => ({ id: m.id, title: m.title, startMin: m.startMin, endMin: m.endMin, hasLink: m.link !== null, past: !after && m.endMin <= minute })),
      unscheduled: unscheduled.map((t) => view(t, date)),
      dueSoon: hasTemplate
        ? []
        : store
            .listTasks({ status: "open" })
            .filter((t) => t.dueDate !== null && t.dueDate <= dueLimit && !scheduledIds.has(t.id))
            .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""))
            .map((t) => view(t, date)),
      templates: store
        .listTemplates()
        .map((t) => ({ id: t.id, name: t.name, days: Array.from({ length: 7 }, (_, i) => store.templateIdFor(core.addDays(date, i))).filter((id) => id === t.id).length }))
        // The ones the week actually uses come first.
        .sort((a, b) => b.days - a.days || a.name.localeCompare(b.name))
        .map(({ id, name }) => ({ id, name })),
      stats: { tasks: doneToday.n, focusMinutes: Math.round(focus.ms / 60_000) },
    };
  };

  const timer = () => toView(engine.state(), store, core);

  const pages = createPageApi({ store, engine, core, refresh });
  const data = createDataApi(store, core, host);

  return {
    ...pages,
    ...data,
    async appInfo() {
      return info;
    },

    async settingsGet() {
      return store.getSettings();
    },

    async settingsUpdate(patch) {
      const settings = store.updateSettings(settingsPatchSchema.parse(patch));
      refresh();
      return settings;
    },

    async onboardingComplete(raw) {
      const input = onboardingSchema.parse(raw);
      store.transaction(() => {
        store.updateSettings({
          userName: input.userName,
          appName: input.appName,
          cliName: input.cliName,
          workStyle: input.workStyle,
          weekEndDay: input.weekEndDay,
          pomodoroMinutes: input.pomodoro.focus,
          shortBreakMinutes: input.pomodoro.short,
          longBreakMinutes: input.pomodoro.long,
          cyclesBeforeLongBreak: input.pomodoro.cycles,
          soundEnabled: input.alerts.sound,
          notificationsEnabled: input.alerts.notifications,
          keepRunningInTray: input.alerts.tray,
          startOnLogin: input.alerts.startOnLogin,
          weekPopupsEnabled: input.alerts.weekPopups,
          theme: input.theme,
          matchSystem: input.matchSystem,
          setupCompleted: true,
          setupStep: 0,
        });
        const template = store.createTemplate({
          name: input.templateName,
          wakeMin: input.wakeMin,
          bedMin: input.bedMin,
          blocks: input.blocks.map((block, index) => ({ slot: (index + 1) as Slot, ...block })),
        });
        store.addRoutineItem(template.id, { title: "Wake up", startMin: input.wakeMin });
        for (const item of input.routine) store.addRoutineItem(template.id, item);
        store.setSchedule(input.weekdays, template.id);
      });
      refresh();
      return store.getSettings();
    },

    async todayGet() {
      return readToday();
    },

    async timerGet() {
      return timer();
    },

    async timerAct(raw, rawTarget) {
      const action = timerActionSchema.parse(raw);
      const target = timerTargetSchema.parse(rawTarget ?? "block");
      if (target === "routine") {
        if (action === "pause") engine.pauseRoutine();
        else if (action === "resume") engine.resumeRoutine();
        else if (action === "skip") engine.skipRoutine();
      } else if (action === "pause") engine.pause();
      else if (action === "resume") engine.resume();
      else if (action === "skip") engine.skip();
      else engine.done();
      return refresh();
    },

    async routineExtend(raw) {
      const minutes = Number(raw);
      if (![5, 10, 15, 30].includes(minutes)) throw new Error("Invalid length");
      engine.extendRoutine(minutes);
      return refresh();
    },

    async blockExtend(raw) {
      const minutes = Number(raw);
      if (!Number.isInteger(minutes) || minutes < 5 || minutes > 120) throw new Error("Invalid length");
      engine.extendBlock(minutes);
      return refresh();
    },

    async blockStartNow() {
      engine.startNow();
      return refresh();
    },

    async blockIdle() {
      engine.idle();
      return refresh();
    },

    async dayOffSet(off) {
      store.setDayOff(today(), off === true);
      refresh();
      return readToday();
    },

    async templateCreate() {
      const source = store.listTemplates().find((t) => t.id === store.templateIdFor(core.addDays(today(), -core.weekdayOf(today())))) ?? store.listTemplates()[0];
      const names = new Set(store.listTemplates().map((t) => t.name));
      let name = "New template";
      for (let n = 2; names.has(name); n += 1) name = `New template ${n}`;
      store.transaction(() => {
        const made = store.createTemplate({ name, wakeMin: source?.wakeMin, bedMin: source?.bedMin, blocks: source?.blocks ?? [] });
        for (const item of source?.routine ?? []) store.addRoutineItem(made.id, { title: item.title, startMin: item.startMin, endMin: item.endMin, repeat: item.repeat });
        store.setDayOff(today(), false);
        core.changeDateTemplate(store, today(), made.id);
      });
      refresh();
      return readToday();
    },

    async taskCreate(raw) {
      const title = String(raw).trim();
      if (!title || title.length > 160) throw new Error("Invalid task title");
      store.createTask({ title });
      refresh();
      return readToday();
    },

    async taskSetDone(id, done) {
      store.setStatus(idOf(id), done ? "done" : "open");
      refresh();
      return readToday();
    },

    async taskAssign(id, rawSlot) {
      const taskId = idOf(id);
      const slot = slotOf(rawSlot);
      if (slot === null) store.unassign(taskId);
      else store.assign(taskId, { date: today(), slot });
      refresh();
      return readToday();
    },

    async taskFocus(id) {
      engine.switchTask(idOf(id));
      return refresh();
    },

    async templateSetToday(id) {
      const templateId = idOf(id);
      if (!store.getTemplate(templateId)) throw new Error("No such template");
      store.setDayOff(today(), false);
      core.changeDateTemplate(store, today(), templateId);
      refresh();
      return readToday();
    },
  };
}
