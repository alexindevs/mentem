import { type Clock } from "./clock";
import { type LocalDate, dateOf, instantOf, minutesOfDay } from "./dates";
import { buildSegments, segmentAt, type Segment } from "./schedule";
import type { Store } from "./store";
import type { DayBlock, RoutineItem, Slot, Task, TaskStep } from "./types";

export type TimerKind = "work" | "break" | "between" | "rest" | "no-template";

export interface TimerState {
  now: number;
  date: LocalDate;
  kind: TimerKind;
  paused: boolean;
  block: DayBlock | null;
  segment: Segment | null;
  /** Milliseconds left in the current work or break segment. */
  remainingMs: number;
  /** The real clock time the current segment ends, or null while paused. */
  segmentEndsAt: number | null;
  task: Task | null;
  step: { step: TaskStep; index: number; total: number } | null;
  nextTask: Task | null;
  /** In a block with nothing left to do: the app should offer to pull from Unscheduled or idle. */
  emptyBlock: boolean;
  /** Between blocks: the next block today and when it starts. */
  nextBlock: DayBlock | null;
  startsInMs: number | null;
  /** Routine items running right now. Together with a block this is an overlap: two activities. */
  routine: RoutineItem[];
  /** The same items with when each ends and how long is left, honoring pauses and extensions. */
  routineRuns: Array<{ item: RoutineItem; endsAt: number | null; remainingMs: number }>;
  routinePaused: boolean;
  /** In an empty block you chose to leave empty. */
  idle: boolean;
  /** The date is marked as a day off. */
  dayOff: boolean;
  /** Everything planned for today is done. */
  dayComplete: boolean;
  /** The next real clock time at which the state changes by itself. Sleep until then. */
  nextEventAt: number | null;
}

/**
 * Runs the day by the clock. The state is always computed from the clock and the schedule,
 * never accumulated, so closing the app, sleeping the computer, or changing the clock
 * puts it where it should be (FR-28). The caller asks for `nextEventAt` and sleeps until
 * then instead of ticking every second.
 *
 * Pause and skip shift the position inside the running block only; they reset when the
 * block changes, so the block always ends on time.
 */
export class TimerEngine {
  private shiftMs = 0;
  private pausedAt: number | null = null;
  private blockKey: string | null = null;
  private override: string | null = null;
  private routineShiftMs = 0;
  private routinePausedAt: number | null = null;
  private routineKey: string | null = null;
  private idleKey: string | null = null;
  private current: { key: string; startedAt: number; taskId: string | null; kind: "work" | "break"; segEndAt: number } | null = null;

  constructor(
    private readonly store: Store,
    private readonly clock: Clock = store.clock,
  ) {}

