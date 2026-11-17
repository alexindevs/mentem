import type * as Core from "@mentem/core";
import type { Store } from "@mentem/core";
import type { Api } from "../shared/api";

/**
 * Development only. Fills an empty data folder with the sample day from the designs so a
 * screen can be checked at a known time: MENTEM_SEED=base|empty|overlap|complete.
 * Never runs in a packaged app.
 */
export async function seedSampleDay(variant: string, api: Api, store: Store, core: typeof Core): Promise<void> {
  const at = (hour: number, minute = 0) => hour * 60 + minute;
  await api.onboardingComplete({
    userName: "Alex",
    appName: "Mentem",
    cliName: "mentem",
    workStyle: "full-time",
    wakeMin: at(7),
    bedMin: at(23),
    routine: [
      { title: "Morning walk", startMin: at(7, 30), endMin: at(8) },
      { title: "Lunch", startMin: at(12, 30), endMin: at(13) },
      { title: "Dinner", startMin: at(19, 30), endMin: at(20, 30) },
    ],
    blocks: [
      { name: "Morning", startHour: 9, endHour: 12 },
      { name: "Afternoon", startHour: variant === "overlap" ? 12 : 13, endHour: 17 },
    ],
    templateName: "Weekday",
    weekdays: [0, 1, 2, 3, 4],
    weekEndDay: 6,
    pomodoro: { focus: 25, short: 5, long: 15, cycles: 4 },
    alerts: { sound: true, notifications: true, tray: true, startOnLogin: true, weekPopups: true },
    theme: "white-green",
    matchSystem: false,
  });

  const today = core.dateOf(store.clock.now());
  const monday = core.addDays(today, -core.weekdayOf(today));
  const project = store.createProject({ name: "Launch" });
  const welcome = store.addDeliverable(project.id, { title: "Welcome flow", type: "deliverable" });
  const done = variant === "complete";

  const place = (title: string, slot: 1 | 2, extra: Parameters<Store["createTask"]>[0] = { title }) => {
    const task = store.createTask({ ...extra, title });
    store.assign(task.id, { date: today, slot });
    if (done) store.setStatus(task.id, "done");
    return task;
  };

  if (variant !== "empty") {
    const invoice = place("Send invoice to client", 1);
    store.setStatus(invoice.id, "done");
    const draft = place("Draft the onboarding email", 1, {
      title: "",
      projectId: project.id,
      deliverableId: welcome.id,
      steps: ["Outline the email", "Write the subject line", "Write the body"],
    });
    const first = store.currentStep(draft.id);
    if (first) store.setStepDone(first.step.id, true);
    place("Review pricing page", 1, { title: "", dueDate: today });
  }
  place("Reply to design feedback", 2);
  place("Update the style guide", 2);
  place("Draft release notes", 2);
  if (done) place("Book the flights", 2);

  store.createTask({ title: "Plan next sprint" });
  store.createTask({ title: "Update pricing copy", dueDate: core.addDays(today, 2) });
  store.createTask({ title: "Book dentist" });
  store.createTask({ title: "Read the API docs" });

  if (variant === "history") seedHistory(store);

  for (const name of ["Weekend", "Out but working at night"]) store.createTemplate({ name, wakeMin: at(8), bedMin: at(23), blocks: [] });
  void monday;
}

/** Past weeks of activity, written straight to the history tables, so a report has something to show. */
function seedHistory(store: Store): void {
  const at = (date: string, hour: number) => new Date(`${date}T${String(hour).padStart(2, "0")}:00:00`).getTime();
  const event = (task: string, when: number, kind: string, from: string | null, fromSlot: number | null, to: string | null, toSlot: number | null, reason = "manual") =>
    store.db.prepare("INSERT INTO assignment_event(task_id, at, kind, from_date, from_slot, to_date, to_slot, reason) VALUES(?,?,?,?,?,?,?,?)").run(task, when, kind, from, fromSlot, to, toSlot, reason);
  const make = (title: string, completedAt: number | null) => {
    const task = store.createTask({ title });
    if (completedAt !== null) store.db.prepare("UPDATE task SET status = 'done', completed_at = ? WHERE id = ?").run(completedAt, task.id);
    return task.id;
  };
  const day = (n: number) => `2026-11-${String(n).padStart(2, "0")}`;

  // The week before (9 - 15 November): four planned, all done on the day.
  for (const [title, d] of [["Plan sprint", 9], ["Client call prep", 10], ["Write post", 11], ["Book flights", 12]] as const) {
    const id = make(title, at(day(d), 15));
    event(id, at(day(d), 8), "assigned", null, null, day(d), 1);
  }

  // This week (16 - 22 November).
  const pricing = make("Review pricing page", at(day(18), 11));
  event(pricing, at(day(16), 8), "assigned", null, null, day(16), 1);
  event(pricing, at(day(16), 23), "rolled", day(16), 1, day(18), 1, "rollover");
  const reply = make("Reply to design feedback", at(day(17), 14));
  event(reply, at(day(16), 8), "assigned", null, null, day(16), 2);
  event(reply, at(day(16), 23), "rolled", day(16), 2, day(17), 2, "rollover");
  const guide = make("Update the style guide", null);
  event(guide, at(day(17), 8), "assigned", null, null, day(17), 2);
  event(guide, at(day(17), 23), "rolled", day(17), 2, day(19), 2, "rollover");
  event(guide, at(day(19), 23), "rolled", day(19), 2, day(20), 2, "rollover");
  const invoice = make("Send invoice", at(day(16), 10));
  event(invoice, at(day(16), 8), "assigned", null, null, day(16), 1);
  for (const title of ["Draft email", "Client call prep", "Pricing copy"]) {
    const id = make(title, at(day(17), 11));
    event(id, at(day(17), 8), "assigned", null, null, day(17), 1);
  }
  const notes = make("Draft release notes", null);
  event(notes, at(day(18), 8), "assigned", null, null, day(18), 2);

  // Timer sessions for the Sessions tab, on the last day of the week and the day before.
  const session = (date: string, h: number, m: number, minutes: number, type: "work" | "break", title: string | null) => {
    const task = title ? make(title, null) : null;
    const start = at(date, h) + m * 60_000;
    store.recordSession({ taskId: task, startAt: start, endAt: start + minutes * 60_000, type, completed: true });
  };
  session(day(21), 13, 0, 25, "work", "Reply to design feedback");
  session(day(21), 13, 25, 5, "break", null);
  session(day(22), 9, 0, 25, "work", "Draft the onboarding email");
  session(day(22), 9, 25, 5, "break", null);
  session(day(22), 9, 30, 25, "work", "Draft the onboarding email");
}
