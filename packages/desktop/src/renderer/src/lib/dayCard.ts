import type { TimerView } from "@shared/api";

/**
 * Whether the Now card shows "Day complete". Only while nothing is going on: a routine item
 * that is running right now, or a meeting, is what the card is for, even when every task for
 * the day is done.
 */
export function showsDayComplete(view: Pick<TimerView, "dayComplete" | "kind">): boolean {
  return view.dayComplete && (view.kind === "between" || view.kind === "rest");
}
