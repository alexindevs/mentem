import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import type { TimerAction, TimerTarget, TimerView, TodayData } from "@shared/api";
import { showsDayComplete } from "../../lib/dayCard";
import { blockTime, formatClock, formatFocus, formatRange, formatTime } from "../../lib/time";
import { Mark } from "../Mark";
import { Button, Pill } from "../ui";

const ease = [0.16, 1, 0.3, 1] as const;

interface NowCardProps {
  view: TimerView;
  /** When the view arrived, and the current time, for the running countdowns. */
  at: number;
  now: number;
  data: TodayData;
  onAct(action: TimerAction, target?: TimerTarget): void;
  onPull(): void;
  onExtend(minutes: number): void;
  onExtendBlock(minutes: number): void;
  onStartNow(): void;
  onIdle(): void;
  onDayOff(off: boolean): void;
  onCreateTemplate(): void;
  onMinutes(meetingId: string): void;
}

const clamp = (n: number) => Math.min(1, Math.max(0, n));
const share = (remaining: number, total: number) => (total > 0 ? clamp(1 - remaining / total) : 0);

function Clock({ ms, small }: { ms: number; small?: boolean }) {
  const text = formatClock(ms);
  // Past an hour the digits get a third group, so they step down to fit the column.
  return (
    <div className={`t-timer now__clock ${small ? "now__clock--small" : ""} ${text.length > 5 ? "now__clock--long" : ""}`} aria-label="Time left">
      {text}
    </div>
  );
}

