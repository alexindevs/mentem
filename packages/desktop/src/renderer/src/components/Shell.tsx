import { AnimatePresence, motion } from "motion/react";
import { useCallback, useState } from "react";
import { TaskDrawer } from "./drawer/TaskDrawer";
import { Sidebar, type Page } from "./today/Sidebar";
import { Today } from "./today/Today";
import type { Settings as AppSettings } from "@mentem/core";
import { Planning } from "./planning/Planning";
import { Projects } from "./projects/Projects";
import { Reports } from "./reports/Reports";
import { WeeklyPrompt } from "./reports/WeeklyPrompt";
import { Settings } from "./settings/Settings";
import { Templates } from "./templates/Templates";
import { Toast, type ToastMessage } from "./Toast";
import { Week } from "./week/Week";

const ease = [0.16, 1, 0.3, 1] as const;

/** The sidebar, the page beside it, and what floats above both: the task drawer and messages. */
export function Shell({ settings, onSettings, onRunSetup }: { settings: AppSettings; onSettings(settings: AppSettings): void; onRunSetup(): void }) {
  const [page, setPage] = useState<Page>("Today");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [reportWeek, setReportWeek] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);
  const changed = useCallback(() => setTick((n) => n + 1), []);
  const closeToast = useCallback(() => setToast(null), []);
  const closeDrawer = useCallback(() => setTaskId(null), []);
  const reportShown = useCallback(() => setReportWeek(null), []);

  return (
    <main className="today">
      <Sidebar appName={settings.appName} page={page} onNavigate={setPage} />
      <section className="today__main">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={page} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: { duration: 0.22, ease } }} exit={{ opacity: 0, transition: { duration: 0.12 } }}>
            {page === "Today" && <Today tick={tick} onOpenTask={setTaskId} onChange={changed} />}
            {page === "Week" && <Week tick={tick} onOpenTask={setTaskId} onToast={setToast} onChange={changed} />}
            {page === "Templates" && <Templates onToast={setToast} onChange={changed} />}
            {page === "Projects" && <Projects tick={tick} onOpenTask={setTaskId} onChange={changed} />}
            {page === "Reports" && <Reports initialWeek={reportWeek} onWeekShown={reportShown} />}
            {page === "Settings" && <Settings settings={settings} onSettings={onSettings} onRunSetup={onRunSetup} />}
          </motion.div>
        </AnimatePresence>
      </section>
      <TaskDrawer taskId={taskId} onClose={closeDrawer} onChange={changed} onWorkOn={(id) => void window.mentem.taskFocus(id).then(closeDrawer)} />
      <WeeklyPrompt tick={tick} active={page === "Today" && !taskId && !planning} onViewReport={(week) => { setReportWeek(week); setPage("Reports"); }} onPlan={() => setPlanning(true)} />
      <AnimatePresence>{planning && <Planning onClose={() => { setPlanning(false); changed(); }} onEditTemplates={() => { setPlanning(false); setPage("Templates"); }} />}</AnimatePresence>
      <Toast message={toast} onDone={closeToast} />
    </main>
  );
}
