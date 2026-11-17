# Mentem

A desktop planner and focus timer built around how an ADHD brain works: continuous pomodoros through your work blocks, the current task always on screen, and a day you can reshape without starting over.

## What it does

- **Continuous pomodoros** through each work block, with short and long breaks, and the current task and step always visible.
- **Day templates**: wake and bed times, routine items, and work blocks. Apply a template per weekday, or adjust a single day.
- **Tasks** with steps, due dates, estimates, projects and deliverables. Anything not placed on a day sits in **Unscheduled**.
- **Repeats**: every day, every few days, certain weekdays, monthly or yearly.
- **Rollover** of unfinished work, and a **weekly report and planning** flow.
- **Mini window**, tray icon and notifications, so the timer stays in view without the main window.
- Four themes, and a first-run setup that builds your day.
- A **command line** that reads and changes the same data.

All data stays on your machine in a local SQLite database, with automatic snapshots, manual backups and JSON export and import.

## Packages

| Package | Purpose |
| --- | --- |
| `packages/core` | Data layer and timer engine: store, migrations, repeats, reports |
| `packages/desktop` | Electron app (React) |
| `packages/cli` | The `mentem` command line |

## Getting started

Requires Node 22 and pnpm.

```bash
pnpm install
pnpm --filter @mentem/desktop start
```

That runs the desktop app in development with reload.

## Scripts

```bash
pnpm test        # all packages
pnpm typecheck
pnpm lint
```

## Command line

The app installs a `mentem` launcher on first run. A few examples:

```bash
mentem today
mentem task add "Write the report" --due fri --est 3
mentem assign <id> --date today --block Morning
mentem pause
mentem report
```

Run `mentem help` for every command.
