import { AnimatePresence } from "motion/react";
import { useState } from "react";
import type { TimerView, TodayData } from "@shared/api";
import { blockTime, formatTime } from "../../lib/time";
import { DRAG_TYPE, TaskRow } from "./TaskRow";

interface DayListProps {
  hideDone: boolean;
  data: TodayData;
  timer: TimerView | null;
  onToggle(id: string, done: boolean): void;
  onOpen(id: string): void;
  onDrop(id: string, slot: number): void;
}

type Entry =
  | { kind: "routine"; at: number; item: TodayData["routine"][number] }
  | { kind: "block"; at: number; block: TodayData["blocks"][number] };

function Done() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-label="Done">
      <circle cx="8" cy="8" r="6.5" />
      <path d="m5.3 8.2 1.9 1.9 3.5-3.7" />
    </svg>
  );
}

function Block({ block, current, timer, hideDone, onToggle, onOpen, onDrop }: { block: TodayData["blocks"][number]; current: boolean; timer: TimerView | null } & Pick<DayListProps, "hideDone" | "onToggle" | "onOpen" | "onDrop">) {
  const [over, setOver] = useState(false);
  const finished = block.tasks.length > 0 && block.tasks.every((t) => t.done);
  const shown = hideDone ? block.tasks.filter((t) => !t.done) : block.tasks;
  const count = finished ? `${block.tasks.length} of ${block.tasks.length}` : `${block.used} of ${block.capacity}`;
  const accept = (event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
    event.preventDefault();
    setOver(true);
  };
  return (
    <section
      className={`block ${over ? "block--over" : ""}`}
      onDragOver={accept}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        const id = event.dataTransfer.getData(DRAG_TYPE);
        if (id) onDrop(id, block.slot);
      }}
    >
      <header className="block__header">
        <h2 className="t-h-m">{block.name}</h2>
        <span className="t-caption block__meta">
          {blockTime(block.startMin)} – {blockTime(block.endMin)} · {count}
        </span>
      </header>
      {finished && hideDone ? (
        <p className="drop-zone t-body-m">All done</p>
      ) : block.tasks.length === 0 ? (
        <div className="drop-zone t-body-m">
          <span aria-hidden="true">+</span> Drop a task
        </div>
      ) : (
        <ul className="task-list">
          <AnimatePresence initial={false}>
            {shown.map((task) => (
              <TaskRow key={task.id} task={task} current={current && timer?.task?.id === task.id} onToggle={(done) => onToggle(task.id, done)} onOpen={() => onOpen(task.id)} />
            ))}
          </AnimatePresence>
        </ul>
      )}
    </section>
  );
}

/** Routine items and work blocks in the order the day runs. */
export function DayList({ data, timer, hideDone, onToggle, onOpen, onDrop }: DayListProps) {
  const entries: Entry[] = [
    ...data.routine.map((item): Entry => ({ kind: "routine", at: item.startMin, item })),
    ...data.blocks.map((block): Entry => ({ kind: "block", at: block.startMin, block })),
  ]
    // Once the day has started the wake-up item is behind you; it still shows when looking ahead to tomorrow.
    .filter((entry) => !(entry.kind === "routine" && entry.item.past && entry.item.title === "Wake up"))
    .sort((a, b) => a.at - b.at);

  return (
    <div className="day-list">
      {data.heading && <h2 className="t-h-m day-list__heading">{data.heading}</h2>}
      {entries.map((entry) => {
        if (entry.kind === "routine") {
          const active = timer?.routine.some((r) => r.title === entry.item.title) ?? false;
          return (
            <div key={`r${entry.item.id}`} className={`routine ${active ? "routine--active" : ""} ${entry.item.past ? "routine--past" : ""}`}>
              <span className="t-caption routine__time">{formatTime(entry.item.startMin)}</span>
              <span className="t-body-m routine__title">{entry.item.title}</span>
              {entry.item.past && <Done />}
            </div>
          );
        }
        const current = timer?.blockName === entry.block.name && (timer.kind === "work" || timer.kind === "break");
        return <Block key={`b${entry.block.slot}`} block={entry.block} current={current} timer={timer} hideDone={hideDone} onToggle={onToggle} onOpen={onOpen} onDrop={onDrop} />;
      })}
    </div>
  );
}
