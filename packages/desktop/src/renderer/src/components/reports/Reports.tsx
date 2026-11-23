import { useEffect, useState } from "react";
import type { ReportDetail, ReportSummary, SessionsData } from "@shared/api";
import { Pill } from "../ui";

type Tab = "Weekly" | "Sessions";
type Section = "planned" | "done" | "rescheduled" | "unfinished";
const SECTIONS: Array<{ id: Section; label: string }> = [
  { id: "planned", label: "Planned" },
  { id: "done", label: "Done" },
  { id: "rescheduled", label: "Rescheduled" },
  { id: "unfinished", label: "Unfinished" },
];

const SEEN_KEY = "reports-seen";
export function readSeen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}
export function markSeen(weekStart: string): void {
  try {
    const seen = readSeen();
    seen.add(weekStart);
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
  } catch {
    /* it just shows as new again */
  }
}

const levelChip = (level: ReportSummary["level"]) => (level === "Low" ? "chip chip--accent-outline" : level === "High" ? "chip chip--danger" : "chip");
const changeText = (change: number | null) => (change === null ? "first week" : change === 0 ? "same as last week" : `${change < 0 ? "down" : "up"} ${Math.abs(change)} pts`);

function Stat({ label, big, small, chip, tone }: { label: string; big: string; small: string; chip?: string | null; tone?: "accent" }) {
  return (
    <div className="stat">
      <span className="t-label muted">{label}</span>
      <span className="t-h-xl stat__big accent-text">{big}</span>
      <span className="stat__small t-caption muted">
        {chip && <span className={`chip ${tone === "accent" ? "chip--accent-outline" : ""}`}>{chip}</span>}
        {small}
      </span>
    </div>
  );
}

