import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TimerEngine } from "@mentem/core";
import { parseArgs } from "../src/args";
import { type Context, runCommand } from "../src/commands";
import { controlPath, dataDir } from "../src/dataDir";
import { at, makeStore, standardWeek } from "../../core/test/helpers";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function setup(now = at(2026, 11, 16, 9, 10)) {
  const ctx = makeStore(now);
  standardWeek(ctx.store);
  const files = new Map<string, string>();
  const sent: string[] = [];
  const dir = mkdtempSync(join(tmpdir(), "mentem-cli-"));
  dirs.push(dir);
  const context: Context = {
    store: ctx.store,
    engine: new TimerEngine(ctx.store, ctx.clock),
    backups: join(dir, "backups"),
    dbPath: join(dir, "mentem.db"),
    control: async (command) => {
      sent.push(command);
      return `Sent ${command}.`;
    },
    readFile: (path) => {
      const text = files.get(path);
      if (text === undefined) throw new Error("no file");
      return text;
    },
    writeFile: (path, text) => void files.set(path, text),
  };
  const run = (line: string) => runCommand(line.match(/"[^"]*"|\S+/g)?.map((w) => w.replace(/^"|"$/g, "")) ?? [], context);
  return { ...ctx, run, files, sent };
}

describe("reading the command line", () => {
  it("separates words from flags, repeats and bare flags", () => {
    const p = parseArgs(["task", "add", "Write it", "--step", "one", "--step=two", "--every-other", "--due", "fri"]);
    expect(p.words).toEqual(["task", "add", "Write it"]);
    expect(p.flags.get("step")).toEqual(["one", "two"]);
    expect(p.flags.get("every-other")).toEqual([""]);
    expect(p.flags.get("due")).toEqual(["fri"]);
  });

  it("finds the data folder for each system, and a test override", () => {
    expect(dataDir({ MENTEM_USER_DATA: "/x" }, "linux")).toBe("/x");
    expect(dataDir({ APPDATA: "C:\\Users\\a\\AppData\\Roaming" }, "win32")).toMatch(/mentem$/);
    expect(controlPath("/d", "linux")).toBe(join("/d", "mentem.sock"));
    expect(controlPath("/d", "win32")).toBe(String.raw`\\.\pipe\mentem-control`);
  });
});

describe("tasks", () => {
  it("adds, lists, completes, reopens and removes", async () => {
    const { run, store } = setup();
    const added = await run('task add "Write the report" --due tomorrow --est 3 --step "outline" --step "draft"');
    expect(added.code).toBe(0);
    const id = /Added (\w+):/.exec(added.out)![1]!;
    expect(store.getTask(id)).toMatchObject({ title: "Write the report", dueDate: "2026-11-17", estimatePomodoros: 3 });
    expect(store.listSteps(id).map((s) => s.text)).toEqual(["outline", "draft"]);
    expect((await run("task list")).out).toContain("Write the report");
    expect((await run(`task done ${id}`)).out).toBe("Done: Write the report");
    expect(store.getTask(id)!.status).toBe("done");
    expect((await run(`task list --status open`)).out).toBe("No tasks.");
    await run(`task reopen ${id}`);
    expect(store.getTask(id)!.status).toBe("open");
    await run(`task rm ${id}`);
    expect(store.getTask(id)).toBeUndefined();
  });

  it("accepts the start of an id, and says when it is ambiguous or unknown", async () => {
    const { run, store } = setup();
    const t = store.createTask({ title: "Only one" });
    expect((await run(`task done ${t.id.slice(0, 3)}`)).code).toBe(0);
    const none = await run("task done zzzz");
    expect(none).toEqual({ code: 1, out: 'No task with id "zzzz".' });
  });

  it("links a task to a project and a deliverable", async () => {
    const { run, store } = setup();
    await run('project add "Launch" --context "Warm tone"');
    await run('deliverable add --project Launch "Welcome flow" --type milestone --due 2026-12-01');
    const out = await run('task add "Draft email" --project Launch --deliverable "welcome flow"');
    expect(out.code).toBe(0);
    const shown = await run("project show Launch");
    expect(shown.out).toContain("Warm tone");
    expect(shown.out).toContain("milestone: Welcome flow (due 2026-12-01)");
    expect(shown.out).toContain("Draft email");
    expect((await run('task add "x" --project Nope')).out).toBe('No project called "Nope".');
    expect(store.listProjects()).toHaveLength(1);
  });
});

describe("placing tasks", () => {
  it("assigns, shows on today, moves and unassigns", async () => {
    const { run, store } = setup();
    const t = store.createTask({ title: "Plan" });
    expect((await run(`assign ${t.id} --date today --block Morning`)).out).toContain("Plan is now on 2026-11-16");
    const today = (await run("today")).out;
    expect(today).toContain("Morning 9:00-12:00");
    expect(today).toContain(`[ ] ${t.id}  Plan`);
    await run(`move ${t.id} --date wed --block afternoon`);
    expect(store.getAssignment(t.id)).toMatchObject({ date: "2026-11-18", slot: 2 });
    await run(`unassign ${t.id}`);
    expect(store.getAssignment(t.id)).toBeUndefined();
    expect((await run("unscheduled")).out).toContain("Plan");
  });

  it("refuses a day that has passed, a missing block and a bad date", async () => {
    const { run, store } = setup();
    const t = store.createTask({ title: "Plan" });
    expect((await run(`assign ${t.id} --date 2026-11-10 --block Morning`)).out).toBe("That day has passed.");
    expect((await run(`assign ${t.id} --date today --block Night`)).out).toContain('has no block called "Night". It has: Morning, Afternoon.');
    expect((await run(`assign ${t.id} --date sometime --block Morning`)).code).toBe(1);
    expect((await run(`assign ${t.id}`)).out).toBe("assign needs --date and --block.");
  });

  it("repeats a task every third day, makes the copies, and stops on request", async () => {
    const { run, store } = setup();
    const t = store.createTask({ title: "Water plants" });
    const out = await run(`assign ${t.id} --date today --block Morning --repeat daily --every 3`);
    expect(out.out).toContain("Every 3 days");
    expect(out.out).toContain("copies made");
    expect(store.getSeries(t.id)?.rule).toEqual({ interval: 3, unit: "day", anchor: "2026-11-16" });
    expect(store.blockTasks("2026-11-19", 1).map((x) => x.title)).toEqual(["Water plants"]);
    expect(store.blockTasks("2026-11-17", 1)).toEqual([]);
    expect((await run(`repeat ${t.id} off`)).out).toBe("Water plants no longer repeats.");
    expect(store.getSeries(t.id)?.active).toBe(false);
    expect((await run(`repeat ${t.id}`)).code).toBe(1);
    expect((await run(`assign ${t.id} --date today --block Morning --repeat daily --every 0`)).code).toBe(1);
  });

  it("stores a repeat rule", async () => {
    const { run, store } = setup();
    const t = store.createTask({ title: "Standup" });
    await run(`assign ${t.id} --date today --block Morning --repeat weekly --days mon,wed --every-other`);
    expect(store.getAssignment(t.id)!.repeat).toEqual({ interval: 2, unit: "week", anchor: "2026-11-16", weekdays: [0, 2] });
  });
});

describe("templates, schedule and settings", () => {
  it("builds a template, sets the week and a single day", async () => {
    const { run, store } = setup();
    expect((await run('template add "Night shift" --wake 11:00 --bed 23:30 --block Evening=19-23')).code).toBe(0);
    const night = store.listTemplates().find((t) => t.name === "Night shift")!;
    expect(night).toMatchObject({ wakeMin: 660, bedMin: 1410 });
    expect(night.blocks).toMatchObject([{ name: "Evening", startHour: 19, endHour: 23 }]);
    expect((await run('schedule set --days sat-sun --template "night shift"')).out).toBe("Night shift runs on sat sun.");
    expect(store.templateIdFor("2026-11-21")).toBe(night.id);
    const t = store.createTask({ title: "Move me" });
    store.assign(t.id, { date: "2026-11-17", slot: 1 });
    expect((await run('schedule set-day 2026-11-17 --template "Night shift"')).out).toContain("now uses Night shift");
    expect(store.templateIdFor("2026-11-17")).toBe(night.id);
    expect((await run("template list")).out).toContain("Night shift");
    await run('template rm "Night shift"');
    expect(store.listTemplates().map((x) => x.name)).not.toContain("Night shift");
  });

  it("changes settings and refuses nonsense", async () => {
    const { run, store } = setup();
    await run("config set week-end friday");
    await run("config set pomodoro 50 --break 10 --long-break 30");
    await run('config set app-name "My Day"');
    expect(store.getSettings()).toMatchObject({ weekEndDay: 4, pomodoroMinutes: 50, shortBreakMinutes: 10, longBreakMinutes: 30, appName: "My Day" });
    expect((await run("config set cli-name no_underscores")).code).toBe(1);
    expect((await run("config set pomodoro 0")).code).toBe(1);
    expect((await run("config set colour red")).code).toBe(1);
  });
});

describe("the day, the report and the timer", () => {
  it("shows what is running now", async () => {
    const { run, store } = setup();
    const t = store.createTask({ title: "Draft the email", steps: ["outline"] });
    store.assign(t.id, { date: "2026-11-16", slot: 1 });
    expect((await run("now")).out).toBe("Morning: Draft the email  15:00 left\nStep 1 of 1: outline");
  });

  it("prints the week and the report", async () => {
    const { run, store, clock } = setup();
    const t = store.createTask({ title: "Plan" });
    store.assign(t.id, { date: "2026-11-16", slot: 1 });
    store.setStatus(t.id, "done");
    expect((await run("week")).out).toContain("Monday 2026-11-16 (today)\n  Morning: ✓ Plan");
    clock.set(at(2026, 11, 23, 9, 0));
    const report = (await run("report")).out;
    expect(report).toContain("Planned 1, done 1");
    expect(report).toContain("Done on time: 100%");
  });

  it("sends timer commands to the app, and says so when it is not running", async () => {
    const { run, sent } = setup();
    expect((await run("pause")).out).toBe("Sent pause.");
    await run("skip");
    expect(sent).toEqual(["pause", "skip"]);
    const ctx = setup();
    const offline = await runCommand(["resume"], { ...({} as Context), control: async () => { throw new Error("Mentem isn't running. Open the app to control the timer."); } });
    expect(offline).toEqual({ code: 1, out: "Mentem isn't running. Open the app to control the timer." });
    expect(ctx.sent).toEqual([]);
  });
});

describe("data", () => {
  it("exports, then imports into a changed store, keeping a backup", async () => {
    const { run, store, files } = setup();
    store.createTask({ title: "Keep this" });
    expect((await run("export out.json")).out).toBe("Exported to out.json");
    expect(JSON.parse(files.get("out.json")!)).toMatchObject({ format: "mentem-export" });
    store.createTask({ title: "Added after" });
    const imported = await run("import out.json");
    expect(imported.code).toBe(0);
    expect(store.listTasks().map((t) => t.title)).toEqual(["Keep this"]);
    expect((await run("import missing.json")).out).toBe("That file isn't readable JSON.");
    files.set("bad.json", JSON.stringify({ nope: true }));
    expect((await run("import bad.json")).out).toBe("This is not a Mentem export.");
  });

  it("makes a backup file", async () => {
    const { run } = setup();
    const result = await run("backup");
    expect(result.code).toBe(0);
    expect(result.out).toMatch(/mentem-manual-\d+-v\d+\.db$/);
  });

  it("explains itself for unknown and empty commands", async () => {
    const { run } = setup();
    expect((await run("")).out).toContain("task add|list");
    expect(await run("dance")).toEqual({ code: 1, out: 'I don\'t know "dance". Run help to see the commands.' });
  });
});

describe("meetings", () => {
  it("adds, lists, shows on today, repeats and removes", async () => {
    const { run, store } = setup();
    const added = await run('meeting add "Standup" --from 9:10 --to 9:40 --with Sam --with Ola --link https://meet.example.com/x');
    expect(added.code).toBe(0);
    const id = /Added (\w+):/.exec(added.out)![1]!;
    expect(store.getMeeting(id)).toMatchObject({ title: "Standup", startMin: 550, endMin: 580, attendees: ["Sam", "Ola"], date: "2026-11-16" });
    expect((await run("meeting list")).out).toContain("9:10-9:40  Standup");
    expect((await run("today")).out).toContain("9:10-9:40  Meeting: Standup");
    await run(`meeting add "Retro" --from 14:00 --to 15:00 --date tomorrow --repeat weekly`);
    expect((await run("meeting list --date 2026-11-24")).out).toContain("Retro");
    const retro = store.listMeetings().find((m) => m.title === "Retro")!;
    expect((await run(`meeting rm ${retro.id} --date 2026-11-24`)).out).toBe("Removed Retro on 2026-11-24.");
    expect((await run("meeting list --date 2026-11-24")).out).toBe("No meetings on 2026-11-24.");
    expect((await run(`meeting rm ${id.slice(0, 3)}`)).out).toBe("Removed Standup.");
    expect(store.getMeeting(id)).toBeUndefined();
  });

  it("takes a place for in-person meetings, and keeps minutes for each day", async () => {
    const { run, store } = setup();
    const added = await run('meeting add "Offsite" --from 10:00 --to 11:00 --place "Room 2" --repeat daily');
    const id = /Added (\w+):/.exec(added.out)![1]!;
    expect(store.getMeeting(id)).toMatchObject({ kind: "in-person", place: "Room 2", link: null });
    expect((await run("meeting list")).out).toContain("Offsite (Room 2)");
    expect((await run(`meeting minutes ${id}`)).out).toBe("No minutes for Offsite on 2026-11-16.");
    expect((await run(`meeting minutes ${id} Agreed the plan`)).out).toBe("Saved the minutes for Offsite on 2026-11-16.");
    expect((await run(`meeting minutes ${id}`)).out).toBe("Agreed the plan");
    expect((await run(`meeting minutes ${id} --date tomorrow`)).out).toContain("No minutes");
  });

  it("explains what is missing or wrong", async () => {
    const { run } = setup();
    expect((await run("meeting add")).code).toBe(1);
    expect((await run('meeting add "X" --from 9:00')).out).toContain("--from and --to");
    expect((await run('meeting add "X" --from 10:00 --to 9:00')).out).toContain("end after");
    expect((await run('meeting add "X" --from 9:00 --to 10:00 --link javascript:1')).out).toContain("https://");
  });
});
