import type Database from "better-sqlite3";
import { type Clock, systemClock } from "./clock";
import { type LocalDate, weekdayOf } from "./dates";
import { newId } from "./ids";
import {
  type Assignment,
  type Block,
  type DayBlock,
  type Deliverable,
  type DeliverableType,
  type EventKind,
  type EventReason,
  type Project,
  type RepeatRule,
  type RoutineItem,
  type Settings,
  MAX_BLOCKS,
  type Slot,
  type Task,
  type TaskStatus,
  type TaskStep,
  type Template,
  DEFAULT_SETTINGS,
} from "./types";
import { occursOn } from "./repeat";

type Row = Record<string, any>;

const DEFAULT_BLOCK_NAMES = ["Morning", "Afternoon", "Evening"];
const blockName = (name: string | undefined, index: number) => name?.trim() || DEFAULT_BLOCK_NAMES[index] || `Block ${index + 1}`;

export interface NewTask {
  title: string;
  parentId?: string | null;
  projectId?: string | null;
  deliverableId?: string | null;
  dueDate?: LocalDate | null;
  estimatePomodoros?: number | null;
  notes?: string;
  steps?: string[];
}

export interface NewTemplate {
  name: string;
  wakeMin?: number;
  bedMin?: number;
  blocks?: Block[];
}

export type Position = "start" | "end" | number;

/**
 * All database access for the app and the CLI. Statements are prepared once and cached,
 * and every method reads only what it needs, so cost stays flat as history grows.
 */
export class Store {
  private cache = new Map<string, Database.Statement>();

  constructor(
    readonly db: Database.Database,
    readonly clock: Clock = systemClock,
  ) {}

