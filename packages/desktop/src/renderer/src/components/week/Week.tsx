import { useCallback, useEffect, useState } from "react";
import type { WeekData, WeekDay } from "@shared/api";
import { blockTime } from "../../lib/time";
import { Button } from "../ui";
import { DRAG_TYPE } from "../today/TaskRow";
import type { ToastMessage } from "../Toast";

interface WeekProps {
  tick: number;
  onOpenTask(id: string): void;
  onToast(message: ToastMessage): void;
  onChange(): void;
}

function DayMenu({ day, templates, onPick }: { day: WeekDay; templates: WeekData["templates"]; onPick(id: string | null): void }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="day-menu">
      <button className="icon-button" aria-label={`Options for ${day.weekday} ${day.day}`} aria-expanded={open} onClick={() => setOpen(!open)} onBlur={() => window.setTimeout(() => setOpen(false), 120)}>
        ···
      </button>
      {open && (
        <div className="menu" role="menu">
          <span className="t-label muted menu__title">Use for this day</span>
          {templates.map((t) => (
            <button key={t.id} role="menuitem" className={t.name === day.template ? "menu__item menu__item--on" : "menu__item"} onMouseDown={() => { setOpen(false); onPick(t.id); }}>
              {t.name}
            </button>
          ))}
          <button role="menuitem" className="menu__item" onMouseDown={() => { setOpen(false); onPick(null); }}>
            Week default
          </button>
        </div>
      )}
    </span>
  );
}

function DayColumn({ day, templates, onOpenTask, onDrop, onPick }: { day: WeekDay; templates: WeekData["templates"]; onOpenTask(id: string): void; onDrop(id: string, date: string, slot: number): void; onPick(id: string | null): void }) {
  const [over, setOver] = useState<number | null>(null);
  return (
    <section className={`week-day ${day.isToday ? "week-day--today" : ""} ${day.past ? "week-day--past" : ""}`}>
      <header>
        <div>
          <span className="t-caption muted">{day.weekday}</span>
          <div className={`week-day__number t-h-l ${day.isToday ? "accent-text" : ""}`}>{day.day}</div>
          <span className="t-caption muted">{day.template ?? "No template"}</span>
        </div>
        <DayMenu day={day} templates={templates} onPick={onPick} />
      </header>
      {day.blocks.map((block) => (
        <div
          key={block.slot}
          className={`week-block ${over === block.slot ? "week-block--over" : ""}`}
          onDragOver={(e) => {
            if (day.past || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
            e.preventDefault();
            setOver(block.slot);
          }}
          onDragLeave={() => setOver(null)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(null);
            const id = e.dataTransfer.getData(DRAG_TYPE);
            if (id && !day.past) onDrop(id, day.date, block.slot);
          }}
        >
          <div className="week-block__header">
            <span className="t-body-m-strong">{block.name}</span>
            <span className="t-caption muted">
              {blockTime(block.startMin)} – {blockTime(block.endMin)}
            </span>
          </div>
          {block.tasks.map((task) => (
            <button
              key={task.id}
              draggable={!task.done}
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_TYPE, task.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              className={`week-task ${task.done ? "week-task--done" : ""} ${task.current ? "week-task--current" : ""} ${task.overdue ? "week-task--overdue" : ""}`}
              onClick={() => onOpenTask(task.id)}
            >
              {task.title}
            </button>
          ))}
        </div>
      ))}
      {day.isWeekEnd && <span className="t-label muted week-day__ends">Week ends</span>}
    </section>
  );
}

export function Week({ tick, onOpenTask, onToast, onChange }: WeekProps) {
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<WeekData | null>(null);
  const [overStrip, setOverStrip] = useState(false);
  const load = useCallback(() => void window.mentem.weekGet(offset).then(setData), [offset]);
  useEffect(load, [load, tick]);
  if (!data) return null;

  const place = (id: string, date: string | null, slot: number | null) => void window.mentem.taskPlace(id, date, slot).then(() => { load(); onChange(); });
  const pick = (date: string, templateId: string | null) =>
    void window.mentem.dayTemplateSet(date, templateId).then((summary) => {
      load();
      onChange();
      onToast({ text: summary.moved ? `Template changed · ${summary.moved} ${summary.moved === 1 ? "task" : "tasks"} moved` : "Template changed", action: { label: "Undo", run: () => void window.mentem.dayTemplateUndo().then(() => { load(); onChange(); }) } });
    });

  return (
    <>
      <header className="page-header">
        <div className="page-header__title">
          <h1 className="t-h-l">Week</h1>
          <span className="t-body-m muted">{data.label}</span>
        </div>
        <div className="page-header__actions">
          <button className="square-button" aria-label="Previous week" onClick={() => setOffset(offset - 1)}>
            ‹
          </button>
          <button className="square-button" aria-label="Next week" onClick={() => setOffset(offset + 1)}>
            ›
          </button>
          <Button variant="secondary" onClick={() => setOffset(0)}>
            Today
          </Button>
        </div>
      </header>
      <div className="week-grid">
        {data.days.map((day) => (
          <DayColumn key={day.date} day={day} templates={data.templates} onOpenTask={onOpenTask} onDrop={(id, date, slot) => place(id, date, slot)} onPick={(templateId) => pick(day.date, templateId)} />
        ))}
      </div>
      <div
        className={`week-strip ${overStrip ? "week-strip--over" : ""}`}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
          e.preventDefault();
          setOverStrip(true);
        }}
        onDragLeave={() => setOverStrip(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOverStrip(false);
          const id = e.dataTransfer.getData(DRAG_TYPE);
          if (id) place(id, null, null);
        }}
      >
        <h2 className="t-h-m">Unscheduled</h2>
        {data.unscheduled.map((task) => (
          <button
            key={task.id}
            className="week-chip"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(DRAG_TYPE, task.id);
              e.dataTransfer.effectAllowed = "move";
            }}
            onClick={() => onOpenTask(task.id)}
          >
            {task.title}
          </button>
        ))}
      </div>
    </>
  );
}