  state(): TimerState {
    const now = this.clock.now();
    const date = dateOf(now);
    const settings = this.store.getSettings();
    const cfg = {
      pomodoroMinutes: settings.pomodoroMinutes,
      shortBreakMinutes: settings.shortBreakMinutes,
      longBreakMinutes: settings.longBreakMinutes,
      cyclesBeforeLongBreak: settings.cyclesBeforeLongBreak,
    };
    const templateId = this.store.templateIdFor(date);
    const blocks = this.store.blocksFor(date);
    const runs = this.routineRuns(date, now);
    const routine = runs.map((r) => r.item);
    const base: TimerState = {
      now, date, kind: "between", paused: false, block: null, segment: null, remainingMs: 0, segmentEndsAt: null,
      task: null, step: null, nextTask: null, emptyBlock: false, nextBlock: null, startsInMs: null, routine,
      routineRuns: runs, routinePaused: this.routinePausedAt !== null, idle: false, dayOff: this.store.isDayOff(date),
      dayComplete: this.dayComplete(date), nextEventAt: null,
    };

    const realBlock = blocks.find((b) => instantOf(date, b.startMin) <= now && now < instantOf(date, b.endMin));
    const key = realBlock ? `${date}:${realBlock.slot}` : null;
    if (key !== this.blockKey) {
      this.finishSegment(now);
      this.blockKey = key;
      this.shiftMs = 0;
      this.pausedAt = null;
      this.override = null;
      this.idleKey = null;
    }

    if (realBlock) {
      const startI = instantOf(date, realBlock.startMin);
      const endI = instantOf(date, realBlock.endMin);
      let eff = (this.pausedAt ?? now) - this.shiftMs;
      eff = Math.min(Math.max(eff, startI), endI - 1);
      const segs = buildSegments(realBlock.startMin, realBlock.endMin, cfg);
      const minute = Math.floor((eff - instantOf(date, 0)) / 60_000);
      const segment = segmentAt(segs, minute) ?? segs[segs.length - 1]!;
      const segEndI = instantOf(date, segment.endMin);
      const tasks = this.store.blockTasks(date, realBlock.slot);
      const task = this.override ? tasks.find((t) => t.id === this.override) ?? tasks[0] ?? null : tasks[0] ?? null;
      const idx = task ? tasks.findIndex((t) => t.id === task.id) : -1;
      const segKey = `${key}:${segs.indexOf(segment)}`;
      this.observeSegment(segKey, segment, task, now, segEndI + this.shiftMs);
      const paused = this.pausedAt !== null;
      const segmentEndsAt = paused ? null : segEndI + this.shiftMs;
      return {
        ...base,
        kind: segment.kind,
        paused,
        block: realBlock,
        segment,
        remainingMs: Math.max(0, segEndI - eff),
        segmentEndsAt,
        task,
        step: task ? this.store.currentStep(task.id) : null,
        nextTask: idx >= 0 ? tasks[idx + 1] ?? null : null,
        emptyBlock: tasks.length === 0,
        idle: tasks.length === 0 && this.idleKey === key,
        nextEventAt: this.earliest(now, [segmentEndsAt, ...this.routineEdges(date, now), this.nextMidnight(date)]),
      };
    }

    this.finishSegment(now);
    if (templateId === null) {
      return { ...base, kind: "no-template", nextEventAt: this.earliest(now, [this.nextMidnight(date)]) };
    }
    const template = this.store.getTemplate(templateId)!;
    const nextBlock = blocks.find((b) => instantOf(date, b.startMin) > now) ?? null;
    const minuteNow = minutesOfDay(now);
    if (!nextBlock && (minuteNow >= template.bedMin || minuteNow < template.wakeMin)) {
      return { ...base, kind: "rest", nextEventAt: this.earliest(now, [...this.routineEdges(date, now), this.nextMidnight(date)]) };
    }
    if (nextBlock && minuteNow < template.wakeMin) {
      return { ...base, kind: "rest", nextBlock, startsInMs: instantOf(date, nextBlock.startMin) - now, nextEventAt: this.earliest(now, [instantOf(date, template.wakeMin), ...this.routineEdges(date, now)]) };
    }
    const first = nextBlock ? this.store.blockTasks(date, nextBlock.slot)[0] ?? null : null;
    return {
      ...base,
      kind: "between",
      nextBlock,
      startsInMs: nextBlock ? instantOf(date, nextBlock.startMin) - now : null,
      task: first,
      nextEventAt: this.earliest(now, [nextBlock ? instantOf(date, nextBlock.startMin) : null, ...this.routineEdges(date, now), this.nextMidnight(date)]),
    };
  }

  // ----------------------------------------------------------------- actions
  pause(): void {
    this.state(); // make sure the engine has seen the current block first
    if (this.blockKey && this.pausedAt === null) this.pausedAt = this.clock.now();
  }

  resume(): void {
    if (this.pausedAt !== null) {
      this.shiftMs += this.clock.now() - this.pausedAt;
      this.pausedAt = null;
    }
  }

  /** Jumps to the end of the current pomodoro or break. Does nothing in the block's last segment. */
  skip(): void {
    const s = this.state();
    if (!s.block || !s.segment) return;
    const segs = buildSegments(s.block.startMin, s.block.endMin, {
      pomodoroMinutes: this.store.getSettings().pomodoroMinutes,
      shortBreakMinutes: this.store.getSettings().shortBreakMinutes,
      longBreakMinutes: this.store.getSettings().longBreakMinutes,
      cyclesBeforeLongBreak: this.store.getSettings().cyclesBeforeLongBreak,
    });
    if (segs[segs.length - 1] === segs.find((x) => x.startMin === s.segment!.startMin)) return;
    const target = instantOf(s.date, s.segment.endMin);
    this.shiftMs = (this.pausedAt ?? this.clock.now()) - target;
    this.finishSegment(this.clock.now(), false);
  }

  /** Pauses the routine items running now, the way pause works for a block. */
  pauseRoutine(): void {
    this.state();
    if (this.routineKey && this.routinePausedAt === null) this.routinePausedAt = this.clock.now();
  }

  resumeRoutine(): void {
    if (this.routinePausedAt !== null) {
      this.routineShiftMs += this.clock.now() - this.routinePausedAt;
      this.routinePausedAt = null;
    }
  }

