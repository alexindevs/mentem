import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { RepeatRule, Slot, TaskStatus, DeliverableType, EventKind, EventReason } from "../types";

/**
 * Typed mirror of the tables created by the migrations. The migrations stay the source of
 * truth for the database shape; this file lets queries be built with the query builder, so
 * values are always bound parameters and no SQL is assembled from strings.
 */
export const setting = sqliteTable("setting", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const dayTemplate = sqliteTable("day_template", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  wakeMin: integer("wake_min").notNull(),
  bedMin: integer("bed_min").notNull(),
});

export const templateBlock = sqliteTable(
  "template_block",
  {
    templateId: text("template_id").notNull(),
    slot: integer("slot").$type<Slot>().notNull(),
    name: text("name").notNull(),
    startHour: integer("start_hour").notNull(),
    endHour: integer("end_hour").notNull(),
  },
  (t) => [primaryKey({ columns: [t.templateId, t.slot] })],
);

export const routineItem = sqliteTable("routine_item", {
  id: text("id").primaryKey(),
  templateId: text("template_id").notNull(),
  title: text("title").notNull(),
  startMin: integer("start_min").notNull(),
  endMin: integer("end_min"),
  position: integer("position").notNull(),
  repeat: text("repeat_rule", { mode: "json" }).$type<RepeatRule | null>(),
});

export const scheduleRule = sqliteTable("schedule_rule", {
  weekday: integer("weekday").primaryKey(),
  templateId: text("template_id").notNull(),
});

export const dateTemplate = sqliteTable("date_template", {
  date: text("date").primaryKey(),
  templateId: text("template_id").notNull(),
});

export const project = sqliteTable("project", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  context: text("context").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const deliverable = sqliteTable("deliverable", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  title: text("title").notNull(),
  type: text("type").$type<DeliverableType>().notNull(),
  dueDate: text("due_date"),
  status: text("status").$type<"open" | "done">().notNull(),
});

export const task = sqliteTable("task", {
  id: text("id").primaryKey(),
  parentId: text("parent_id"),
  projectId: text("project_id"),
  deliverableId: text("deliverable_id"),
  seriesId: text("series_id"),
  title: text("title").notNull(),
  notes: text("notes").notNull(),
  estimatePomodoros: integer("estimate_pomodoros"),
  dueDate: text("due_date"),
  status: text("status").$type<TaskStatus>().notNull(),
  createdAt: integer("created_at").notNull(),
  completedAt: integer("completed_at"),
});

export const taskStep = sqliteTable("task_step", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull(),
  text: text("text").notNull(),
  done: integer("done", { mode: "boolean" }).notNull(),
  position: integer("position").notNull(),
});

export const assignment = sqliteTable("assignment", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull(),
  date: text("date").notNull(),
  slot: integer("slot").$type<Slot>().notNull(),
  position: integer("position").notNull(),
  repeat: text("repeat_rule", { mode: "json" }).$type<RepeatRule | null>(),
  createdAt: integer("created_at").notNull(),
});

export const assignmentEvent = sqliteTable("assignment_event", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  taskId: text("task_id").notNull(),
  at: integer("at").notNull(),
  kind: text("kind").$type<EventKind>().notNull(),
  fromDate: text("from_date"),
  fromSlot: integer("from_slot"),
  toDate: text("to_date"),
  toSlot: integer("to_slot"),
  reason: text("reason").$type<EventReason>().notNull(),
});

export const session = sqliteTable("session", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  taskId: text("task_id"),
  startAt: integer("start_at").notNull(),
  endAt: integer("end_at").notNull(),
  type: text("type").$type<"work" | "break">().notNull(),
  completed: integer("completed", { mode: "boolean" }).notNull(),
});

export const rolloverLog = sqliteTable(
  "rollover_log",
  {
    date: text("date").notNull(),
    slot: integer("slot").$type<Slot>().notNull(),
    processedAt: integer("processed_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.date, t.slot] })],
);

export const meeting = sqliteTable("meeting", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  date: text("date").notNull(),
  startMin: integer("start_min").notNull(),
  endMin: integer("end_min").notNull(),
  kind: text("kind").$type<"online" | "in-person">().notNull(),
  link: text("link"),
  place: text("place"),
  notes: text("notes").notNull(),
  attendees: text("attendees", { mode: "json" }).$type<string[]>().notNull(),
  repeat: text("repeat_rule", { mode: "json" }).$type<RepeatRule | null>(),
  createdAt: integer("created_at").notNull(),
});

export const meetingSkip = sqliteTable(
  "meeting_skip",
  {
    meetingId: text("meeting_id").notNull(),
    date: text("date").notNull(),
  },
  (t) => [primaryKey({ columns: [t.meetingId, t.date] })],
);

export const meetingMinutes = sqliteTable(
  "meeting_minutes",
  {
    meetingId: text("meeting_id").notNull(),
    date: text("date").notNull(),
    text: text("text").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.meetingId, t.date] })],
);
