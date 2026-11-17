import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import type { Settings } from "@mentem/core";
import { Launch } from "./components/Launch";
import { Onboarding } from "./components/onboarding/Onboarding";
import { Shell } from "./components/Shell";
import { useAppliedTheme } from "./lib/theme";

type Stage = "loading" | "launch" | "onboarding" | "app";

export function App() {
  const [stage, setStage] = useState<Stage>("loading");
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([window.mentem.appInfo(), window.mentem.settingsGet()]).then(([info, nextSettings]) => {
      if (!active) return;
      setSettings(nextSettings);
      setStage(info.startHash === "#onboarding" ? "onboarding" : info.startHash === "#app" ? "app" : "launch");
    });
    return () => {
      active = false;
    };
  }, []);

  useAppliedTheme(settings?.theme ?? "white-green", settings?.matchSystem ?? false);

  const nextStage: Exclude<Stage, "loading" | "launch"> = settings?.setupCompleted ? "app" : "onboarding";

  return (
    <AnimatePresence mode="wait">
      {stage === "launch" && <Launch key="launch" name={settings?.appName ?? "Mentem"} onComplete={() => setStage(nextStage)} />}
      {stage === "loading" && <motion.main key="loading" className="app-stage" initial={{ opacity: 0 }} animate={{ opacity: 1 }} />}
      {stage === "onboarding" && <Onboarding key="onboarding" onComplete={(nextSettings) => { setSettings(nextSettings); setStage("app"); }} />}
      {stage === "app" && settings && <Shell key="app" settings={settings} onSettings={setSettings} onRunSetup={() => void window.mentem.settingsUpdate({ setupStep: 0 }).then(() => setStage("onboarding"))} />}
    </AnimatePresence>
  );
}
