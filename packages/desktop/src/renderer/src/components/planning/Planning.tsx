import { motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import type { PlanningData } from "@shared/api";
import { blockTime } from "../../lib/time";
import { Mark } from "../Mark";
import { Button } from "../ui";
import { DRAG_TYPE } from "../today/TaskRow";

const ease = [0.16, 1, 0.3, 1] as const;
const STEPS = 4;

/** What is waiting to be scheduled, and a place to add more before planning begins. */
function WaitingStep({ data, reload }: { data: PlanningData; reload(): void }) {
  const [title, setTitle] = useState("");
  const last = new Set(data.lastWeek);
  const rows = [...data.week.unscheduled.filter((t) => last.has(t.id)), ...data.week.unscheduled.filter((t) => !last.has(t.id))];
  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const text = title.trim();
          if (!text) return;
          setTitle("");
          void window.mentem.taskCreate(text).then(reload);
        }}
      >
        <input className="input" autoFocus aria-label="Add a task" placeholder="Add a task…" maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} />
      </form>
      <div className="plan__left plan__left--wide">
        {rows.map((t) => (
          <div key={t.id} className="task-row">
            <span className="task-row__check" aria-hidden="true" />
            <span className="task-row__title">{t.title}</span>
            {last.has(t.id) && <span className="chip">Last week</span>}
          </div>
        ))}
        {rows.length === 0 && <span className="t-body-m muted">Nothing is waiting. Add what you want to get done this week.</span>}
      </div>
    </>
  );
}

