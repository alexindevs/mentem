import * as core from "@mentem/core";
import type { LocalDate, Meeting, RepeatRule, Slot, Store, Task, TimerEngine } from "@mentem/core";
import { type Parsed, flag, flagAll, has, parseArgs } from "./args";
import type { ControlCommand } from "./control";

export interface Context {
  store: Store;
  engine: TimerEngine;
  /** Where snapshots live, and the database file, for backup and restore. */
  backups: string;
  dbPath: string;
  /** Sends a timer command to the running app. Rejects when the app is not running. */
  control(command: ControlCommand): Promise<string>;
  /** File access for export and import, injected so tests need no disk. */
  readFile(path: string): string;
  writeFile(path: string, text: string): void;
}

export interface Result {
  code: number;
  out: string;
}

/** A user mistake: shown as a message, not a stack trace. */
class Usage extends Error {}
const ok = (...lines: string[]): Result => ({ code: 0, out: lines.join("\n") });

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

// ------------------------------------------------------------------ helpers

function day(text: string, today: LocalDate): LocalDate {
  const t = text.trim().toLowerCase();
  if (t === "today") return today;
  if (t === "tomorrow") return core.addDays(today, 1);
  if (t === "yesterday") return core.addDays(today, -1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const weekday = DAYS.indexOf(t.slice(0, 3));
  if (weekday !== -1 && t.length <= 9) {
    const ahead = (weekday - core.weekdayOf(today) + 7) % 7;
    return core.addDays(today, ahead === 0 ? 7 : ahead);
  }
  throw new Usage(`I can't read "${text}" as a date. Use 2026-11-16, today, tomorrow, or a weekday.`);
}

function days(text: string): number[] {
  const out = new Set<number>();
  for (const part of text.toLowerCase().split(",")) {
    const [a, b] = part.split("-").map((x) => DAYS.indexOf(x.trim().slice(0, 3)));
    if (a === undefined || a === -1) throw new Usage(`"${part}" is not a day. Use mon, tue, … or a range like mon-fri.`);
    if (b === undefined) out.add(a);
    else if (b === -1) throw new Usage(`"${part}" is not a day range.`);
    else for (let d = a; ; d = (d + 1) % 7) { out.add(d); if (d === b) break; }
  }
  return [...out].sort((x, y) => x - y);
}

function task(store: Store, ref: string | undefined): Task {
  if (!ref) throw new Usage("Which task? Give its id.");
  const exact = store.getTask(ref);
  if (exact) return exact;
  const matches = store.listTasks().filter((t) => t.id.startsWith(ref));
  if (matches.length === 1) return matches[0]!;
  throw new Usage(matches.length ? `"${ref}" matches more than one task. Use more of the id.` : `No task with id "${ref}".`);
}

function project(store: Store, name: string | undefined) {
  if (!name) throw new Usage("Which project? Give its name.");
  const found = store.listProjects().find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (!found) throw new Usage(`No project called "${name}".`);
  return found;
}

function template(store: Store, name: string | undefined) {
  if (!name) throw new Usage("Which template? Give its name.");
  const found = store.listTemplates().find((t) => t.name.toLowerCase() === name.toLowerCase());
  if (!found) throw new Usage(`No template called "${name}".`);
  return found;
}

function slotOf(store: Store, date: LocalDate, name: string | undefined): Slot {
  const blocks = store.blocksFor(date);
  if (blocks.length === 0) throw new Usage(`${date} has no work blocks.`);
  const found = blocks.find((b) => b.name.toLowerCase() === (name ?? "").toLowerCase());
  if (!found) throw new Usage(`${date} has no block called "${name ?? ""}". It has: ${blocks.map((b) => b.name).join(", ")}.`);
  return found.slot;
}

const hhmm = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;
const mark = (t: Task) => (t.status === "done" ? "[x]" : t.status === "in_progress" ? "[~]" : "[ ]");
const line = (t: Task) => `${mark(t)} ${t.id}  ${t.title}${t.dueDate ? `  (due ${t.dueDate})` : ""}`;

function repeatRule(p: Parsed, anchor: LocalDate): RepeatRule | null {
  const kind = flag(p, "repeat");
  if (!kind) return null;
  const every = flag(p, "every") ? Number(flag(p, "every")) : has(p, "every-other") ? 2 : 1;
  if (!Number.isInteger(every) || every < 1 || every > 99) throw new Usage("--every takes a whole number from 1 to 99.");
  if (kind === "daily") return { interval: every, unit: "day", anchor };
  if (kind === "weekly") return { interval: every, unit: "week", anchor, weekdays: flag(p, "days") ? days(flag(p, "days")!) : [core.weekdayOf(anchor)] };
  if (kind === "monthly") return { interval: every, unit: "month", anchor, monthDay: Number(flag(p, "day") ?? anchor.slice(8)) };
  if (kind === "yearly") {
    const [m, d] = (flag(p, "on") ?? anchor.slice(5)).split("-").map(Number);
    return { interval: every, unit: "year", anchor, yearMonth: m, yearDay: d };
  }
  throw new Usage(`--repeat takes daily, weekly, monthly or yearly, not "${kind}".`);
}

// ----------------------------------------------------------------- commands

function today(ctx: Context): Result {
  const { store } = ctx;
  const date = core.dateOf(store.clock.now());
  const blocks = store.blocksFor(date);
  if (!store.templateIdFor(date)) return ok(`${date}: no template for today.`);
  const out: string[] = [date];
  const entries = [
    ...store.routineFor(date).map((r) => ({ at: r.startMin, text: `  ${hhmm(r.startMin)}${r.endMin !== null ? `-${hhmm(r.endMin)}` : ""}  ${r.title}` })),
    ...store.meetingsOn(date).map((m) => ({ at: m.startMin, text: `  ${hhmm(m.startMin)}-${hhmm(m.endMin)}  Meeting: ${m.title}` })),
    ...blocks.map((b) => ({ at: b.startMin, text: [`${b.name} ${hhmm(b.startMin)}-${hhmm(b.endMin)}`, ...store.blockTasks(date, b.slot, true).map((t) => `  ${line(t)}`)].join("\n") })),
  ].sort((a, b) => a.at - b.at);
  out.push(...entries.map((e) => e.text));
  return ok(...out);
}

function unscheduled(ctx: Context): Result {
  const list = ctx.store.listTasks({ unscheduled: true });
  return ok(list.length ? list.map(line).join("\n") : "Nothing is unscheduled.");
}

function now(ctx: Context): Result {
  const s = ctx.engine.state();
  const left = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.ceil((ms % 60_000) / 1000) % 60).padStart(2, "0")} left`;
  if (s.kind === "work" && s.block) {
    if (s.emptyBlock) return ok(`${s.block.name}: nothing assigned. ${left(s.remainingMs)}`);
    const step = s.step ? `\nStep ${s.step.index} of ${s.step.total}: ${s.step.step.text}` : "";
    return ok(`${s.block.name}: ${s.task?.title ?? ""}  ${left(s.remainingMs)}${step}`);
  }
  if (s.kind === "break") return ok(`Break. ${left(s.remainingMs)}`);
  if (s.routine.length) return ok(`${s.routine.map((r) => r.title).join(" and ")} is on now.`);
  if (s.kind === "between" && s.nextBlock) return ok(`Next: ${s.nextBlock.name} at ${hhmm(s.nextBlock.startMin)}.`);
  if (s.kind === "rest") return ok("Rest.");
  if (s.kind === "no-template") return ok("No template for today.");
  return ok("Nothing is running.");
}

function meetingRef(store: Store, ref: string | undefined): Meeting {
  if (!ref) throw new Usage("Which meeting? Give its id.");
  const matches = store.listMeetings().filter((m) => m.id === ref || m.id.startsWith(ref));
  const exact = matches.find((m) => m.id === ref);
  if (exact) return exact;
  if (matches.length === 1) return matches[0]!;
  throw new Usage(matches.length ? `"${ref}" matches more than one meeting. Use more of the id.` : `No meeting with id "${ref}".`);
}

function meetingCmd(ctx: Context, p: Parsed): Result {
  const { store } = ctx;
  const [, sub, ...rest] = p.words;
  const todayDate = core.dateOf(store.clock.now());
  const on = flag(p, "date") ? day(flag(p, "date")!, todayDate) : todayDate;
  switch (sub) {
    case "add": {
      const title = rest.join(" ").trim();
      if (!title) throw new Usage('meeting add needs a title, such as: meeting add "Standup" --from 9:30 --to 10:00');
      if (!flag(p, "from") || !flag(p, "to")) throw new Usage("meeting add needs --from and --to, such as --from 9:30 --to 10:00.");
      const made = store.createMeeting({
        title,
        date: on,
        startMin: core.parseTime(flag(p, "from")!),
        endMin: core.parseTime(flag(p, "to")!),
        kind: flag(p, "place") ? "in-person" : "online",
        link: flag(p, "link") ?? null,
        place: flag(p, "place") ?? null,
        notes: flag(p, "notes") ?? "",
        attendees: flagAll(p, "with"),
        repeat: repeatRule(p, on),
      });
      return ok(`Added ${made.id}: ${made.title} on ${made.date}, ${hhmm(made.startMin)}-${hhmm(made.endMin)}${made.repeat ? `. ${core.describeRule(made.repeat)}` : ""}`);
    }
    case "list": {
      const list = store.meetingsOn(on);
      return ok(...(list.length ? [on, ...list.map((m) => `  ${m.id}  ${hhmm(m.startMin)}-${hhmm(m.endMin)}  ${m.title}${m.kind === "in-person" ? ` (${m.place ?? "in person"})` : ""}`)] : [`No meetings on ${on}.`]));
    }
    case "minutes": {
      const m = meetingRef(store, rest[0]);
      const text = rest.slice(1).join(" ").trim();
      if (text) {
        store.setMinutes(m.id, on, text);
        return ok(`Saved the minutes for ${m.title} on ${on}.`);
      }
      return ok(store.getMinutes(m.id, on) || `No minutes for ${m.title} on ${on}.`);
    }
    case "rm": {
      const m = meetingRef(store, rest[0]);
      store.deleteMeeting(m.id, flag(p, "date") ? on : undefined);
      return ok(flag(p, "date") && m.repeat ? `Removed ${m.title} on ${on}.` : `Removed ${m.title}.`);
    }
    default:
      throw new Usage("meeting takes add, list, minutes or rm.");
  }
}

function taskCmd(ctx: Context, p: Parsed): Result {
  const { store } = ctx;
  const [, sub, ...rest] = p.words;
  const todayDate = core.dateOf(store.clock.now());
  switch (sub) {
    case "add": {
      const title = rest.join(" ").trim();
      if (!title) throw new Usage('Give the task a title: task add "Write the report".');
      const proj = flag(p, "project") ? project(store, flag(p, "project")) : null;
      const deliverable = proj && flag(p, "deliverable") ? store.listDeliverables(proj.id).find((d) => d.title.toLowerCase() === flag(p, "deliverable")!.toLowerCase()) : null;
      if (flag(p, "deliverable") && !deliverable) throw new Usage(`No deliverable "${flag(p, "deliverable")}" in that project.`);
      const parent = flag(p, "parent") ? task(store, flag(p, "parent")) : null;
      const t = store.createTask({
        title,
        projectId: proj?.id ?? null,
        deliverableId: deliverable?.id ?? null,
        parentId: parent?.id ?? null,
        dueDate: flag(p, "due") ? day(flag(p, "due")!, todayDate) : null,
        estimatePomodoros: flag(p, "est") ? Number(flag(p, "est")) : null,
        steps: flagAll(p, "step"),
      });
      return ok(`Added ${t.id}: ${t.title}`);
    }
    case "list": {
      const status = flag(p, "status") as Task["status"] | undefined;
      const proj = flag(p, "project") ? project(store, flag(p, "project")) : null;
      const list = store.listTasks({ ...(status ? { status } : {}), ...(proj ? { projectId: proj.id } : {}) });
      return ok(list.length ? list.map(line).join("\n") : "No tasks.");
    }
    case "edit": {
      const t = task(store, rest[0]);
      const patch: Parameters<Store["updateTask"]>[1] = {};
      if (flag(p, "title")) patch.title = flag(p, "title")!;
      if (flag(p, "due")) patch.dueDate = flag(p, "due") === "none" ? null : day(flag(p, "due")!, todayDate);
      if (flag(p, "est")) patch.estimatePomodoros = Number(flag(p, "est"));
      if (flag(p, "notes")) patch.notes = flag(p, "notes")!;
      if (flag(p, "project")) patch.projectId = project(store, flag(p, "project")).id;
      store.updateTask(t.id, patch);
      for (const step of flagAll(p, "step")) store.addStep(t.id, step);
      return ok(`Updated ${t.id}.`);
    }
    case "done":
    case "reopen": {
      const t = task(store, rest[0]);
      store.setStatus(t.id, sub === "done" ? "done" : "open");
      return ok(`${sub === "done" ? "Done" : "Reopened"}: ${t.title}`);
    }
    case "rm": {
      const t = task(store, rest[0]);
      store.deleteTask(t.id, has(p, "keep-subtasks") ? "detach" : "delete");
      return ok(`Removed ${t.title}.`);
    }
    default:
      throw new Usage("task takes add, list, edit, done, reopen or rm.");
  }
}

function place(ctx: Context, p: Parsed, verb: "assign" | "move"): Result {
  const { store } = ctx;
  const t = task(store, p.words[1]);
  const todayDate = core.dateOf(store.clock.now());
  if (!flag(p, "date") || !flag(p, "block")) throw new Usage(`${verb} needs --date and --block.`);
  const date = day(flag(p, "date")!, todayDate);
  if (date < todayDate) throw new Usage("That day has passed.");
  const rule = repeatRule(p, date);
  store.assign(t.id, { date, slot: slotOf(store, date, flag(p, "block")), repeat: rule });
  const made = rule ? core.materializeRepeats(store).created : 0;
  return ok(`${t.title} is now on ${date}, ${flag(p, "block")}.${rule ? ` ${core.describeRule(rule)}. ${made} ${made === 1 ? "copy" : "copies"} made for the next two weeks.` : ""}`);
}

function projectCmd(ctx: Context, p: Parsed): Result {
  const { store } = ctx;
  const [, sub, ...rest] = p.words;
  if (sub === "add") {
    const name = rest.join(" ").trim();
    if (!name) throw new Usage('Give the project a name: project add "Launch".');
    store.createProject({ name, context: flag(p, "context") ?? "" });
    return ok(`Added project ${name}.`);
  }
  if (sub === "show") {
    const proj = project(store, rest.join(" "));
    const out = [`${proj.name}${proj.context ? `\n${proj.context}` : ""}`];
    for (const d of store.listDeliverables(proj.id)) {
      out.push(`\n${d.type}: ${d.title}${d.dueDate ? ` (due ${d.dueDate})` : ""}`);
      out.push(...store.listTasks({ projectId: proj.id, parentId: null }).filter((t) => t.deliverableId === d.id).map((t) => `  ${line(t)}`));
    }
    const loose = store.listTasks({ projectId: proj.id, parentId: null }).filter((t) => !t.deliverableId);
    if (loose.length) out.push("\nOther tasks", ...loose.map((t) => `  ${line(t)}`));
    return ok(...out);
  }
  throw new Usage("project takes add or show.");
}

function deliverableCmd(ctx: Context, p: Parsed): Result {
  const { store } = ctx;
  if (p.words[1] !== "add") throw new Usage("deliverable takes add.");
  const proj = project(store, flag(p, "project"));
  const title = p.words.slice(2).join(" ").trim();
  const type = (flag(p, "type") ?? "deliverable") as "deliverable" | "milestone" | "deadline";
  if (!title) throw new Usage('Give it a title: deliverable add --project Launch "Welcome flow".');
  if (!["deliverable", "milestone", "deadline"].includes(type)) throw new Usage("--type is deliverable, milestone or deadline.");
  store.addDeliverable(proj.id, { title, type, dueDate: flag(p, "due") ? day(flag(p, "due")!, core.dateOf(store.clock.now())) : null });
  return ok(`Added ${type} ${title} to ${proj.name}.`);
}

function templateCmd(ctx: Context, p: Parsed): Result {
  const { store } = ctx;
  const [, sub, ...rest] = p.words;
  if (sub === "list" || sub === undefined) {
    const schedule = store.getSchedule();
    const list = store.listTemplates();
    return ok(list.length ? list.map((t) => {
      const used = Object.entries(schedule).filter(([, id]) => id === t.id).map(([d]) => DAYS[Number(d)]).join(" ");
      return `${t.name}  up ${hhmm(t.wakeMin)}, bed ${hhmm(t.bedMin)}  ${t.blocks.map((b) => `${b.name} ${b.startHour}-${b.endHour}`).join(", ")}${used ? `  [${used}]` : ""}`;
    }).join("\n") : "No templates.");
  }
  if (sub === "add") {
    const name = rest.join(" ").trim();
    if (!name) throw new Usage('Give it a name: template add "Weekday".');
    const blocks = flagAll(p, "block").map((b, i) => {
      const m = /^(.+?)=(\d{1,2})-(\d{1,2})$/.exec(b);
      if (!m) throw new Usage(`--block looks like Morning=9-12, not "${b}".`);
      return { slot: (i + 1) as Slot, name: m[1]!, startHour: Number(m[2]), endHour: Number(m[3]) };
    });
    store.createTemplate({ name, wakeMin: flag(p, "wake") ? core.parseTime(flag(p, "wake")!) : undefined, bedMin: flag(p, "bed") ? core.parseTime(flag(p, "bed")!) : undefined, blocks });
    return ok(`Added template ${name}.`);
  }
  if (sub === "edit") {
    const t = template(store, rest.join(" "));
    store.updateTemplate(t.id, { name: flag(p, "name"), wakeMin: flag(p, "wake") ? core.parseTime(flag(p, "wake")!) : undefined, bedMin: flag(p, "bed") ? core.parseTime(flag(p, "bed")!) : undefined });
    return ok(`Updated ${t.name}.`);
  }
  if (sub === "rm") {
    const t = template(store, rest.join(" "));
    for (const [d, id] of Object.entries(store.getSchedule())) if (id === t.id) store.clearSchedule(Number(d));
    store.deleteTemplate(t.id);
    return ok(`Removed ${t.name}.`);
  }
  throw new Usage("template takes list, add, edit or rm.");
}

function scheduleCmd(ctx: Context, p: Parsed): Result {
  const { store } = ctx;
  const todayDate = core.dateOf(store.clock.now());
  if (p.words[1] === "set") {
    const t = template(store, flag(p, "template"));
    const list = days(flag(p, "days") ?? "");
    store.setSchedule(list, t.id);
    return ok(`${t.name} runs on ${list.map((d) => DAYS[d]).join(" ")}.`);
  }
  if (p.words[1] === "set-day") {
    const date = day(p.words[2] ?? "", todayDate);
    if (date < todayDate) throw new Usage("That day has passed.");
    const t = template(store, flag(p, "template"));
    const result = core.changeDateTemplate(store, date, t.id);
    return ok(`${date} now uses ${t.name}. ${result.moved.length} ${result.moved.length === 1 ? "task" : "tasks"} moved.`);
  }
  throw new Usage("schedule takes set or set-day.");
}

function configCmd(ctx: Context, p: Parsed): Result {
  const { store } = ctx;
  if (p.words[1] !== "set") throw new Usage("config takes set.");
  const key = p.words[2];
  const value = p.words[3];
  switch (key) {
    case "week-end": {
      const d = DAYS.indexOf((value ?? "").toLowerCase().slice(0, 3));
      if (d === -1) throw new Usage("week-end takes a day, such as sunday.");
      store.updateSettings({ weekEndDay: d });
      return ok(`Your week now ends on ${DAY_NAMES[d]}.`);
    }
    case "pomodoro": {
      const focus = Number(value);
      if (!Number.isInteger(focus) || focus < 1 || focus > 180) throw new Usage("pomodoro takes minutes, 1 to 180.");
      store.updateSettings({
        pomodoroMinutes: focus,
        ...(flag(p, "break") ? { shortBreakMinutes: Number(flag(p, "break")) } : {}),
        ...(flag(p, "long-break") ? { longBreakMinutes: Number(flag(p, "long-break")) } : {}),
      });
      const s = store.getSettings();
      return ok(`Focus ${s.pomodoroMinutes} min, break ${s.shortBreakMinutes} min, long break ${s.longBreakMinutes} min.`);
    }
    case "app-name":
      if (!value?.trim()) throw new Usage("app-name needs a name.");
      store.updateSettings({ appName: value.trim() });
      return ok(`The app is now called ${value.trim()}.`);
    case "cli-name":
      if (!value || !/^[A-Za-z0-9-]{1,30}$/.test(value)) throw new Usage("cli-name is letters, numbers and hyphens only.");
      store.updateSettings({ cliName: value });
      return ok(`The command is now ${value}. Open the app once to create the new launcher.`);
    default:
      throw new Usage("config set takes week-end, pomodoro, app-name or cli-name.");
  }
}

function reportCmd(ctx: Context, p: Parsed): Result {
  const { store } = ctx;
  const settings = store.getSettings();
  const date = core.dateOf(store.clock.now());
  const start = flag(p, "week") ? core.weekStart(day(flag(p, "week")!, date), settings.weekEndDay) : core.addDays(core.weekStart(date, settings.weekEndDay), -7);
  const r = core.weeklyReport(store, start);
  if (r.planned === 0) return ok(`Nothing was planned for ${start} to ${r.weekEnd}.`);
  const change = r.procrastination.change === null ? "first week" : `${r.procrastination.change <= 0 ? "down" : "up"} ${Math.abs(r.procrastination.change)} pts`;
  return ok(
    `${start} to ${r.weekEnd}`,
    `Planned ${r.planned}, done ${r.done}, unfinished ${r.unfinished}, rescheduled ${r.rescheduled}`,
    `Done on time: ${r.onTimePct}%`,
    `Procrastination: ${r.procrastination.level} (${change})`,
    ...(r.mostRescheduled ? [`Most rescheduled: ${r.mostRescheduled.title}, ${r.mostRescheduled.times}x`] : []),
    `Streak: ${r.streak.current} days (best ${r.streak.best})`,
  );
}

function weekCmd(ctx: Context): Result {
  const { store } = ctx;
  const date = core.dateOf(store.clock.now());
  const start = core.weekStart(date, store.getSettings().weekEndDay);
  const out: string[] = [];
  for (let i = 0; i < 7; i += 1) {
    const d = core.addDays(start, i);
    out.push(`${DAY_NAMES[core.weekdayOf(d)]} ${d}${d === date ? " (today)" : ""}`);
    for (const b of store.blocksFor(d)) {
      const tasks = store.blockTasks(d, b.slot, true);
      out.push(`  ${b.name}: ${tasks.length ? tasks.map((t) => `${t.status === "done" ? "✓ " : ""}${t.title}`).join("; ") : "-"}`);
    }
  }
  const waiting = store.listTasks({ unscheduled: true });
  out.push(`Unscheduled: ${waiting.length ? waiting.map((t) => t.title).join("; ") : "-"}`);
  return ok(...out);
}

async function dataCmd(ctx: Context, p: Parsed): Promise<Result> {
  const { store } = ctx;
  const cmd = p.words[0];
  if (cmd === "backup") {
    const path = core.createSnapshot(store.db, ctx.backups, "manual", store.clock.now(), core.LATEST_VERSION);
    return ok(`Backed up to ${path}`);
  }
  if (cmd === "restore") {
    const snaps = core.listSnapshots(ctx.backups).filter((s) => s.schemaVersion <= core.LATEST_VERSION);
    if (!p.words[1]) return ok(snaps.length ? snaps.map((s) => `${s.name}  ${new Date(s.createdAt).toLocaleString()}  ${s.kind}`).join("\n") : "No backups yet.", "", "Close the app, then run: restore NAME");
    const snap = snaps.find((s) => s.name === p.words[1]);
    if (!snap) throw new Usage(`No backup called "${p.words[1]}". Run restore on its own to list them.`);
    store.db.close();
    core.restoreSnapshot(ctx.dbPath, snap.path, ctx.backups, store.clock.now(), core.LATEST_VERSION);
    return ok(`Restored ${snap.name}. The damaged file was kept aside.`);
  }
  if (cmd === "export") {
    if (!p.words[1]) throw new Usage("export needs a file name.");
    ctx.writeFile(p.words[1], JSON.stringify(core.exportData(store.db, store.clock.now()), null, 2));
    return ok(`Exported to ${p.words[1]}`);
  }
  if (cmd === "import") {
    if (!p.words[1]) throw new Usage("import needs a file name.");
    let parsed: unknown;
    try {
      parsed = JSON.parse(ctx.readFile(p.words[1]));
    } catch {
      throw new Usage("That file isn't readable JSON.");
    }
    core.validateExport(parsed);
    core.createSnapshot(store.db, ctx.backups, "pre-restore", store.clock.now(), core.LATEST_VERSION);
    const result = core.importData(store.db, parsed);
    return ok(`Imported ${result.rows} rows. A backup of what was here was kept.`);
  }
  throw new Usage("Unknown data command.");
}

const HELP = `today | unscheduled | now | week | report [--week DATE]
task add|list|edit|done|reopen|rm      assign|move ID --date D --block B [--repeat daily|weekly|monthly|yearly --every N --days mon,wed]
unassign ID                            repeat ID off
meeting add "T" --from 9:30 --to 10 [--date D --link URL --with NAME --place P --repeat ...]  |  meeting list|minutes|rm
project add|show                       deliverable add --project P "title"
template list|add|edit|rm              schedule set --days mon-fri --template T | set-day DATE --template T
config set week-end|pomodoro|app-name|cli-name
backup | restore [NAME] | export FILE | import FILE
pause | resume | skip | done           (the app must be running)`;

/** Runs one command line. Never throws for a user mistake: that comes back as a message and code 1. */
export async function runCommand(argv: string[], ctx: Context): Promise<Result> {
  const p = parseArgs(argv);
  const cmd = p.words[0];
  try {
    switch (cmd) {
      case undefined:
      case "help":
        return ok(HELP);
      case "today": return today(ctx);
      case "unscheduled": return unscheduled(ctx);
      case "now": return now(ctx);
      case "week": return weekCmd(ctx);
      case "report": return reportCmd(ctx, p);
      case "task": return taskCmd(ctx, p);
      case "meeting": return meetingCmd(ctx, p);
      case "assign": return place(ctx, p, "assign");
      case "move": return place(ctx, p, "move");
      case "repeat": {
        const t = task(ctx.store, p.words[1]);
        if (p.words[2] !== "off") throw new Usage("repeat ID off stops a task from repeating. To start one, use assign --repeat.");
        if (t.seriesId) ctx.store.endSeries(t.seriesId);
        return ok(`${t.title} no longer repeats.`);
      }
      case "unassign": {
        const t = task(ctx.store, p.words[1]);
        ctx.store.unassign(t.id);
        return ok(`${t.title} is unscheduled.`);
      }
      case "project": return projectCmd(ctx, p);
      case "deliverable": return deliverableCmd(ctx, p);
      case "template": return templateCmd(ctx, p);
      case "schedule": return scheduleCmd(ctx, p);
      case "config": return configCmd(ctx, p);
      case "backup":
      case "restore":
      case "export":
      case "import":
        return await dataCmd(ctx, p);
      case "pause":
      case "resume":
      case "skip":
      case "done":
        return ok(await ctx.control(cmd));
      default:
        throw new Usage(`I don't know "${cmd}". Run help to see the commands.`);
    }
  } catch (e) {
    if (e instanceof Usage || e instanceof core.ImportError) return { code: 1, out: e.message };
    if (e instanceof Error && /isn't running/.test(e.message)) return { code: 1, out: e.message };
    return { code: 1, out: e instanceof Error ? e.message : String(e) };
  }
}
