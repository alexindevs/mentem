import { useState, type ReactNode } from "react";
import type { ThemeId } from "@mentem/core";
import { freeGap, isStandardBlock, nextBlockName } from "../../lib/blocks";
import { formatSpan, formatTime } from "../../lib/time";
import { Button, Choice, Field, Pill, RangeField, StepperRow, SwitchRow, TextInput, TimeField } from "../ui";
import { DayBar, Glance } from "./DayPreview";
import { MAX_BLOCKS } from "@shared/pages";
import { DAY_SHORT, PRESETS, SUGGESTIONS, THEME_NAMES, overlapsOf, pomodorosIn, presetKey, summaryRows, type Draft } from "./draft";

export interface StepProps {
  draft: Draft;
  set(patch: Partial<Draft>): void;
}

/** Content width of each of the ten steps, in pixels, as designed. */
export const STEP_WIDTH = [560, 720, 720, 720, 960, 960, 720, 720, 720, 1000];

function Intro({ title, body }: { title: string; body: string }) {
  return (
    <div className="intro">
      <h1 className="t-h-xl">{title}</h1>
      <p className="t-body-l">{body}</p>
    </div>
  );
}

export function NameStep({ draft, set }: StepProps) {
  return (
    <>
      <Intro title="Hi. What should we call you?" body="Mentem will use your name when it greets you each day." />
      <TextInput autoFocus aria-label="Your name" placeholder="Your name" maxLength={60} value={draft.userName} onChange={(e) => set({ userName: e.target.value })} />
      <p className="t-caption muted">You can change this any time in settings.</p>
    </>
  );
}

export function PlatformStep({ draft, set }: StepProps) {
  return (
    <>
      <Intro title="Keep the name, or make it yours?" body="This is what the app calls itself everywhere, and the command you type in a terminal." />
      <div className="row">
        <Choice title="Keep “Mentem”" body="Use the original name and the command mentem." selected={!draft.customName} onClick={() => set({ customName: false })} />
        <Choice
          title="Use my own name"
          body="Pick a name and a command that feel like yours."
          selected={draft.customName}
          onClick={() => !draft.customName && set({ customName: true, appName: "", cliName: "" })}
        />
      </div>
      {draft.customName && (
        <>
          <div className="row">
            <Field label="App name" hint="Shown in the title bar, header and notifications.">
              <TextInput placeholder="My Day" maxLength={40} value={draft.appName} onChange={(e) => set({ appName: e.target.value })} />
            </Field>
            <Field label="Command name" hint="Letters, numbers and hyphens only.">
              <TextInput placeholder="myday" maxLength={30} value={draft.cliName} onChange={(e) => set({ cliName: e.target.value })} />
            </Field>
          </div>
          <p className="t-caption muted">Your data stays the same whichever name you pick, and you can rename any time.</p>
        </>
      )}
    </>
  );
}

export function WorkStyleStep({ draft, set }: StepProps) {
  const pick = (workStyle: Draft["workStyle"]) =>
    set(workStyle === "freelancer" ? { workStyle, templateName: "My week", weekdays: [0, 1, 2, 3, 4, 5, 6] } : { workStyle, templateName: "Weekday", weekdays: [0, 1, 2, 3, 4] });
  return (
    <>
      <Intro title="How do you work?" body="This just sets sensible starting points. You can change everything later." />
      <div className="row">
        <Choice title="Freelancer" body="Your days change. We’ll start with flexible days you can adjust date by date." selected={draft.workStyle === "freelancer"} onClick={() => pick("freelancer")} />
        <Choice title="Full-time" body="Your hours are fairly fixed. We’ll set up a weekday template." selected={draft.workStyle === "full-time"} onClick={() => pick("full-time")} />
      </div>
    </>
  );
}

export function DayStep({ draft, set }: StepProps) {
  return (
    <>
      <Intro title="When does your day start and end?" body="Your day template is built around these two times. Next you’ll fill in what happens between them." />
      <div className="times">
        <div className="field">
          <span className="t-body-m-strong">I wake up at</span>
          <TimeField label="Wake time" value={draft.wakeMin} from={0} to={23 * 60 + 45} onChange={(v) => set({ wakeMin: v ?? draft.wakeMin })} />
        </div>
        <div className="field">
          <span className="t-body-m-strong">I go to bed at</span>
          <TimeField label="Bed time" value={draft.bedMin} from={15} to={24 * 60} onChange={(v) => set({ bedMin: v ?? draft.bedMin })} />
        </div>
      </div>
      <DayBar draft={draft} />
    </>
  );
}

