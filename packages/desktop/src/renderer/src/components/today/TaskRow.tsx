import { motion } from "motion/react";
import type { TaskView } from "@shared/api";

const ease = [0.16, 1, 0.3, 1] as const;
export const DRAG_TYPE = "application/x-mentem-task";

interface TaskRowProps {
  task: TaskView;
  current?: boolean;
  onToggle(done: boolean): void;
  /** Click the title to open the task. */
  onOpen?(): void;
}

export function DueChip({ due }: { due: NonNullable<TaskView["due"]> }) {
  return <span className={`chip ${due.tone === "danger" ? "chip--danger" : ""}`}>{due.label}</span>;
}

/** A task in a list. It can be dragged into a block, or back to Unscheduled. */
export function TaskRow({ task, current, onToggle, onOpen }: TaskRowProps) {
  return (
    <motion.li layout="position" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.12 } }} transition={{ duration: 0.22, ease }}>
      <div
        className={`task-row ${task.done ? "task-row--done" : ""} ${current ? "task-row--current" : ""}`}
        draggable={!task.done}
        onDragStart={(event) => {
          event.dataTransfer.setData(DRAG_TYPE, task.id);
          event.dataTransfer.effectAllowed = "move";
        }}
      >
        <button className="task-row__check" role="checkbox" aria-checked={task.done} aria-label={task.done ? `Reopen ${task.title}` : `Complete ${task.title}`} onClick={() => onToggle(!task.done)}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <motion.path
              d="M2.5 6.2 5 8.6 9.5 3.6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={false}
              animate={{ pathLength: task.done ? 1 : 0, opacity: task.done ? 1 : 0 }}
              transition={{ duration: 0.2, ease }}
            />
          </svg>
        </button>
        {onOpen ? (
          <button className="task-row__title" onClick={onOpen}>
            {task.title}
          </button>
        ) : (
          <span className="task-row__title">{task.title}</span>
        )}
        {task.due && <DueChip due={task.due} />}
      </div>
    </motion.li>
  );
}