  private q(sql: string): Database.Statement {
    let s = this.cache.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.cache.set(sql, s);
    }
    return s;
  }

  private all<T = Row>(sql: string, ...p: unknown[]): T[] {
    return this.q(sql).all(...p) as T[];
  }
  private get<T = Row>(sql: string, ...p: unknown[]): T | undefined {
    return this.q(sql).get(...p) as T | undefined;
  }
  private run(sql: string, ...p: unknown[]): Database.RunResult {
    return this.q(sql).run(...p);
  }
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  private freshId(table: string): string {
    return newId((id) => this.get(`SELECT 1 FROM ${table} WHERE id = ?`, id) !== undefined);
  }

  // ---------------------------------------------------------------- settings
  getSettings(): Settings {
    const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    for (const r of this.all<{ key: string; value: string }>("SELECT key, value FROM setting")) {
      if (r.key in DEFAULT_SETTINGS) out[r.key] = JSON.parse(r.value);
    }
    return out as unknown as Settings;
  }

  updateSettings(patch: Partial<Settings>): Settings {
    this.transaction(() => {
      for (const [k, v] of Object.entries(patch)) {
        if (!(k in DEFAULT_SETTINGS) || v === undefined) continue;
        this.run("INSERT INTO setting(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", k, JSON.stringify(v));
      }
    });
    return this.getSettings();
  }

  // --------------------------------------------------------------- templates
  createTemplate(input: NewTemplate): Template {
    const id = this.freshId("day_template");
    this.transaction(() => {
      this.run("INSERT INTO day_template(id, name, wake_min, bed_min) VALUES(?,?,?,?)", id, input.name, input.wakeMin ?? 420, input.bedMin ?? 1380);
      this.setBlocks(id, input.blocks ?? []);
    });
    return this.getTemplate(id)!;
  }

  setBlocks(templateId: string, blocks: Block[]): void {
    if (blocks.length > MAX_BLOCKS) throw new Error(`A day can have at most ${MAX_BLOCKS} work blocks`);
    const names = blocks.map((b, i) => blockName(b.name, i).toLowerCase());
    if (new Set(names).size !== names.length) throw new Error("Work blocks need different names");
    this.transaction(() => {
      this.run("DELETE FROM template_block WHERE template_id = ?", templateId);
      const sorted = [...blocks].sort((a, b) => a.startHour - b.startHour);
      sorted.forEach((b, i) => {
        if (b.endHour <= b.startHour) throw new Error(`Block "${b.name}" must end after it starts`);
        const prev = sorted[i - 1];
        if (prev && prev.endHour > b.startHour) throw new Error(`Blocks "${prev.name}" and "${b.name}" overlap`);
        this.run("INSERT INTO template_block(template_id, slot, name, start_hour, end_hour) VALUES(?,?,?,?,?)", templateId, i + 1, blockName(b.name, i), b.startHour, b.endHour);
      });
    });
  }

  /**
   * Replaces a template's blocks and keeps every task in the block it was in. Blocks are numbered
   * in time order, so adding or removing one shifts the numbers; tasks follow their block by name,
   * or by its hours if it was renamed. Tasks from today on whose block is gone go back to
   * Unscheduled; earlier days are only renumbered.
   */
  applyBlocks(templateId: string, blocks: Block[], today: LocalDate): { moved: number; unscheduled: number } {
    const before = this.getTemplate(templateId)?.blocks ?? [];
    let moved = 0;
    let unscheduled = 0;
    this.transaction(() => {
      this.setBlocks(templateId, blocks);
      const after = this.getTemplate(templateId)?.blocks ?? [];
      const target = (slot: number): number | null => {
        const old = before.find((b) => b.slot === slot);
        if (!old) return null;
        const same = after.find((b) => b.name.toLowerCase() === old.name.toLowerCase()) ?? after.find((b) => b.startHour === old.startHour && b.endHour === old.endHour);
        return same?.slot ?? null;
      };
      const dates = this.all<Row>("SELECT DISTINCT date FROM assignment").map((r) => r.date as LocalDate).filter((d) => this.templateIdFor(d) === templateId);
      for (const date of dates) {
        for (const a of this.all<Row>("SELECT task_id, slot FROM assignment WHERE date = ?", date)) {
          const to = target(a.slot);
          if (to === null) {
            if (date >= today) {
              this.unassign(a.task_id, "template_change");
              unscheduled += 1;
            }
          } else if (to !== a.slot) {
            this.run("UPDATE assignment SET slot = ? WHERE task_id = ?", to, a.task_id);
            moved += 1;
          }
        }
      }
    });
    return { moved, unscheduled };
  }

  getTemplate(id: string): Template | undefined {
    const t = this.get<Row>("SELECT * FROM day_template WHERE id = ?", id);
    if (!t) return undefined;
    return {
      id: t.id,
      name: t.name,
      wakeMin: t.wake_min,
      bedMin: t.bed_min,
      blocks: this.all<Row>("SELECT * FROM template_block WHERE template_id = ? ORDER BY slot", id).map(mapBlock),
      routine: this.all<Row>("SELECT * FROM routine_item WHERE template_id = ? ORDER BY start_min, position", id).map(mapRoutine),
    };
  }

  listTemplates(): Template[] {
    return this.all<Row>("SELECT id FROM day_template ORDER BY name").map((r) => this.getTemplate(r.id)!);
  }

  updateTemplate(id: string, patch: { name?: string; wakeMin?: number; bedMin?: number }): Template {
    const cur = this.getTemplate(id);
    if (!cur) throw new Error(`No template ${id}`);
    this.run("UPDATE day_template SET name = ?, wake_min = ?, bed_min = ? WHERE id = ?", patch.name ?? cur.name, patch.wakeMin ?? cur.wakeMin, patch.bedMin ?? cur.bedMin, id);
    return this.getTemplate(id)!;
  }

  deleteTemplate(id: string): void {
    this.run("DELETE FROM day_template WHERE id = ?", id);
  }

  addRoutineItem(templateId: string, item: { title: string; startMin: number; endMin?: number | null; repeat?: RepeatRule | null }): RoutineItem {
    const id = this.freshId("routine_item");
    const position = (this.get<{ m: number | null }>("SELECT MAX(position) AS m FROM routine_item WHERE template_id = ?", templateId)?.m ?? -1) + 1;
    this.run("INSERT INTO routine_item(id, template_id, title, start_min, end_min, position, repeat_rule) VALUES(?,?,?,?,?,?,?)", id, templateId, item.title, item.startMin, item.endMin ?? null, position, item.repeat ? JSON.stringify(item.repeat) : null);
    return mapRoutine(this.get<Row>("SELECT * FROM routine_item WHERE id = ?", id)!);
  }

  updateRoutineItem(id: string, patch: { title: string; startMin: number; endMin: number | null; repeat?: RepeatRule | null }): void {
    this.run("UPDATE routine_item SET title = ?, start_min = ?, end_min = ? WHERE id = ?", patch.title, patch.startMin, patch.endMin, id);
    if (patch.repeat !== undefined) this.run("UPDATE routine_item SET repeat_rule = ? WHERE id = ?", patch.repeat ? JSON.stringify(patch.repeat) : null, id);
  }

  removeRoutineItem(id: string): void {
    this.run("DELETE FROM routine_item WHERE id = ?", id);
  }

  /** Maps weekdays (0 = Monday) to a template. Replaces any previous mapping for those days. */
  setSchedule(weekdays: number[], templateId: string): void {
    this.transaction(() => {
      for (const d of weekdays) this.run("INSERT INTO schedule_rule(weekday, template_id) VALUES(?,?) ON CONFLICT(weekday) DO UPDATE SET template_id = excluded.template_id", d, templateId);
    });
  }

  clearSchedule(weekday: number): void {
    this.run("DELETE FROM schedule_rule WHERE weekday = ?", weekday);
  }

  getSchedule(): Record<number, string> {
    const out: Record<number, string> = {};
    for (const r of this.all<Row>("SELECT weekday, template_id FROM schedule_rule")) out[r.weekday] = r.template_id;
    return out;
  }

  /** Stores the per-date override only. Use `changeDateTemplate` to also redistribute tasks. */
  setDateTemplateRaw(date: LocalDate, templateId: string | null): void {
    if (templateId === null) this.run("DELETE FROM date_template WHERE date = ?", date);
    else this.run("INSERT INTO date_template(date, template_id) VALUES(?,?) ON CONFLICT(date) DO UPDATE SET template_id = excluded.template_id", date, templateId);
  }

  getDateOverride(date: LocalDate): string | null {
    return this.get<Row>("SELECT template_id FROM date_template WHERE date = ?", date)?.template_id ?? null;
  }

  /** The template that applies to a date: its override, else its weekday's, else none (a day off). */
  templateIdFor(date: LocalDate): string | null {
    if (this.isDayOff(date)) return null;
    return this.getDateOverride(date) ?? this.get<Row>("SELECT template_id FROM schedule_rule WHERE weekday = ?", weekdayOf(date))?.template_id ?? null;
  }

  /** The work blocks of a date, in time order, with absolute minutes. Empty on a day with no template. */
  blocksFor(date: LocalDate): DayBlock[] {
    const id = this.templateIdFor(date);
    if (!id) return [];
    const early = new Map(this.all<Row>("SELECT slot, start_min FROM block_override WHERE date = ?", date).map((r) => [r.slot as number, r.start_min as number]));
    return this.all<Row>("SELECT * FROM template_block WHERE template_id = ? ORDER BY slot", id).map((r) => {
      const planned = r.start_hour * 60;
      const started = early.get(r.slot);
      return { ...mapBlock(r), date, startMin: started !== undefined && started < planned ? started : planned, endMin: r.end_hour * 60 };
    });
  }

  /** Routine items that apply on a date, honoring each item's repeat rule (default: every time). */
  routineFor(date: LocalDate): RoutineItem[] {
    const id = this.templateIdFor(date);
    if (!id) return [];
    const ends = new Map(this.all<Row>("SELECT item_id, end_min FROM routine_override WHERE date = ?", date).map((r) => [r.item_id as string, r.end_min as number]));
    return this.all<Row>("SELECT * FROM routine_item WHERE template_id = ? ORDER BY start_min, position", id)
      .map(mapRoutine)
      .filter((r) => r.repeat === null || occursOn(r.repeat, date))
      .map((r) => (ends.has(r.id) ? { ...r, endMin: ends.get(r.id)! } : r));
  }

  // ------------------------------------------------- adjustments to one day

  /** Makes a routine item run `minutes` longer on this date only. */
  extendRoutine(date: LocalDate, itemId: string, minutes: number): void {
    const item = this.routineFor(date).find((r) => r.id === itemId);
    if (!item || item.endMin === null) return;
    this.endRoutineAt(date, itemId, Math.min(24 * 60, item.endMin + minutes));
  }

  /** Sets when a routine item ends on this date only. */
  endRoutineAt(date: LocalDate, itemId: string, endMin: number): void {
    this.run("INSERT INTO routine_override(date, item_id, end_min) VALUES(?,?,?) ON CONFLICT(date, item_id) DO UPDATE SET end_min = excluded.end_min", date, itemId, endMin);
  }

  /** Starts a work block earlier than planned on this date only. */
  startBlockAt(date: LocalDate, slot: Slot, startMin: number): void {
    this.run("INSERT INTO block_override(date, slot, start_min) VALUES(?,?,?) ON CONFLICT(date, slot) DO UPDATE SET start_min = excluded.start_min", date, slot, startMin);
  }

  isDayOff(date: LocalDate): boolean {
    return this.get<Row>("SELECT 1 AS yes FROM day_off WHERE date = ?", date) !== undefined;
  }

  setDayOff(date: LocalDate, off: boolean): void {
    if (off) this.run("INSERT OR IGNORE INTO day_off(date) VALUES(?)", date);
    else this.run("DELETE FROM day_off WHERE date = ?", date);
  }

  // ------------------------------------------------------------------- tasks
  createTask(input: NewTask): Task {
    const id = this.freshId("task");
    this.transaction(() => {
      if (input.parentId && !this.get("SELECT 1 FROM task WHERE id = ?", input.parentId)) throw new Error(`No parent task ${input.parentId}`);
      this.run(
        "INSERT INTO task(id, parent_id, project_id, deliverable_id, title, notes, estimate_pomodoros, due_date, status, created_at) VALUES(?,?,?,?,?,?,?,?, 'open', ?)",
        id, input.parentId ?? null, input.projectId ?? null, input.deliverableId ?? null, input.title, input.notes ?? "", input.estimatePomodoros ?? null, input.dueDate ?? null, this.clock.now(),
      );
      (input.steps ?? []).forEach((text) => this.addStep(id, text));
      // A new subtask reopens a completed parent.
      if (input.parentId) this.refreshAncestors(input.parentId);
    });
    return this.getTask(id)!;
  }

  getTask(id: string): Task | undefined {
    const r = this.get<Row>("SELECT * FROM task WHERE id = ?", id);
    return r ? mapTask(r) : undefined;
  }

  listTasks(filter: { status?: TaskStatus; projectId?: string; parentId?: string | null; unscheduled?: boolean } = {}): Task[] {
    const where: string[] = [];
    const p: unknown[] = [];
    if (filter.status) { where.push("t.status = ?"); p.push(filter.status); }
    if (filter.projectId) { where.push("t.project_id = ?"); p.push(filter.projectId); }
    if (filter.parentId !== undefined) { where.push(filter.parentId === null ? "t.parent_id IS NULL" : "t.parent_id = ?"); if (filter.parentId !== null) p.push(filter.parentId); }
    if (filter.unscheduled) where.push("NOT EXISTS (SELECT 1 FROM assignment a WHERE a.task_id = t.id) AND t.status != 'done'");
    const sql = `SELECT t.* FROM task t ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY t.created_at, t.rowid`;
    return this.db.prepare(sql).all(...p).map((r) => mapTask(r as Row));
  }

  updateTask(id: string, patch: Partial<Pick<Task, "title" | "notes" | "projectId" | "deliverableId" | "dueDate" | "estimatePomodoros">>): Task {
    const cur = this.getTask(id);
    if (!cur) throw new Error(`No task ${id}`);
    const n = { ...cur, ...patch };
    this.run("UPDATE task SET title = ?, notes = ?, project_id = ?, deliverable_id = ?, due_date = ?, estimate_pomodoros = ? WHERE id = ?", n.title, n.notes, n.projectId, n.deliverableId, n.dueDate, n.estimatePomodoros, id);
    return this.getTask(id)!;
  }

  /**
   * Sets a task's status and keeps parents consistent: a parent completes when all its
   * subtasks are done, and reopens if one is reopened (FR-11). Nothing else ever marks
   * a task done automatically.
   */
  setStatus(id: string, status: TaskStatus, reason: EventReason = "manual"): Task {
    const cur = this.getTask(id);
    if (!cur) throw new Error(`No task ${id}`);
    this.transaction(() => {
      this.applyStatus(cur, status, reason);
      if (cur.parentId) this.refreshAncestors(cur.parentId);
    });
    return this.getTask(id)!;
  }

  private applyStatus(task: Task, status: TaskStatus, reason: EventReason): void {
    if (task.status === status) return;
    const now = this.clock.now();
    this.run("UPDATE task SET status = ?, completed_at = ? WHERE id = ?", status, status === "done" ? now : null, task.id);
    if (status === "done") this.recordEvent(task.id, "completed", {}, reason);
    else if (task.status === "done") this.recordEvent(task.id, "reopened", {}, reason);
  }

  private refreshAncestors(parentId: string): void {
    const parent = this.getTask(parentId);
    if (!parent) return;
    const kids = this.all<Row>("SELECT status FROM task WHERE parent_id = ?", parentId);
    if (kids.length === 0) return;
    const allDone = kids.every((k) => k.status === "done");
    if (allDone && parent.status !== "done") this.applyStatus(parent, "done", "manual");
    else if (!allDone && parent.status === "done") this.applyStatus(parent, "open", "manual");
    if (parent.parentId) this.refreshAncestors(parent.parentId);
  }

  /** Deleting a parent: delete its subtasks too, or detach them into top-level tasks. */
  deleteTask(id: string, subtasks: "delete" | "detach" = "delete"): void {
    this.transaction(() => {
      const t = this.getTask(id);
      if (!t) return;
      if (subtasks === "detach") this.run("UPDATE task SET parent_id = NULL WHERE parent_id = ?", id);
      this.run("DELETE FROM task WHERE id = ?", id);
      if (t.parentId) this.refreshAncestors(t.parentId);
    });
  }

  childrenOf(id: string): Task[] {
    return this.all<Row>("SELECT * FROM task WHERE parent_id = ? ORDER BY created_at, rowid", id).map(mapTask);
  }

  // ------------------------------------------------------------------- steps
  addStep(taskId: string, text: string): TaskStep {
    const id = this.freshId("task_step");
    const position = (this.get<{ m: number | null }>("SELECT MAX(position) AS m FROM task_step WHERE task_id = ?", taskId)?.m ?? -1) + 1;
    this.run("INSERT INTO task_step(id, task_id, text, done, position) VALUES(?,?,?,0,?)", id, taskId, text, position);
    return mapStep(this.get<Row>("SELECT * FROM task_step WHERE id = ?", id)!);
  }

  listSteps(taskId: string): TaskStep[] {
    return this.all<Row>("SELECT * FROM task_step WHERE task_id = ? ORDER BY position", taskId).map(mapStep);
  }

  setStepDone(stepId: string, done: boolean): void {
    this.run("UPDATE task_step SET done = ? WHERE id = ?", done ? 1 : 0, stepId);
  }

  /** The step to show now: the first one not done, with its place in the list. */
  currentStep(taskId: string): { step: TaskStep; index: number; total: number } | null {
    const steps = this.listSteps(taskId);
    const index = steps.findIndex((s) => !s.done);
    return index === -1 ? null : { step: steps[index]!, index: index + 1, total: steps.length };
  }

  // ------------------------------------------------------------- assignments
  getAssignment(taskId: string): Assignment | undefined {
    const r = this.get<Row>("SELECT * FROM assignment WHERE task_id = ?", taskId);
    return r ? mapAssignment(r) : undefined;
  }

  /** The assignment a task effectively has: its own, else its parent's, up the tree (FR-14). */
  effectiveAssignment(taskId: string): Assignment | undefined {
    let id: string | null = taskId;
    for (let depth = 0; id && depth < 10; depth++) {
      const a = this.getAssignment(id);
      if (a) return a;
      id = this.getTask(id)?.parentId ?? null;
    }
    return undefined;
  }

  /** Assigns (or moves) a task to a block on a date. */
  assign(taskId: string, to: { date: LocalDate; slot: Slot; position?: Position; repeat?: RepeatRule | null }, reason: EventReason = "manual"): Assignment {
    if (!this.getTask(taskId)) throw new Error(`No task ${taskId}`);
    this.transaction(() => {
      const prev = this.getAssignment(taskId);
      const position = this.resolvePosition(to.date, to.slot, to.position ?? "end", prev?.id);
      if (prev) {
        this.run("UPDATE assignment SET date = ?, slot = ?, position = ?, repeat_rule = COALESCE(?, repeat_rule) WHERE id = ?", to.date, to.slot, position, to.repeat ? JSON.stringify(to.repeat) : null, prev.id);
        if (prev.date !== to.date || prev.slot !== to.slot) {
          this.recordEvent(taskId, reason === "rollover" ? "rolled" : "moved", { fromDate: prev.date, fromSlot: prev.slot, toDate: to.date, toSlot: to.slot }, reason);
        }
      } else {
        this.run("INSERT INTO assignment(id, task_id, date, slot, position, repeat_rule, created_at) VALUES(?,?,?,?,?,?,?)", this.freshId("assignment"), taskId, to.date, to.slot, position, to.repeat ? JSON.stringify(to.repeat) : null, this.clock.now());
        this.recordEvent(taskId, "assigned", { toDate: to.date, toSlot: to.slot }, reason);
      }
      if (to.repeat) this.startSeries(taskId, to.slot, to.repeat);
    });
    return this.getAssignment(taskId)!;
  }

  /**
   * Updates where an assignment sits without writing history. Used when only the slot
   * number changes but the block is the same one (for example after a template change).
   */
  reslot(taskId: string, to: { date: LocalDate; slot: Slot; position: number }): void {
    this.run("UPDATE assignment SET date = ?, slot = ?, position = ? WHERE task_id = ?", to.date, to.slot, to.position, taskId);
  }

  unassign(taskId: string, reason: EventReason = "manual"): void {
    const prev = this.getAssignment(taskId);
    if (!prev) return;
    this.transaction(() => {
      this.run("DELETE FROM assignment WHERE id = ?", prev.id);
      this.recordEvent(taskId, "unassigned", { fromDate: prev.date, fromSlot: prev.slot }, reason);
    });
  }

  private resolvePosition(date: LocalDate, slot: Slot, pos: Position, excludeId?: string): number {
    if (typeof pos === "number") return pos;
    const r = this.get<{ lo: number | null; hi: number | null }>("SELECT MIN(position) AS lo, MAX(position) AS hi FROM assignment WHERE date = ? AND slot = ? AND id IS NOT ?", date, slot, excludeId ?? null);
    if (pos === "start") return (r?.lo ?? 1) - 1;
    return (r?.hi ?? -1) + 1;
  }

  /** Assignments of one block, in order. Ties are broken by creation time (section 11). */
  listBlock(date: LocalDate, slot: Slot): Assignment[] {
    return this.all<Row>("SELECT * FROM assignment WHERE date = ? AND slot = ? ORDER BY position, created_at, rowid", date, slot).map(mapAssignment);
  }

  listDate(date: LocalDate): Assignment[] {
    return this.all<Row>("SELECT * FROM assignment WHERE date = ? ORDER BY slot, position, created_at, rowid", date).map(mapAssignment);
  }

  /** Sets the order of a block explicitly. */
  reorderBlock(date: LocalDate, slot: Slot, taskIds: string[]): void {
    this.transaction(() => {
      taskIds.forEach((id, i) => this.run("UPDATE assignment SET position = ? WHERE task_id = ? AND date = ? AND slot = ?", i, id, date, slot));
    });
  }

  /** Re-numbers a block's positions 0..n-1, keeping the current order. */
  normalizeBlock(date: LocalDate, slot: Slot): void {
    this.transaction(() => {
      this.listBlock(date, slot).forEach((a, i) => this.run("UPDATE assignment SET position = ? WHERE id = ?", i, a.id));
    });
  }

  /**
   * The tasks the timer works through in a block, in order: each assigned task, or for a
   * task with open subtasks that follow it, those subtasks. Done tasks are skipped.
   */
  blockTasks(date: LocalDate, slot: Slot, includeDone = false): Task[] {
    const out: Task[] = [];
    for (const a of this.listBlock(date, slot)) {
      const task = this.getTask(a.taskId);
      if (!task) continue;
      const leaves = this.leafTasks(task);
      for (const t of leaves) if (includeDone || t.status !== "done") out.push(t);
    }
    return out;
  }

  private leafTasks(task: Task): Task[] {
    const kids = this.childrenOf(task.id).filter((k) => !this.getAssignment(k.id));
    if (kids.length === 0) return [task];
    return kids.flatMap((k) => this.leafTasks(k));
  }

  // ------------------------------------------------------ projects, sessions
  createProject(input: { name: string; description?: string; context?: string }): Project {
    const id = this.freshId("project");
    this.run("INSERT INTO project(id, name, description, context, created_at) VALUES(?,?,?,?,?)", id, input.name, input.description ?? "", input.context ?? "", this.clock.now());
    return mapProject(this.get<Row>("SELECT * FROM project WHERE id = ?", id)!);
  }

  listProjects(): Project[] {
    return this.all<Row>("SELECT * FROM project ORDER BY name").map(mapProject);
  }

  addDeliverable(projectId: string, input: { title: string; type: DeliverableType; dueDate?: LocalDate | null }): Deliverable {
    const id = this.freshId("deliverable");
    this.run("INSERT INTO deliverable(id, project_id, title, type, due_date, status) VALUES(?,?,?,?,?, 'open')", id, projectId, input.title, input.type, input.dueDate ?? null);
    return mapDeliverable(this.get<Row>("SELECT * FROM deliverable WHERE id = ?", id)!);
  }

  listDeliverables(projectId: string): Deliverable[] {
    return this.all<Row>("SELECT * FROM deliverable WHERE project_id = ? ORDER BY due_date IS NULL, due_date, id", projectId).map(mapDeliverable);
  }

  // ----------------------------------------------------------- repeating tasks

  /**
   * Makes a task the start of a series that comes back by `rule`. Asking again changes the rule
   * and wakes a series that had ended. The task's own date counts as the first occurrence.
   */
  startSeries(taskId: string, slot: Slot, rule: RepeatRule): string {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`No task ${taskId}`);
    const id = task.seriesId ?? task.id;
    this.transaction(() => {
      this.run("INSERT INTO repeat_series(id, slot, rule, active) VALUES(?,?,?,1) ON CONFLICT(id) DO UPDATE SET slot = excluded.slot, rule = excluded.rule, active = 1", id, slot, JSON.stringify(rule));
      this.run("UPDATE task SET series_id = ? WHERE id = ?", id, task.id);
      const placed = this.getAssignment(task.id);
      if (placed) this.markOccurrence(id, placed.date);
    });
    return id;
  }

  getSeries(id: string): { id: string; slot: Slot; rule: RepeatRule; active: boolean } | undefined {
    const r = this.get<Row>("SELECT * FROM repeat_series WHERE id = ?", id);
    return r ? { id: r.id, slot: r.slot, rule: JSON.parse(r.rule) as RepeatRule, active: r.active === 1 } : undefined;
  }

  listActiveSeries(): Array<{ id: string; slot: Slot; rule: RepeatRule }> {
    return this.all<Row>("SELECT * FROM repeat_series WHERE active = 1 ORDER BY id").map((r) => ({ id: r.id, slot: r.slot, rule: JSON.parse(r.rule) as RepeatRule }));
  }

  /** Stops a series from making more copies. Copies already made are left alone. */
  endSeries(id: string): void {
    this.run("UPDATE repeat_series SET active = 0 WHERE id = ?", id);
  }

  markOccurrence(seriesId: string, date: LocalDate): void {
    this.run("INSERT OR IGNORE INTO series_occurrence(series_id, date) VALUES(?,?)", seriesId, date);
  }

  seriesDates(seriesId: string): Set<LocalDate> {
    return new Set(this.all<Row>("SELECT date FROM series_occurrence WHERE series_id = ?", seriesId).map((r) => r.date as LocalDate));
  }

  setSeriesId(taskId: string, seriesId: string): void {
    this.run("UPDATE task SET series_id = ? WHERE id = ?", seriesId, taskId);
  }

  recordSession(s: { taskId: string | null; startAt: number; endAt: number; type: "work" | "break"; completed: boolean }): void {
    this.run("INSERT INTO session(task_id, start_at, end_at, type, completed) VALUES(?,?,?,?,?)", s.taskId, s.startAt, s.endAt, s.type, s.completed ? 1 : 0);
  }

  recordEvent(taskId: string, kind: EventKind, d: { fromDate?: string; fromSlot?: number; toDate?: string; toSlot?: number }, reason: EventReason): void {
    this.run("INSERT INTO assignment_event(task_id, at, kind, from_date, from_slot, to_date, to_slot, reason) VALUES(?,?,?,?,?,?,?,?)", taskId, this.clock.now(), kind, d.fromDate ?? null, d.fromSlot ?? null, d.toDate ?? null, d.toSlot ?? null, reason);
  }
}

