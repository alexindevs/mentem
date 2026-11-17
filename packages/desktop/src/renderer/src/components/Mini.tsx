import { useEffect, useState } from "react";
import type { Settings } from "@mentem/core";
import type { TimerView } from "@shared/api";
import { formatClock } from "../lib/time";
import { useAppliedTheme } from "../lib/theme";
import { isTicking, useNow, useTimer } from "../lib/useTimer";

const share = (remaining: number, total: number) => (total > 0 ? Math.min(1, Math.max(0, 1 - remaining / total)) : 0);

function Row({ label, title, ms, value, small }: { label: string; title: string; ms: number | null; value: number | null; small?: boolean }) {
  return (
    <div className={`mini__row ${small ? "mini__row--small" : ""}`}>
      <div className="mini__text">
        <span className="t-label mini__label">{label}</span>
        <span className="mini__title">{title}</span>
      </div>
      {ms !== null && <span className="t-timer mini__clock">{formatClock(ms)}</span>}
      {value !== null && (
        <div className="mini__meter">
          <span style={{ width: `${value * 100}%` }} />
        </div>
      )}
    </div>
  );
}

function rowsOf(view: TimerView, now: number, at: number) {
  const left = view.paused || view.endsAt === null ? view.remainingMs : Math.max(0, view.endsAt - now);
  const rows: Array<{ key: string; label: string; title: string; ms: number | null; value: number | null }> = [];
  if (view.kind === "work" || view.kind === "break") {
    const isBreak = view.kind === "break";
    rows.push({ key: "block", label: isBreak ? "Break" : "Now", title: isBreak ? (view.breakKind === "long" ? "Long break" : "Short break") : (view.emptyBlock ? "Nothing assigned" : (view.task?.title ?? view.blockName ?? "")), ms: left, value: share(left, view.totalMs) });
  }
  if (view.meeting) {
    const ms = Math.max(0, view.meeting.endsAt - now);
    rows.push({ key: `m-${view.meeting.id}`, label: "Meeting", title: view.meeting.title, ms, value: share(ms, view.meeting.totalMs) });
  }
  for (const r of view.routine) {
    const ms = r.endsAt === null ? r.remainingMs : Math.max(0, r.endsAt - now);
    rows.push({ key: `r-${r.title}`, label: "Routine", title: r.title, ms, value: share(ms, r.totalMs) });
  }
  if (rows.length === 0) {
    if (view.kind === "between" && view.nextBlock) {
      const ms = Math.max(0, (view.startsInMs ?? 0) - (now - at));
      rows.push({ key: "next", label: "Up next", title: view.nextBlock.name, ms, value: null });
    } else {
      rows.push({ key: "idle", label: "Today", title: view.dayComplete ? "Day complete" : view.kind === "rest" ? "Rest" : view.kind === "no-template" ? "No template" : "Nothing running", ms: null, value: null });
    }
  }
  return rows;
}

/** The always-on-top mini window: what is running and how long is left, nothing else. */
export function Mini() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const snapshot = useTimer();
  const now = useNow(isTicking(snapshot?.view ?? null), snapshot?.offset ?? 0);
  useEffect(() => {
    document.documentElement.classList.add("mini-window");
    void window.mentem.settingsGet().then(setSettings);
  }, []);
  useAppliedTheme(settings?.theme ?? "white-green", settings?.matchSystem ?? false);
  if (!snapshot) return null;
  const rows = rowsOf(snapshot.view, now, snapshot.at);
  return (
    <div className="mini" role="status" aria-live="off">
      {rows.map((r) => (
        <Row key={r.key} label={r.label} title={r.title} ms={r.ms} value={rows.length === 1 ? r.value : null} small={rows.length > 1} />
      ))}
      <button className="mini__close" aria-label="Close mini window" onClick={() => window.close()}>
        ×
      </button>
    </div>
  );
}