function ScheduleStep({ data, reload }: { data: PlanningData; reload(): void }) {
  const last = new Set(data.lastWeek);
  const lastTasks = data.week.unscheduled.filter((t) => last.has(t.id));
  const other = data.week.unscheduled.filter((t) => !last.has(t.id));
  const [over, setOver] = useState<string | null>(null);
  const place = (id: string, date: string, slot: number) => void window.mentem.taskPlace(id, date, slot).then(reload);
  const unplace = (id: string) => void window.mentem.taskPlace(id, null, null).then(reload);
  const row = (id: string, title: string, chip?: string) => (
    <div key={id} className="task-row plan__task" draggable onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, id); e.dataTransfer.effectAllowed = "move"; }}>
      <span className="task-row__check" aria-hidden="true" />
      <span className="task-row__title">{title}</span>
      {chip && <span className="chip">{chip}</span>}
    </div>
  );
  return (
    <div className="plan__schedule">
      <div
        className={`plan__left ${over === "left" ? "plan__left--over" : ""}`}
        onDragOver={(e) => { if (e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); setOver("left"); } }}
        onDragLeave={() => setOver(null)}
        onDrop={(e) => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData(DRAG_TYPE); if (id) unplace(id); }}
      >
        <h2 className="t-h-m">Unscheduled</h2>
        {lastTasks.length > 0 && <span className="t-caption muted">From last week</span>}
        {lastTasks.map((t) => row(t.id, t.title, "Last week"))}
        {other.length > 0 && <span className="t-caption muted">Other</span>}
        {other.map((t) => row(t.id, t.title))}
        {data.week.unscheduled.length === 0 && <span className="t-body-m muted">Everything is scheduled.</span>}
      </div>
      <div className="plan__grid">
        {data.week.days.map((day) => (
          <div key={day.date} className={`plan__day ${day.past ? "plan__day--past" : ""}`}>
            <span className="t-caption muted">{day.weekday}</span>
            <span className="t-h-m plan__num">{day.day}</span>
            {day.blocks.length === 0 && <span className="t-caption muted">No template</span>}
            {day.blocks.map((b) => {
              const key = `${day.date}:${b.slot}`;
              return (
                <div
                  key={key}
                  className={`plan__slot ${b.tasks.length === 0 ? "plan__slot--empty" : ""} ${over === key ? "plan__slot--over" : ""}`}
                  onDragOver={(e) => { if (!day.past && e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); setOver(key); } }}
                  onDragLeave={() => setOver(null)}
                  onDrop={(e) => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData(DRAG_TYPE); if (id && !day.past) place(id, day.date, b.slot); }}
                >
                  <span className="t-caption muted">{b.name}</span>
                  {b.tasks.map((t) => (
                    <span
                      key={t.id}
                      className="t-body-m-strong plan__placed"
                      draggable={!t.done}
                      onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, t.id); e.dataTransfer.effectAllowed = "move"; }}
                    >
                      <span className="plan__placed-title">{t.title}</span>
                      {!t.done && (
                        <button className="plan__placed-x" aria-label={`Unschedule ${t.title}`} onClick={() => unplace(t.id)}>
                          ×
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function TemplatesStep({ data, reload, onEdit }: { data: PlanningData; reload(): void; onEdit(): void }) {
  return (
    <>
      <div className="group">
        {data.week.days.map((day) => (
          <div key={day.date} className="plan__tpl-row">
            <span className="t-body-m-strong plan__tpl-day">
              {day.weekday} {day.day}
            </span>
            <span className="dropdown plan__tpl-select">
              <select aria-label={`Template for ${day.weekday} ${day.day}`} value={day.templateId ?? ""} onChange={(e) => void window.mentem.dayTemplateSet(day.date, e.target.value || null).then(reload)}>
                {!day.templateId && <option value="">No template</option>}
                {data.week.templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </span>
            <span className="t-caption muted">{day.summary}</span>
          </div>
        ))}
      </div>
      <button className="drawer__add" onClick={onEdit}>
        Edit templates
      </button>
    </>
  );
}

function DifferentStep({ data, reload }: { data: PlanningData; reload(): void }) {
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <>
      <div className="plan__cards">
        {data.week.days.map((day) => (
          <button key={day.date} className={`plan__card ${picked === day.date ? "plan__card--on" : ""}`} onClick={() => setPicked(picked === day.date ? null : day.date)} aria-pressed={picked === day.date}>
            <span className="t-caption muted">{day.weekday}</span>
            <span className="t-h-l plan__num">{day.day}</span>
            <span className="t-body-m-strong">{day.template ?? "No template"}</span>
          </button>
        ))}
      </div>
      {picked && (
        <div className="menu menu--static" role="menu">
          {data.week.templates.map((t) => (
            <button key={t.id} role="menuitem" className={t.id === data.week.days.find((d) => d.date === picked)?.templateId ? "menu__item menu__item--on" : "menu__item"} onClick={() => void window.mentem.dayTemplateSet(picked, t.id).then(() => { setPicked(null); reload(); })}>
              {t.name}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/** The guided planning flow: schedule, check templates, change a day. Opens full screen. */
export function Planning({ onClose, onEditTemplates }: { onClose(): void; onEditTemplates(): void }) {
  const [step, setStep] = useState(1);
  const [data, setData] = useState<PlanningData | null>(null);
  const load = useCallback(() => void window.mentem.planningGet().then(setData), []);
  useEffect(load, [load]);
  if (!data) return null;
  const titles = ["What’s waiting?", "Schedule your week", "Your templates this week", "Any day different this week?"];
  const width = step === 1 || step === 3 ? 720 : 1000;

  return (
    <motion.div className="planning" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.22, ease }}>
      <div className="onboarding__progress">
        <span style={{ width: `${(step / STEPS) * 100}%` }} />
      </div>
      <header className="onboarding__header">
        <div className="onboarding__brand">
          <Mark size={32} variant="small" />
          <span className="t-h-m">Mentem</span>
        </div>
        <span className="t-caption muted">
          Step {step} of {STEPS}
        </span>
      </header>
      <div className="onboarding__body">
        <section className="onboarding__content" style={{ width }}>
          <h1 className="t-h-xl onboarding__title">{titles[step - 1]}</h1>
          {step === 1 && <WaitingStep data={data} reload={load} />}
          {step === 2 && <ScheduleStep data={data} reload={load} />}
          {step === 3 && <TemplatesStep data={data} reload={load} onEdit={onEditTemplates} />}
          {step === 4 && <DifferentStep data={data} reload={load} />}
        </section>
      </div>
      <footer className="onboarding__footer" style={{ width }}>
        {step > 1 ? (
          <Button variant="ghost" onClick={() => setStep(step - 1)}>
            Back
          </Button>
        ) : (
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        )}
        {step < STEPS ? <Button onClick={() => setStep(step + 1)}>Continue</Button> : <Button onClick={onClose}>Finish</Button>}
      </footer>
    </motion.div>
  );
}
