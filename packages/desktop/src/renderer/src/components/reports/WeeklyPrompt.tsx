import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import type { Prompts } from "@shared/api";
import { Mark } from "../Mark";
import { Button } from "../ui";

const ease = [0.16, 1, 0.3, 1] as const;
const KEY = "weekly-prompts-done";

function done(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}
function finish(key: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...done().add(key)]));
  } catch {
    /* it may be offered again */
  }
}

interface WeeklyPromptProps {
  tick: number;
  /** Only while on Today, so a popup never lands on top of something being edited. */
  active: boolean;
  onViewReport(weekStart: string): void;
  onPlan(): void;
}

/** The two weekly popups (PRD 7.12): the report when a week ends, planning when one begins. */
export function WeeklyPrompt({ tick, active, onViewReport, onPlan }: WeeklyPromptProps) {
  const [prompts, setPrompts] = useState<Prompts | null>(null);
  const [later, setLater] = useState<Set<string>>(new Set());
  useEffect(() => void window.mentem.promptsGet().then(setPrompts), [tick]);

  const completed = done();
  const reportKey = prompts?.report ? `report:${prompts.report.weekStart}` : null;
  const planKey = prompts?.planning ? `plan:${prompts.planning.weekStart}` : null;
  const showReport = active && prompts?.report && reportKey && !completed.has(reportKey) && !later.has(reportKey);
  // The report comes first; planning waits until it has been dealt with.
  const showPlan = active && !showReport && prompts?.planning && planKey && !completed.has(planKey) && !later.has(planKey);
  const open = showReport ? "report" : showPlan ? "plan" : null;

  return (
    <AnimatePresence>
      {open && prompts && (
        <motion.div key={open} className="dialog-scrim dialog-scrim--page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
          <motion.div className="popup" role="dialog" aria-label={open === "report" ? "Your week is done" : "Plan your week"} initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.22, ease }}>
            <Mark size={92} />
            <h2 className="t-h-xl popup__title">{open === "report" ? "Your week is done" : "A new week"}</h2>
            <p className="t-body-m muted">{(open === "report" ? prompts.report : prompts.planning)?.label}</p>
            <Button
              onClick={() => {
                if (open === "report" && reportKey && prompts.report) {
                  finish(reportKey);
                  onViewReport(prompts.report.weekStart);
                } else if (planKey) {
                  finish(planKey);
                  onPlan();
                }
                setPrompts({ ...prompts });
              }}
              style={{ width: "100%" }}
            >
              {open === "report" ? "View report" : "Plan your week"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                const key = open === "report" ? reportKey : planKey;
                if (key) setLater(new Set(later).add(key));
              }}
            >
              Later
            </Button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
