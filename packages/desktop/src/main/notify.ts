import type { TimerView } from "../shared/api";

export interface Message {
  title: string;
  body: string;
}

const minutes = (ms: number) => Math.max(1, Math.round(ms / 60_000));
const clockText = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

/**
 * What to tell the person when the timer moves to something new (FR-29). Returns null when
 * nothing worth a nudge happened: pausing, the clock ticking, or the app just opening.
 */
export function describeTransition(prev: TimerView | null, next: TimerView): Message | null {
  if (!prev) return null;

  if (next.dayComplete && !prev.dayComplete) return { title: "Day complete", body: "Everything you planned is done." };

  if (next.kind === "break" && prev.kind !== "break") {
    const long = next.breakKind === "long";
    return { title: long ? "Long break" : "Break time", body: `${minutes(next.totalMs)} min.${next.nextTask ? ` Next: ${next.nextTask}` : ""}` };
  }

  if (next.kind === "work" && prev.kind === "work" && prev.blockName !== next.blockName && next.blockName) {
    return { title: `${next.blockName} starts`, body: next.emptyBlock ? "Nothing assigned yet." : (next.task?.title ?? "") };
  }

  if (next.kind === "work" && prev.kind !== "work") {
    if (prev.blockName !== next.blockName || prev.kind === "between" || prev.kind === "rest" || prev.kind === "routine" || prev.kind === "no-template") {
      return { title: next.blockName ? `${next.blockName} starts` : "Back to work", body: next.emptyBlock ? "Nothing assigned yet." : (next.task?.title ?? "") };
    }
    return { title: "Back to work", body: next.task?.title ?? "" };
  }

  const started = next.routine.filter((r) => !prev.routine.some((p) => p.title === r.title));
  if (started.length > 0 && next.kind !== "break") {
    const r = started[0]!;
    return { title: r.title, body: r.endsAt === null ? "Now." : `Until ${new Date(r.endsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.` };
  }

  return null;
}

/** The line shown when hovering the tray icon. */
export function trayTooltip(appName: string, view: TimerView | null, now: number): string {
  if (!view) return appName;
  if (view.kind === "work" || view.kind === "break") {
    const left = view.paused || view.endsAt === null ? view.remainingMs : Math.max(0, view.endsAt - now);
    const what = view.kind === "break" ? "Break" : (view.task?.title ?? view.blockName ?? "Working");
    return `${appName} · ${what} · ${clockText(left)}${view.paused ? " (paused)" : ""}`;
  }
  const r = view.routine[0];
  if (r) return `${appName} · ${r.title}`;
  if (view.kind === "between" && view.nextBlock) return `${appName} · Next: ${view.nextBlock.name}`;
  if (view.kind === "rest") return `${appName} · Rest`;
  return appName;
}

/** Height of the always-on-top mini window: one row, or two when a routine item overlaps. */
export function miniHeight(view: TimerView | null): number {
  return view && view.routine.length > 0 && (view.kind === "work" || view.kind === "break") ? 124 : 92;
}