// ---------------------------------------------------------------------- mappers
const parseRule = (s: string | null): RepeatRule | null => (s ? (JSON.parse(s) as RepeatRule) : null);

function mapBlock(r: Row): Block {
  return { slot: r.slot as Slot, name: r.name, startHour: r.start_hour, endHour: r.end_hour };
}
function mapRoutine(r: Row): RoutineItem {
  return { id: r.id, templateId: r.template_id, title: r.title, startMin: r.start_min, endMin: r.end_min, position: r.position, repeat: parseRule(r.repeat_rule) };
}
function mapTask(r: Row): Task {
  return { id: r.id, parentId: r.parent_id, projectId: r.project_id, deliverableId: r.deliverable_id, seriesId: r.series_id, title: r.title, notes: r.notes, estimatePomodoros: r.estimate_pomodoros, dueDate: r.due_date, status: r.status, createdAt: r.created_at, completedAt: r.completed_at };
}
function mapStep(r: Row): TaskStep {
  return { id: r.id, taskId: r.task_id, text: r.text, done: r.done === 1, position: r.position };
}
function mapAssignment(r: Row): Assignment {
  return { id: r.id, taskId: r.task_id, date: r.date, slot: r.slot as Slot, position: r.position, repeat: parseRule(r.repeat_rule), createdAt: r.created_at };
}
function mapProject(r: Row): Project {
  return { id: r.id, name: r.name, description: r.description, context: r.context, createdAt: r.created_at };
}
function mapDeliverable(r: Row): Deliverable {
  return { id: r.id, projectId: r.project_id, title: r.title, type: r.type, dueDate: r.due_date, status: r.status };
}