export function RoutineStep({ draft, set }: StepProps) {
  const [title, setTitle] = useState("");
  const [from, setFrom] = useState(9 * 60);
  const [to, setTo] = useState<number | null>(9 * 60 + 30);

  const withItem = (item: { title: string; startMin: number; endMin: number | null }) => {
    set({ routine: [...draft.routine, { ...item, id: Date.now() + draft.routine.length }] });
    // The next item you add starts where this one ended, and runs for an hour by default.
    const next = Math.min(item.endMin ?? item.startMin, 24 * 60 - 5);
    setFrom(next);
    setTo(next + 60 <= 24 * 60 ? next + 60 : null);
  };
  const tap = (s: (typeof SUGGESTIONS)[number]) => {
    const existing = draft.routine.find((r) => r.title === s.title);
    if (existing) set({ routine: draft.routine.filter((r) => r.id !== existing.id) });
    else withItem(s);
  };
  const ordered = [...draft.routine].sort((a, b) => a.startMin - b.startMin);
  const update = (id: number, startMin: number, endMin: number | null) => set({ routine: draft.routine.map((r) => (r.id === id ? { ...r, startMin, endMin } : r)) });

  return (
    <>
      <Intro title="What does your day already include?" body="Add the things you do in your routine. These aren’t tasks, just the rhythm of your day." />
      <div className="columns">
        <div className="column column--left">
          <span className="t-body-m-strong">Tap to add</span>
          <div className="pills">
            {SUGGESTIONS.map((s) => (
              <Pill key={s.title} selected={draft.routine.some((r) => r.title === s.title)} onClick={() => tap(s)}>
                {s.title}
              </Pill>
            ))}
          </div>
          <form
            className="column"
            onSubmit={(event) => {
              event.preventDefault();
              if (!title.trim()) return;
              withItem({ title: title.trim(), startMin: from, endMin: to !== null && to > from ? to : null });
              setTitle("");
            }}
          >
            <TextInput aria-label="Routine item" placeholder="Add your own…" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} />
            <div className="add-row">
              <span className="t-body-m muted">From</span>
              <TimeField label="From" step={5} to={24 * 60 - 5} value={from} onChange={(v) => v !== null && setFrom(v)} />
              <span className="t-body-m muted">to</span>
              <TimeField label="To" step={5} from={from + 5} noneLabel="No end" value={to} onChange={setTo} />
              <Button type="submit" variant="secondary" disabled={!title.trim()}>
                Add
              </Button>
            </div>
          </form>
          <p className="t-caption muted">Tapped items get a suggested time and length. Click any time to change it. The end time is optional.</p>
        </div>
        <div className="column column--right">
          <span className="t-body-m-strong">Your day so far</span>
          <div className="group">
            <div className="routine-row">
              <span className="range-field range-field--static">{formatTime(draft.wakeMin)}</span>
              <span className="t-body-l routine-row__title">Wake up</span>
              <span className="t-caption muted">from wake time</span>
            </div>
            {ordered.map((item) => (
              <div key={item.id} className="routine-row">
                <RangeField label={item.title} start={item.startMin} end={item.endMin} onChange={(s, e) => update(item.id, s, e)} />
                <span className="t-body-l routine-row__title">{item.title}</span>
                <button className="icon-button" aria-label={`Remove ${item.title}`} onClick={() => set({ routine: draft.routine.filter((r) => r.id !== item.id) })}>
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function InfoNote({ title, body }: { title: string; body: string }) {
  return (
    <div className="note">
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M10 9v5M10 6.2v.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <div>
        <p className="t-body-m-strong">{title}</p>
        <p className="t-caption muted">{body}</p>
      </div>
    </div>
  );
}

export function BlocksStep({ draft, set }: StepProps) {
  const update = (index: number, patch: Partial<Draft["blocks"][number]>) => set({ blocks: draft.blocks.map((b, i) => (i === index ? { ...b, ...patch } : b)) });
  const overlaps = overlapsOf(draft);
  const gap = freeGap(draft.blocks, draft.wakeMin, draft.bedMin);
  const canAdd = gap !== null && draft.blocks.length < MAX_BLOCKS;
  const remove = (index: number) => set({ blocks: draft.blocks.filter((_, i) => i !== index) });
  return (
    <>
      <Intro title="When do you work?" body="Work blocks are the times you assign tasks to. Use one, two or three, whatever suits you." />
      <div className="block-list">
        {draft.blocks.map((block, index) => (
          <div key={index} className={`block-row ${block.enabled ? "" : "block-row--off"}`}>
            <button className={`toggle ${block.enabled ? "toggle--on" : ""}`} role="switch" aria-checked={block.enabled} aria-label={`${block.name} block`} onClick={() => update(index, { enabled: !block.enabled })}>
              <span className="toggle__knob" />
            </button>
            <input className="block-row__name" aria-label="Block name" maxLength={30} value={block.name} disabled={!block.enabled} onChange={(e) => update(index, { name: e.target.value })} />
            <TimeField disabled={!block.enabled} label={`${block.name} start`} from={draft.wakeMin} to={draft.bedMin - 15} value={block.startHour * 60} onChange={(v) => v !== null && update(index, { startHour: v / 60 })} />
            <span className="t-body-m muted">to</span>
            <TimeField disabled={!block.enabled} label={`${block.name} end`} from={draft.wakeMin + 15} to={draft.bedMin} value={block.endHour * 60} onChange={(v) => v !== null && update(index, { endHour: v / 60 })} />
            <span className="t-caption muted block-row__count">
              {block.enabled ? `${formatSpan((block.endHour - block.startHour) * 60).replace(" 0 min", "")} · ${pomodorosIn(block, draft.pomodoro)} pomodoros` : "Off"}
            </span>
            {!isStandardBlock(block.name) && (
              <button className="icon-button" aria-label={`Remove ${block.name}`} onClick={() => remove(index)}>
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      <button className="drawer__add" disabled={!canAdd} onClick={() => gap && set({ blocks: [...draft.blocks, { name: nextBlockName(draft.blocks), enabled: true, ...gap }] })}>
        <span aria-hidden="true">+</span> Add a block
      </button>
      {overlaps.slice(0, 3).map(({ item, block }) => (
        <InfoNote
          key={`${item.id}-${block.name}`}
          title={`${item.title} (${formatTime(item.startMin)} – ${formatTime(item.endMin ?? item.startMin)}) overlaps your ${block.name} block.`}
          body="That’s fine. While they overlap, your timer will show both."
        />
      ))}
      <Glance draft={draft} />
    </>
  );
}

export function WeekStep({ draft, set }: StepProps) {
  const toggle = (day: number) => set({ weekdays: draft.weekdays.includes(day) ? draft.weekdays.filter((d) => d !== day) : [...draft.weekdays, day].sort() });
  return (
    <>
      <Intro title="Which days look like this?" body={`This template is called ${draft.templateName.trim() || "…"}. Choose the days it applies to. You can add other templates after setup.`} />
      <Field label="Template name">
        <TextInput maxLength={40} value={draft.templateName} onChange={(e) => set({ templateName: e.target.value })} />
      </Field>
      <div className="field">
        <span className="t-body-m-strong">Runs on</span>
        <div className="pills">
          {DAY_SHORT.map((name, day) => (
            <Pill key={name} selected={draft.weekdays.includes(day)} onClick={() => toggle(day)}>
              {name}
            </Pill>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="t-body-m-strong">My week ends on</span>
        <div className="pills">
          {DAY_SHORT.map((name, day) => (
            <Pill key={name} selected={draft.weekEndDay === day} onClick={() => set({ weekEndDay: day })}>
              {name}
            </Pill>
          ))}
        </div>
        <p className="t-caption muted">Tasks still open at the end of that day go back to Unscheduled instead of rolling forward.</p>
      </div>
    </>
  );
}

export function RhythmStep({ draft, set }: StepProps) {
  const current = presetKey(draft);
  const patch = (change: Partial<Draft["pomodoro"]>) => set({ pomodoro: { ...draft.pomodoro, ...change }, rhythmCustom: true });
  return (
    <>
      <Intro title="How do you like to focus?" body="Mentem runs pomodoros through your work blocks. Pick a rhythm, or fine-tune it." />
      <div className="pills">
        {PRESETS.map((p) => (
          <Pill key={p.key} selected={current === p.key} onClick={() => set({ pomodoro: p.values, rhythmCustom: false })}>
            {p.label}
          </Pill>
        ))}
        <Pill selected={current === "custom"} onClick={() => set({ rhythmCustom: true })}>
          Custom
        </Pill>
      </div>
      <div className="group">
        <StepperRow title="Focus session" unit="minutes" min={1} max={180} value={draft.pomodoro.focus} onChange={(focus) => patch({ focus })} />
        <StepperRow title="Short break" unit="minutes" min={1} max={60} value={draft.pomodoro.short} onChange={(short) => patch({ short })} />
        <StepperRow title="Long break" unit="minutes" min={1} max={120} value={draft.pomodoro.long} onChange={(long) => patch({ long })} />
        <StepperRow title="Pomodoros before a long break" unit="sessions" min={1} max={12} value={draft.pomodoro.cycles} onChange={(cycles) => patch({ cycles })} />
      </div>
      <p className="t-caption muted">If a block doesn’t divide evenly, the last pomodoro is shortened so the block ends on time.</p>
    </>
  );
}

export function AlertsStep({ draft, set }: StepProps) {
  const patch = (change: Partial<Draft["alerts"]>) => set({ alerts: { ...draft.alerts, ...change } });
  return (
    <>
      <Intro title="How should Mentem get your attention?" body="The timer runs in the background so your day keeps moving even when the window is closed." />
      <div className="group">
        <SwitchRow title="Play a sound at each change" body="Work to break, break to work, and new blocks." checked={draft.alerts.sound} onChange={(sound) => patch({ sound })} />
        <SwitchRow title="Show notifications" body="A quiet nudge on the desktop when something changes." checked={draft.alerts.notifications} onChange={(notifications) => patch({ notifications })} />
        <SwitchRow title="Keep running in the tray" body="Closing the window won’t stop your timer." checked={draft.alerts.tray} onChange={(tray) => patch({ tray })} />
        <SwitchRow title="Start when I log in" body="So your day begins without you opening anything." checked={draft.alerts.startOnLogin} onChange={(startOnLogin) => patch({ startOnLogin })} />
      </div>
    </>
  );
}

function ThemeOption({ theme, selected, onPick }: { theme: ThemeId; selected: boolean; onPick(): void }) {
  return (
    <div className="theme-option">
      <button className={`theme-card ${selected ? "theme-card--on" : ""}`} data-theme={theme} aria-pressed={selected} onClick={onPick}>
        <span className="t-label theme-card__label">Now</span>
        <span className="t-timer theme-card__time">18:42</span>
        <span className="theme-card__bar"><span /></span>
        <span className="theme-card__start">Start</span>
      </button>
      <span className="theme-option__name">
        <span className="t-body-m-strong">{THEME_NAMES[theme]}</span>
        {selected && <span className="t-caption muted">Selected</span>}
      </span>
    </div>
  );
}

export function ThemeStep({ draft, set }: StepProps) {
  return (
    <>
      <Intro title="Pick your look" body="Light or dark, each with two accent colors. You can change it whenever you like." />
      <div className="theme-groups">
        <div className="field">
          <span className="t-body-m-strong">Day</span>
          <div className="theme-pair">
            {(["white-green", "white-black"] as const).map((t) => (
              <ThemeOption key={t} theme={t} selected={draft.theme === t} onPick={() => set({ theme: t })} />
            ))}
          </div>
        </div>
        <div className="field">
          <span className="t-body-m-strong">Night</span>
          <div className="theme-pair">
            {(["black-orange", "black-white"] as const).map((t) => (
              <ThemeOption key={t} theme={t} selected={draft.theme === t} onPick={() => set({ theme: t })} />
            ))}
          </div>
        </div>
      </div>
      <div className="group">
        <SwitchRow title="Match my system" body="Switch between Day and Night automatically, keeping the accent you picked." checked={draft.matchSystem} onChange={(matchSystem) => set({ matchSystem })} />
      </div>
    </>
  );
}

export function SummaryStep({ draft, error, saving, onStart, onBack }: { draft: Draft; error: string; saving: boolean; onStart(): void; onBack(): void }): ReactNode {
  const name = draft.userName.trim();
  return (
    <>
      <Intro title={name ? `You’re all set, ${name}.` : "You’re all set."} body="Here’s what we set up. Everything can be changed in settings." />
      <div className="group">
        {summaryRows(draft).map(([label, value]) => (
          <div key={label} className="summary-row">
            <span className="t-caption muted">{label}</span>
            <span className="t-body-l">{value}</span>
          </div>
        ))}
      </div>
      <div className="summary-actions">
        <Button disabled={saving} onClick={onStart}>
          {saving ? "Starting…" : "Start my day"}
        </Button>
        <Button variant="ghost" disabled={saving} onClick={onBack}>
          Back
        </Button>
        {error && <span className="t-caption danger-text">{error}</span>}
      </div>
    </>
  );
}

export const STEP_BODIES = [NameStep, PlatformStep, WorkStyleStep, DayStep, RoutineStep, BlocksStep, WeekStep, RhythmStep, AlertsStep, ThemeStep];
