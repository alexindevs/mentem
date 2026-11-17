import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import type { Settings } from "@mentem/core";
import { useAppliedTheme } from "../../lib/theme";
import { Mark } from "../Mark";
import { Button } from "../ui";
import { defaultDraft, stepProblem, toInput, type Draft } from "./draft";
import { STEP_BODIES, STEP_WIDTH, SummaryStep } from "./steps";

const STEPS = STEP_BODIES;
const SUMMARY = STEPS.length + 1;
const ease = [0.16, 1, 0.3, 1] as const;

const SAVED_KEY = "onboarding-progress";

/** Where an interrupted setup left off. Anything missing or malformed means a fresh start. */
function readProgress(): { step: number; draft: Draft } {
  const fresh = { step: 1, draft: defaultDraft() };
  try {
    const saved = JSON.parse(localStorage.getItem(SAVED_KEY) ?? "null") as { step?: unknown; draft?: Partial<Draft> } | null;
    if (!saved || typeof saved.step !== "number" || saved.step < 1 || saved.step > SUMMARY || !saved.draft) return fresh;
    return { step: saved.step, draft: { ...fresh.draft, ...saved.draft } };
  } catch {
    return fresh;
  }
}

export function Onboarding({ onComplete }: { onComplete(settings: Settings): void }) {
  const [initial] = useState(readProgress);
  const [step, setStep] = useState(initial.step);
  const [draft, setDraft] = useState<Draft>(initial.draft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  useAppliedTheme(draft.theme, draft.matchSystem);

  // Nothing is saved to the database until the end, but the answers so far are kept
  // on this computer so closing the app doesn't lose them (FR-65).
  useEffect(() => {
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify({ step, draft }));
    } catch {
      /* progress just won't be remembered */
    }
  }, [step, draft]);

  const problem = stepProblem(step, draft);
  const isSummary = step === SUMMARY;
  const Step = STEPS[step - 1];
  const width = isSummary ? 720 : (STEP_WIDTH[step - 1] ?? 720);

  const finish = async () => {
    setSaving(true);
    setError("");
    try {
      const settings = await window.mentem.onboardingComplete(toInput(draft));
      try {
        localStorage.removeItem(SAVED_KEY);
      } catch {
        /* nothing to clear */
      }
      onComplete(settings);
    } catch {
      setError("Couldn’t save. Go back and check your answers.");
      setSaving(false);
    }
  };

  return (
    <motion.main className="onboarding" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease }}>
      {!isSummary && (
        <div className="onboarding__progress">
          <span style={{ width: `${(step / STEPS.length) * 100}%` }} />
        </div>
      )}
      <header className="onboarding__header">
        <div className="onboarding__brand">
          <Mark size={32} variant="small" />
          <span className="t-h-m">{draft.customName && draft.appName.trim() ? draft.appName.trim() : "Mentem"}</span>
        </div>
        {!isSummary && <span className="t-caption muted">Step {step} of {STEPS.length}</span>}
      </header>
      <div className="onboarding__body">
        <AnimatePresence mode="wait" initial={false}>
          <motion.section
            key={step}
            className="onboarding__content"
            style={{ width }}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.22, ease } }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
          >
            {isSummary ? <SummaryStep draft={draft} error={error} saving={saving} onStart={finish} onBack={() => setStep(step - 1)} /> : Step && <Step draft={draft} set={set} />}
          </motion.section>
        </AnimatePresence>
      </div>
      {!isSummary && (
        <footer className="onboarding__footer" style={{ width }}>
          {step > 1 ? (
            <Button variant="ghost" onClick={() => setStep(step - 1)}>
              Back
            </Button>
          ) : (
            <span />
          )}
          {problem && <span className="t-caption danger-text">{problem}</span>}
          <Button disabled={problem !== null} onClick={() => setStep(step + 1)}>
            Continue
          </Button>
        </footer>
      )}
    </motion.main>
  );
}
