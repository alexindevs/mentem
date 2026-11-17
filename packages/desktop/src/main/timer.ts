import { powerMonitor } from "electron";
import type * as Core from "@mentem/core";
import type { Store, TimerEngine, TimerState } from "@mentem/core";
import type { TimerView } from "../shared/api";

/** Largest delay setTimeout accepts. */
const MAX_DELAY = 2_147_000_000;
const MINUTE = 60_000;

/** Turns the engine's state into what the Now card shows. Needs the core module for the schedule math. */
export function toView(state: TimerState, store: Store, core: typeof Core): TimerView {
  const settings = store.getSettings();
  const block = state.block;
  const segment = state.segment;

  let pomodoro: TimerView["pomodoro"] = null;
  let breakKind: TimerView["breakKind"] = null;
  if (block && segment) {
    const segments = core.buildSegments(block.startMin, block.endMin, {
      pomodoroMinutes: settings.pomodoroMinutes,
      shortBreakMinutes: settings.shortBreakMinutes,
      longBreakMinutes: settings.longBreakMinutes,
      cyclesBeforeLongBreak: settings.cyclesBeforeLongBreak,
    });
    const works = segments.filter((s) => s.kind === "work");
    const done = works.filter((s) => s.endMin <= segment.startMin).length;
    pomodoro = { index: segment.kind === "work" ? done + 1 : done, total: works.length };
    if (segment.kind === "break") breakKind = segment.endMin - segment.startMin >= settings.longBreakMinutes && settings.longBreakMinutes !== settings.shortBreakMinutes ? "long" : "short";
  }

  const routine = state.routineRuns.map((run) => ({
    title: run.item.title,
    startMin: run.item.startMin,
    endMin: run.item.endMin,
    endsAt: run.endsAt,
    remainingMs: run.remainingMs,
    totalMs: run.item.endMin === null ? 0 : (run.item.endMin - run.item.startMin) * MINUTE,
  }));

  const running = state.meetingRuns[0];
  const meeting = running
    ? { id: running.meeting.id, title: running.meeting.title, startMin: running.meeting.startMin, endMin: running.meeting.endMin, endsAt: running.endsAt, remainingMs: running.remainingMs, totalMs: (running.meeting.endMin - running.meeting.startMin) * MINUTE, link: running.meeting.link }
    : null;

  let context: string | null = null;
  if (state.task?.projectId) {
    const project = store.listProjects().find((p) => p.id === state.task?.projectId);
    const deliverable = project && state.task.deliverableId ? store.listDeliverables(project.id).find((d) => d.id === state.task?.deliverableId) : undefined;
    context = [project?.name, deliverable?.title].filter(Boolean).join(" · ") || null;
  }

  const templateId = store.templateIdFor(state.date);
  const template = templateId ? store.getTemplate(templateId) : undefined;
  const minuteNow = core.minutesOfDay(state.now);

  return {
    now: state.now,
    kind: state.kind === "meeting" ? "meeting" : !block && routine.length > 0 && state.kind !== "no-template" ? "routine" : state.kind,
    paused: state.paused,
    blockName: block?.name ?? null,
    blockStartMin: block ? block.startMin : null,
    blockEndMin: block ? block.endMin : null,
    pomodoro,
    breakKind,
    endsAt: state.segmentEndsAt,
    remainingMs: state.remainingMs,
    totalMs: segment ? (segment.endMin - segment.startMin) * MINUTE : 0,
    blockEndsAt: block ? core.instantOf(state.date, block.endMin) : null,
    blockMs: block ? (block.endMin - block.startMin) * MINUTE : null,
    task: state.task ? { id: state.task.id, title: state.task.title, context } : null,
    step: state.step ? { text: state.step.step.text, index: state.step.index, total: state.step.total } : null,
    nextTask: state.nextTask?.title ?? null,
    emptyBlock: state.emptyBlock,
    nextBlock: state.nextBlock ? { name: state.nextBlock.name, startMin: state.nextBlock.startMin } : null,
    startsInMs: state.startsInMs,
    routine,
    routinePaused: state.routinePaused,
    meeting,
    nextMeeting: state.nextMeeting ? { title: state.nextMeeting.title, startMin: state.nextMeeting.startMin } : null,
    idle: state.idle,
    extendRoomMin: block ? store.blockRoom(state.date, block.slot) : 0,
    dayOff: state.dayOff,
    nextLabel: state.nextBlock?.name ?? null,
    dayComplete: state.dayComplete,
    wakeMin: template?.wakeMin ?? null,
    afterBed: template ? minuteNow >= template.bedMin : false,
  };
}

export interface TimerFeed {
  /** Recomputes the state, tells the window, and re-arms the single timer. */
  refresh(): TimerView;
  /** The current view without sending anything. */
  peek(): TimerView;
  stop(): void;
}

/**
 * Keeps the window current without polling: one timeout is armed for the engine's next
 * change (end of a pomodoro, a routine item starting, midnight) and nothing else runs
 * in between. Waking from sleep re-arms it, because the timeout may have been missed.
 */
export function createTimerFeed(
  engine: TimerEngine,
  store: Store,
  core: typeof Core,
  send: (view: TimerView) => void,
  /** Runs rollover and the repeats: when the day changes, and when a work block ends (FR-35). */
  onCatchUp: () => void,
): TimerFeed {
  let timeout: NodeJS.Timeout | null = null;
  let lastDate = engine.state().date;
  let lastAt = store.clock.now();

  const refresh = (): TimerView => {
    if (timeout) clearTimeout(timeout);
    timeout = null;
    let state = engine.state();
    if (state.date !== lastDate || core.blockEndedBetween(store, lastAt, state.now)) {
      lastDate = state.date;
      onCatchUp();
      state = engine.state();
    }
    lastAt = state.now;
    const view = toView(state, store, core);
    send(view);
    if (state.nextEventAt !== null) {
      const delay = Math.min(Math.max(state.nextEventAt - store.clock.now(), 50), MAX_DELAY);
      timeout = setTimeout(refresh, delay);
    }
    return view;
  };

  powerMonitor.on("resume", refresh);

  return {
    refresh,
    peek: () => toView(engine.state(), store, core),
    stop() {
      if (timeout) clearTimeout(timeout);
      powerMonitor.removeListener("resume", refresh);
    },
  };
}
