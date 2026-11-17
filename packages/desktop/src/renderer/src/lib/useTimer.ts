import { useEffect, useState } from "react";
import type { TimerView } from "@shared/api";

export interface TimerSnapshot {
  view: TimerView;
  /** The app's time when this snapshot was made, so countdowns can run from it. */
  at: number;
  /** Add to the machine's time to get the app's time. Zero except when testing with a fixed time. */
  offset: number;
}

/** The current timer state, pushed from the main process whenever it changes. */
export function useTimer(): TimerSnapshot | null {
  const [snapshot, setSnapshot] = useState<TimerSnapshot | null>(null);
  useEffect(() => {
    let live = true;
    const take = (view: TimerView) => live && setSnapshot({ view, at: view.now, offset: view.now - Date.now() });
    void window.mentem.timerGet().then(take);
    const off = window.mentem.onTimer(take);
    return () => {
      live = false;
      off();
    };
  }, []);
  return snapshot;
}

/** The app's current time, refreshed once a second while `active` and the window is visible. */
export function useNow(active: boolean, offset: number): number {
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => setNow(Date.now() + offset), [offset]);
  useEffect(() => {
    if (!active) return;
    const tick = () => {
      if (!document.hidden) setNow(Date.now() + offset);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [active, offset]);
  return now;
}

/** Whether anything on the Now card is counting down. */
export function isTicking(view: TimerView | null): boolean {
  if (!view) return false;
  if (view.meeting) return true;
  if (view.paused) return false;
  return view.endsAt !== null || view.startsInMs !== null || view.routine.some((r) => r.endsAt !== null) || (view.emptyBlock && view.blockEndsAt !== null);
}