function Meter({ value }: { value: number }) {
  return (
    <div className="now__meter" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${value * 100}%` }} />
    </div>
  );
}

/** The timer column: digits, a bar and up to two lines of text under it. */
function Side({ ms, value, top, bottom, small }: { ms: number; value: number; top?: string | null; bottom?: ReactNode; small?: boolean }) {
  return (
    <div className="now__side">
      <Clock ms={ms} small={small} />
      <Meter value={value} />
      {top && <span className="t-caption now__muted">{top}</span>}
      {bottom && <span className="t-body-m-strong">{bottom}</span>}
    </div>
  );
}

function Copy({ id, label, title, detail, children }: { id: string; label: string; title: string; detail?: ReactNode; children?: ReactNode }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={id} className="now__copy" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: { duration: 0.22, ease } }} exit={{ opacity: 0, transition: { duration: 0.12 } }}>
        <span className="t-label now__label">{label}</span>
        <h2 className="t-h-xl now__title">{title}</h2>
        {detail}
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

const range = (view: TimerView) => (view.blockStartMin !== null && view.blockEndMin !== null ? `${blockTime(view.blockStartMin)} – ${blockTime(view.blockEndMin)}` : "");

export function NowCard({ view, at, now, data, onAct, onPull, onExtend, onExtendBlock, onStartNow, onIdle, onDayOff, onCreateTemplate, onMinutes }: NowCardProps) {
  const segmentMs = view.paused || view.endsAt === null ? view.remainingMs : Math.max(0, view.endsAt - now);
  const pause = (
    <Button variant="secondary" onClick={() => onAct(view.paused ? "resume" : "pause")}>
      {view.paused ? "Resume" : "Pause"}
    </Button>
  );

  // A meeting: the pomodoro waits and picks up where it stopped.
  if (view.kind === "meeting" && view.meeting) {
    const m = view.meeting;
    const left = Math.max(0, m.endsAt - now);
    return (
      <section className="now" aria-live="polite">
        <div className="now__main">
          <Copy id={`meeting:${m.id}`} label={`Meeting · ${formatRange(m.startMin, m.endMin)}`} title={m.title}>
            <div className="now__buttons">
              {m.link && /^https:\/\//i.test(m.link) && <Button onClick={() => window.open(m.link!, "_blank", "noopener")}>Open link</Button>}
              <Button variant="secondary" onClick={() => onMinutes(m.id)}>
                Take minutes
              </Button>
            </div>
          </Copy>
        </div>
        <Side ms={left} value={share(left, m.totalMs)} bottom={view.task ? `Then: ${view.task.title}` : null} />
      </section>
    );
  }

  // Everything planned is done.
  if (showsDayComplete(view)) {
    return (
      <section className="now now--tint now--center" aria-live="polite">
        <Mark size={92} />
        <div className="now__copy">
          <h2 className="t-h-xl now__title">Day complete</h2>
          <p className="t-body-l now__muted">
            {data.stats.tasks} {data.stats.tasks === 1 ? "task" : "tasks"} · {formatFocus(data.stats.focusMinutes)} focused
          </p>
        </div>
      </section>
    );
  }

  if (view.kind === "no-template") {
    return (
      <section className="now" aria-live="polite">
        <div className="now__main">
          {view.dayOff ? (
            <Copy id="dayoff" label="Today" title="Day off">
              <div className="now__buttons">
                <Button variant="secondary" onClick={() => onDayOff(false)}>
                  Undo
                </Button>
              </div>
            </Copy>
          ) : (
            <Copy id="none" label="Today" title="No template for today">
              <div className="now__buttons">
                <Button onClick={onCreateTemplate}>Create a template</Button>
                <Button variant="secondary" onClick={() => onDayOff(true)}>
                  Mark as a day off
                </Button>
              </div>
            </Copy>
          )}
        </div>
      </section>
    );
  }

  if (view.kind === "rest") {
    return (
      <section className="now now--tint" aria-live="polite">
        <div className="now__main">
          <Copy id="rest" label={view.afterBed ? "After bed" : "Before wake"} title="Rest" detail={view.wakeMin !== null ? <p className="t-body-l now__muted">Wake up at {formatTime(view.wakeMin)}</p> : null} />
        </div>
        {view.wakeMin !== null && (
          <div className="now__side now__side--plain">
            <div className="t-timer now__clock">{formatTime(view.wakeMin).replace(/ [AP]M$/, "")}</div>
            <span className="t-caption now__muted">{view.afterBed ? "Tomorrow" : "Today"}</span>
          </div>
        )}
      </section>
    );
  }

  if (view.kind === "routine") {
    const item = view.routine[0];
    if (!item) return null;
    const left = item.endsAt === null ? item.remainingMs : Math.max(0, item.endsAt - now);
    return (
      <section className="now" aria-live="polite">
        <div className="now__main">
          <Copy id={`routine:${item.title}`} label={`Routine · ${formatRange(item.startMin, item.endMin ?? item.startMin)}`} title={item.title}>
            <div className="now__extend">
              <span className="t-caption now__muted">Extend</span>
              <div className="pills">
                {[5, 10, 15, 30].map((m) => (
                  <Pill key={m} onClick={() => onExtend(m)}>
                    +{m}
                  </Pill>
                ))}
              </div>
            </div>
            <div className="now__buttons">
              <Button variant="secondary" onClick={() => onAct(view.routinePaused ? "resume" : "pause", "routine")}>
                {view.routinePaused ? "Resume" : "Pause"}
              </Button>
              <Button variant="ghost" onClick={() => onAct("skip", "routine")}>
                Skip
              </Button>
            </div>
          </Copy>
        </div>
        <Side ms={left} value={share(left, item.totalMs)} bottom={view.nextLabel ? `Next: ${view.nextLabel}` : null} />
      </section>
    );
  }

  if (view.kind === "between") {
    const left = view.startsInMs === null ? 0 : Math.max(0, view.startsInMs - (now - at));
    const next = view.nextBlock;
    return (
      <section className="now" aria-live="polite">
        <div className="now__main">
          <Copy
            id={`between:${next?.name ?? ""}`}
            label={next ? `Up next · ${formatTime(next.startMin)}` : "Today"}
            title={next?.name ?? "No more blocks today"}
            detail={view.task ? <p className="t-body-l now__muted">First: {view.task.title}</p> : null}
          >
            {next && (
              <div className="now__buttons">
                <Button onClick={onStartNow}>Start now</Button>
              </div>
            )}
          </Copy>
        </div>
        {next && <Side ms={left} value={share(left, 60 * 60_000)} bottom={<span className="now__muted now__plain">until {next.name}</span>} />}
      </section>
    );
  }

  // From here a block is running: a pomodoro or a break, possibly with a routine item beside it.
  const overlapping = view.routine.length > 0;
  const blockLabel = `${view.blockName ?? ""} · ${range(view)}`;

  if (view.kind === "work" && view.emptyBlock) {
    const left = view.blockEndsAt === null ? 0 : Math.max(0, view.blockEndsAt - now);
    return (
      <section className="now" aria-live="polite">
        <div className="now__main">
          <Copy id={view.idle ? "idle" : "empty"} label={blockLabel} title={view.idle ? "Idle" : "Nothing assigned"}>
            <div className="now__buttons">
              {data.unscheduled.length > 0 && <Button onClick={onPull}>Pull from Unscheduled</Button>}
              {!view.idle && (
                <Button variant="ghost" onClick={onIdle}>
                  Idle
                </Button>
              )}
            </div>
          </Copy>
        </div>
        <Side ms={left} value={share(left, view.blockMs ?? 0)} bottom={<span className="now__muted now__plain">left in {view.blockName}</span>} />
      </section>
    );
  }

  const isBreak = view.kind === "break";
  const label = isBreak ? `Break · ${view.breakKind === "long" ? "Long" : "Short"}` : `Now · Pomodoro ${view.pomodoro?.index ?? 1} of ${view.pomodoro?.total ?? 1}`;
  const title = isBreak ? (view.breakKind === "long" ? "Long break" : "Short break") : (view.task?.title ?? "");
  const step = !isBreak && view.step ? (
    <div className="now__step t-body-m">
      <span className="now__step-count">
        Step {view.step.index} of {view.step.total}
      </span>
      {view.step.text}
    </div>
  ) : null;
  const next = view.nextTask ? `Next: ${view.nextTask}` : null;

  if (overlapping) {
    const item = view.routine[0]!;
    const itemLeft = item.endsAt === null ? item.remainingMs : Math.max(0, item.endsAt - now);
    return (
      <section className="now now--split" aria-live="polite">
        <div className="now__panel">
          <Copy id={`${view.kind}:${view.task?.id ?? ""}`} label={label} title={title} />
          <Clock ms={segmentMs} small />
          <Meter value={share(segmentMs, view.totalMs)} />
          <div className="now__buttons">
            {!isBreak && <Button onClick={() => onAct("done")}>Done</Button>}
            {pause}
          </div>
        </div>
        <div className="now__divider" />
        <div className="now__panel">
          <Copy id={`routine:${item.title}`} label={`Routine · ${formatRange(item.startMin, item.endMin ?? item.startMin)}`} title={item.title} />
          <Clock ms={itemLeft} small />
          <Meter value={share(itemLeft, item.totalMs)} />
          <div className="now__buttons">
            <Button variant="secondary" onClick={() => onExtend(5)}>
              +5 min
            </Button>
            <Button variant="ghost" onClick={() => onAct("skip", "routine")}>
              Skip
            </Button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={`now ${isBreak ? "now--tint" : ""}`} aria-live="polite">
      <div className="now__main">
        <Copy id={`${view.kind}:${view.task?.id ?? ""}:${view.step?.index ?? ""}`} label={label} title={title} detail={step}>
          <div className="now__buttons">
            {!isBreak && <Button onClick={() => onAct("done")}>Done</Button>}
            {pause}
            <Button variant="ghost" onClick={() => onAct("skip")}>
              {isBreak ? "Skip break" : "Skip"}
            </Button>
          </div>
          {view.extendRoomMin >= 5 && (
            <div className="now__extend">
              <span className="t-caption now__muted">Extend {view.blockName}</span>
              <div className="pills">
                {/* The usual amounts that fit, or whatever is left when less than that remains. */}
                {([15, 30].filter((m) => m <= view.extendRoomMin).length ? [15, 30].filter((m) => m <= view.extendRoomMin) : [view.extendRoomMin]).map((m) => (
                  <Pill key={m} onClick={() => onExtendBlock(m)}>
                    +{m}
                  </Pill>
                ))}
              </div>
            </div>
          )}
        </Copy>
      </div>
      <Side ms={segmentMs} value={share(segmentMs, view.totalMs)} top={isBreak ? null : view.task?.context} bottom={next} />
    </section>
  );
}
