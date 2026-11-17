import { AnimatePresence } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { TodayData } from "@shared/api";
import { DRAG_TYPE, TaskRow } from "./TaskRow";

interface UnscheduledProps {
  /** Changes each time the add field should take the focus. */
  focusSignal: number;
  tasks: TodayData["unscheduled"];
  onCreate(title: string): void;
  onToggle(id: string, done: boolean): void;
  onOpen(id: string): void;
  /** A task dropped here goes back to Unscheduled. */
  onDrop(id: string): void;
}

export function Unscheduled({ focusSignal, tasks, onCreate, onToggle, onOpen, onDrop }: UnscheduledProps) {
  const [draft, setDraft] = useState("");
  const [over, setOver] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusSignal > 0) field.current?.focus();
  }, [focusSignal]);
  return (
    <aside
      className={`unscheduled ${over ? "unscheduled--over" : ""}`}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        const id = event.dataTransfer.getData(DRAG_TYPE);
        if (id) onDrop(id);
      }}
    >
      <header>
        <h2 className="t-h-m">Unscheduled</h2>
        <span className="t-caption unscheduled__count">{tasks.length}</span>
      </header>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const text = draft.trim();
          if (!text) return;
          onCreate(text);
          setDraft("");
        }}
      >
        <input ref={field} className="input" aria-label="Add a task" placeholder="Add a task…" maxLength={160} value={draft} onChange={(e) => setDraft(e.target.value)} />
      </form>
      <ul className="task-list task-list--loose">
        <AnimatePresence initial={false}>
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} onToggle={(done) => onToggle(task.id, done)} onOpen={() => onOpen(task.id)} />
          ))}
        </AnimatePresence>
      </ul>
    </aside>
  );
}
