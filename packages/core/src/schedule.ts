/**
 * Pure pomodoro schedule for one work block. All times are minutes since midnight.
 * Nothing here touches the database or the clock, so it is cheap and easy to test.
 */
export interface PomodoroConfig {
  pomodoroMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  cyclesBeforeLongBreak: number;
}

export interface Segment {
  kind: "work" | "break";
  startMin: number;
  endMin: number;
  /** 1-based pomodoro within the block; for a break, the pomodoro it follows. */
  pomodoro: number;
  /** A break after every Nth pomodoro is the longer one. */
  long: boolean;
}

/**
 * Work and break segments that exactly fill [startMin, endMin).
 * The cycle restarts at each block start. If the cycle does not divide the block, the
 * final pomodoro (or break) is shortened so the block ends on time.
 */
export function buildSegments(startMin: number, endMin: number, cfg: PomodoroConfig): Segment[] {
  const out: Segment[] = [];
  let t = startMin;
  let n = 0;
  while (t < endMin) {
    const w = Math.min(cfg.pomodoroMinutes, endMin - t);
    n += 1;
    out.push({ kind: "work", startMin: t, endMin: t + w, pomodoro: n, long: false });
    t += w;
    if (t >= endMin) break;
    const long = n % cfg.cyclesBeforeLongBreak === 0;
    const b = Math.min(long ? cfg.longBreakMinutes : cfg.shortBreakMinutes, endMin - t);
    out.push({ kind: "break", startMin: t, endMin: t + b, pomodoro: n, long });
    t += b;
  }
  return out;
}

/** The segment containing the given minute (start inclusive, end exclusive), if any. */
export function segmentAt(segments: Segment[], minute: number): Segment | null {
  let lo = 0;
  let hi = segments.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = segments[mid]!;
    if (minute < s.startMin) hi = mid - 1;
    else if (minute >= s.endMin) lo = mid + 1;
    else return s;
  }
  return null;
}

/** How many work pomodoros of the configured length fit in a block (for capacity). */
export function blockCapacity(startHour: number, endHour: number, cfg: PomodoroConfig): number {
  return buildSegments(startHour * 60, endHour * 60, cfg).filter((s) => s.kind === "work").length;
}
