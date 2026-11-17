import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { isTyping, shortcutFor } from "../lib/shortcuts";
import { TaskDrawer } from "./drawer/TaskDrawer";
import { Sidebar, type Page } from "./today/Sidebar";
import { Today } from "./today/Today";
import type { Settings as AppSettings } from "@mentem/core";
import { Planning } from "./planning/Planning";
import { Projects } from "./projects/Projects";
import { Reports } from "./reports/Reports";
import { WeeklyPrompt } from "./reports/WeeklyPrompt";
import { Settings } from "./settings/Settings";
import { Meetings } from "./meetings/Meetings";
import { MeetingDrawer, type MeetingTarget } from "./drawer/MeetingDrawer";
import { Templates } from "./templates/Templates";
import { Toast, type ToastMessage } from "./Toast";
import { Week } from "./week/Week";

const ease = [0.16, 1, 0.3, 1] as const;

/** The sidebar, the page beside it, and what floats above both: the task drawer and messages. */
export function Shell({ settings, onSettings, onRunSetup }: { settings: AppSettings; onSettings(settings: AppSettings): void; onRunSetup(): void }) {
  const [page, setPage] = useState<Page>("Today");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [meeting, setMeeting] = useState<MeetingTarget | null>(null);
  const [tick, setTick] = useState(0);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [reportWeek, setReportWeek] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);
  const changed = useCallback(() => setTick((n) => n + 1), []);
  const closeToast = useCallback(() => setToast(null), []);
  const closeDrawer = useCallback(() => setTaskId(null), []);
  const closeMeeting = useCallback(() => setMeeting(null), []);
  const reportShown = useCallback(() => setReportWeek(null), []);
  const [quickAdd, setQuickAdd] = useState(0);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const covered = document.querySelector('[role="dialog"], [role="alertdialog"]') !== null;
      const action = shortcutFor(event, isTyping(event.target), covered);
      if (!action) return;
      event.preventDefault();
      if (action.type === "page") setPage(action.page);
      else if (action.type === "quick-add") {
        setPage("Today");
        setQuickAdd((n) => n + 1);
      } else if (action.type === "meeting") {
        const now = new Date();
        setMeeting({ id: null, date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}` });
      } else if (action.type === "done") void window.mentem.timerAct("done").then(changed);
      else void window.mentem.timerGet().then((view) => window.mentem.timerAct(view.paused ? "resume" : "pause"));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [changed]);

  return (
    <main className="today">
      <Sidebar appName={settings.appName} page={page} onNavigate={setPage} />
      <section className="today__main">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={page} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: { duration: 0.22, ease } }} exit={{ opacity: 0, transition: { duration: 0.12 } }}>
            {page === "Today" && <Today quickAdd={quickAdd} hideDone={settings.hideDoneTasks} onOpenMeeting={setMeeting} tick={tick} onOpenTask={setTaskId} onChange={changed} />}
            {page === "Week" && <Week hideDone={settings.hideDoneTasks} onOpenMeeting={setMeeting} tick={tick} onOpenTask={setTaskId} onToast={setToast} onChange={changed} />}
            {page === "Templates" && <Templates onToast={setToast} onChange={changed} />}
            {page === "Meetings" && <Meetings tick={tick} onOpenMeeting={setMeeting} />}
            {page === "Projects" && <Projects tick={tick} onOpenTask={setTaskId} onChange={changed} />}
            {page === "Reports" && <Reports initialWeek={reportWeek} onWeekShown={reportShown} />}
            {page === "Settings" && <Settings settings={settings} onSettings={onSettings} onRunSetup={onRunSetup} />}
          </motion.div>
        </AnimatePresence>
      </section>
      <MeetingDrawer target={meeting} onClose={closeMeeting} onChange={changed} />
      <TaskDrawer taskId={taskId} onClose={closeDrawer} onChange={changed} onWorkOn={(id) => void window.mentem.taskFocus(id).then(closeDrawer)} />
      <WeeklyPrompt tick={tick} active={page === "Today" && !taskId && !meeting && !planning} onViewReport={(week) => { setReportWeek(week); setPage("Reports"); }} onPlan={() => setPlanning(true)} />
      <AnimatePresence>{planning && <Planning onClose={() => { setPlanning(false); changed(); }} onEditTemplates={() => { setPlanning(false); setPage("Templates"); }} />}</AnimatePresence>
      <Toast message={toast} onDone={closeToast} />
    </main>
  );
}