  /** Ends the routine items running now, on this date only. */
  skipRoutine(): void {
    const s = this.state();
    const minute = minutesOfDay((this.routinePausedAt ?? s.now) - this.routineShiftMs);
    for (const run of s.routineRuns) this.store.endRoutineAt(s.date, run.item.id, Math.max(run.item.startMin, minute));
    this.routineKey = null;
    this.routineShiftMs = 0;
    this.routinePausedAt = null;
  }

  /** Makes the routine items running now last longer, on this date only. */
  extendRoutine(minutes: number): void {
    const s = this.state();
    for (const run of s.routineRuns) this.store.extendRoutine(s.date, run.item.id, minutes);
  }

  /** In an empty block: stay empty instead of being asked to fill it. */
  idle(): void {
    this.state();
    if (this.blockKey) this.idleKey = this.blockKey;
  }

  /** Between blocks: starts the next block now instead of at its planned time. */
  startNow(): void {
    const s = this.state();
    if (!s.block && s.nextBlock) this.store.startBlockAt(s.date, s.nextBlock.slot, minutesOfDay(s.now));
  }

  /** Marks the current task done and moves on to the next one in the block. */
  done(): TimerState {
    const s = this.state();
    if (s.task) {
      this.store.setStatus(s.task.id, "done");
      this.override = null;
    }
    return this.state();
  }

  /** Works on a different task from this block instead of the first one. */
  switchTask(taskId: string): void {
    this.state(); // make sure the engine has seen the current block first
    this.override = taskId;
  }

  // --------------------------------------------------------------- internals
  /** Routine items running now, with when each ends. Pausing holds them where they are. */
  private routineRuns(date: LocalDate, now: number): TimerState["routineRuns"] {
    const effective = (this.routinePausedAt ?? now) - this.routineShiftMs;
    const minute = minutesOfDay(effective);
    const active = this.store.routineFor(date).filter((r) => r.endMin !== null && r.startMin <= minute && minute < r.endMin);
    const key = active.length ? active.map((r) => r.id).join(",") : null;
    if (key !== this.routineKey) {
      this.routineKey = key;
      this.routineShiftMs = 0;
      this.routinePausedAt = null;
      return this.routineRuns(date, now);
    }
    const paused = this.routinePausedAt !== null;
    return active.map((item) => {
      const end = instantOf(date, item.endMin!);
      return { item, endsAt: paused ? null : end + this.routineShiftMs, remainingMs: Math.max(0, end - effective) };
    });
  }

  private routineEdges(date: LocalDate, now: number): Array<number | null> {
    const out: Array<number | null> = [];
    const running = new Set(this.routineRuns(date, now).map((r) => r.item.id));
    for (const r of this.store.routineFor(date)) {
      out.push(instantOf(date, r.startMin));
      if (r.endMin !== null && running.has(r.id)) {
        if (this.routinePausedAt === null) out.push(instantOf(date, r.endMin) + this.routineShiftMs);
      } else if (r.endMin !== null) out.push(instantOf(date, r.endMin));
    }
    return out.filter((t) => t !== null && t > now);
  }

  private nextMidnight(date: LocalDate): number {
    return instantOf(date, 24 * 60);
  }

  private earliest(now: number, times: Array<number | null>): number | null {
    const future = times.filter((t): t is number => t !== null && t > now);
    return future.length ? Math.min(...future) : null;
  }

  private dayComplete(date: LocalDate): boolean {
    const row = this.store.db
      .prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS done FROM assignment a JOIN task t ON t.id = a.task_id WHERE a.date = ?")
      .get(date) as { total: number; done: number | null };
    return row.total > 0 && (row.done ?? 0) === row.total;
  }

  /** Starts tracking a segment so the time the timer actually ran can be logged (FR-28). */
  private observeSegment(key: string, seg: Segment, task: Task | null, now: number, segEndAt: number): void {
    if (this.current?.key === key) {
      this.current.segEndAt = segEndAt;
      if (seg.kind === "work") this.current.taskId = task?.id ?? this.current.taskId;
      return;
    }
    this.finishSegment(now);
    // Started now, not at the segment's scheduled start, so time while the app was closed is not logged.
    this.current = { key, startedAt: now, taskId: seg.kind === "work" ? task?.id ?? null : null, kind: seg.kind, segEndAt };
  }

  private finishSegment(now: number, naturalEnd = true): void {
    const c = this.current;
    this.current = null;
    if (!c) return;
    const end = Math.min(now, c.segEndAt);
    if (end - c.startedAt < 1000) return;
    this.store.recordSession({ taskId: c.taskId, startAt: c.startedAt, endAt: end, type: c.kind, completed: naturalEnd && now >= c.segEndAt });
  }
}

export type { Slot };