function Detail({ weekStart, onBack }: { weekStart: string; onBack(): void }) {
  const [report, setReport] = useState<ReportDetail | null>(null);
  const [section, setSection] = useState<Section>("rescheduled");
  useEffect(() => {
    markSeen(weekStart);
    void window.mentem.reportGet(weekStart).then((r) => {
      setReport(r);
      setSection(r.rescheduled > 0 ? "rescheduled" : "planned");
    });
  }, [weekStart]);
  if (!report) return null;
  const p = report.procrastination;
  const counts: Record<Section, number> = { planned: report.planned, done: report.done, rescheduled: report.rescheduled, unfinished: report.unfinished };
  return (
    <>
      <header className="page-header">
        <div className="page-header__title">
          <button className="icon-button" aria-label="Back to reports" onClick={onBack}>
            ‹
          </button>
          <h1 className="t-h-l">{report.label}</h1>
          {report.inProgress && <span className="chip chip--accent-outline">In progress</span>}
        </div>
      </header>
      <div className="stats stats--big">
        <Stat label="Done on time" big={`${report.onTimePct}%`} small={`${report.onTimeCount} of ${report.planned} planned`} />
        <Stat label="Procrastination" big={p.level} small={p.previousPct === null ? "" : `last week ${p.previousPct}%`} chip={p.change === null ? "first week" : changeText(p.change)} tone="accent" />
        <Stat label="Planned" big={String(report.planned)} small={`${report.done} done · ${report.unfinished} unfinished`} />
      </div>
      <div className="stats stats--small">
        <div className="stat stat--card">
          <span className="t-label muted">Most rescheduled</span>
          {report.mostRescheduled ? (
            <>
              <span className="t-body-m-strong">{report.mostRescheduled.title}</span>
              <span className="t-caption muted">Moved {report.mostRescheduled.times} {report.mostRescheduled.times === 1 ? "time" : "times"}</span>
            </>
          ) : (
            <span className="t-caption muted">Nothing was pushed</span>
          )}
        </div>
        <div className="stat stat--card">
          <span className="t-label muted">Best time</span>
          {report.bestTime ? (
            <>
              <span className="t-h-m accent-text">{report.bestTime.label}</span>
              <span className="t-caption muted">{report.bestTime.onTime} of {report.bestTime.total} done on time</span>
            </>
          ) : (
            <span className="t-caption muted">Not enough tasks yet</span>
          )}
        </div>
        <div className="stat stat--card">
          <span className="t-label muted">Streak</span>
          <span className="t-h-m accent-text">{report.streak.current} {report.streak.current === 1 ? "day" : "days"}</span>
          <span className="t-caption muted">All planned done · best {report.streak.best}</span>
        </div>
      </div>
      <div className="pills report__pills">
        {SECTIONS.map((s) => (
          <Pill key={s.id} selected={section === s.id} onClick={() => setSection(s.id)}>
            {s.label} {counts[s.id]}
          </Pill>
        ))}
      </div>
      <ul className="task-list">
        {report.lists[section].map((t) => (
          <li key={t.id} className={`task-row ${t.done ? "task-row--done" : ""}`}>
            <span className="task-row__check" aria-hidden="true">
              {t.done && (
                <svg width="12" height="12" viewBox="0 0 12 12">
                  <path d="M2.5 6.2 5 8.6 9.5 3.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
            <span className="task-row__title">{t.title}</span>
            {t.move && section === "rescheduled" && <span className="chip">{t.move}</span>}
          </li>
        ))}
        {report.lists[section].length === 0 && <p className="t-body-m muted">Nothing here.</p>}
      </ul>
    </>
  );
}

function Weekly({ onOpen }: { onOpen(weekStart: string): void }) {
  const [reports, setReports] = useState<ReportSummary[] | null>(null);
  useEffect(() => void window.mentem.reportsGet().then(setReports), []);
  if (!reports) return null;
  const seen = readSeen();
  if (reports.length === 0) return <p className="t-body-l muted">Your first report appears once you've planned a week.</p>;
  return (
    <div className="report-list">
      {reports.map((r) => (
        <button key={r.weekStart} className="report-row" onClick={() => onOpen(r.weekStart)}>
          <span className="report-row__week">
            <span className="t-h-m">{r.label}</span>
            <span className="t-caption muted">
              {r.planned} planned · {r.done} done
            </span>
          </span>
          <span className="report-row__time">
            <span className="t-h-m">{r.onTimePct}%</span>
            <span className="t-caption muted">done on time</span>
          </span>
          <span className="report-row__level">
            <span className={levelChip(r.level)}>{r.level}</span>
            <span className="t-caption muted">{changeText(r.change)}</span>
          </span>
          {!seen.has(r.weekStart) && <span className="report-row__dot" aria-label="New" />}
          <span className="report-row__arrow" aria-hidden="true">
            ›
          </span>
        </button>
      ))}
    </div>
  );
}

function Sessions() {
  const [data, setData] = useState<SessionsData | null>(null);
  useEffect(() => void window.mentem.sessionsGet().then(setData), []);
  if (!data) return null;
  const focus = `${Math.floor(data.focusMinutes / 60)}h ${String(data.focusMinutes % 60).padStart(0, "0")}m`;
  return (
    <>
      <div className="session-stats">
        <div>
          <span className="t-h-l accent-text">{data.focusMinutes >= 60 ? focus : `${data.focusMinutes}m`}</span>
          <span className="t-caption muted">focused today</span>
        </div>
        <div>
          <span className="t-h-l accent-text">{data.pomodoros}</span>
          <span className="t-caption muted">pomodoros</span>
        </div>
        <div>
          <span className="t-h-l accent-text">{data.tasksDone}</span>
          <span className="t-caption muted">tasks done</span>
        </div>
      </div>
      {data.days.length === 0 ? (
        <p className="t-body-l muted">Sessions show here once the timer has run.</p>
      ) : (
        <div className="group session-list">
          {data.days.map((day) => (
            <div key={day.label}>
              <div className="session-day t-body-m-strong">{day.label}</div>
              {day.rows.map((r, i) => (
                <div key={i} className="session-row">
                  <span className="t-body-m muted session-row__time">{r.time}</span>
                  <span className={`session-row__title ${r.kind === "work" ? "t-body-m-strong" : "t-body-m muted"}`}>{r.kind === "work" ? (r.title ?? "Focus") : "Break"}</span>
                  <span className={r.kind === "work" ? "chip chip--accent-outline" : "chip"}>{r.kind === "work" ? "Work" : "Break"}</span>
                  <span className="t-body-m muted session-row__min">{r.minutes} min</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export function Reports({ initialWeek, onWeekShown }: { initialWeek: string | null; onWeekShown(): void }) {
  const [tab, setTab] = useState<Tab>("Weekly");
  const [open, setOpen] = useState<string | null>(initialWeek);
  useEffect(() => {
    if (initialWeek) {
      setOpen(initialWeek);
      onWeekShown();
    }
  }, [initialWeek, onWeekShown]);
  if (open) return <Detail weekStart={open} onBack={() => setOpen(null)} />;
  return (
    <>
      <header className="page-header">
        <div className="page-header__title">
          <h1 className="t-h-l">Reports</h1>
          <div className="pills">
            {(["Weekly", "Sessions"] as Tab[]).map((t) => (
              <Pill key={t} selected={tab === t} onClick={() => setTab(t)}>
                {t}
              </Pill>
            ))}
          </div>
        </div>
      </header>
      {tab === "Weekly" ? <Weekly onOpen={setOpen} /> : <Sessions />}
    </>
  );
}
