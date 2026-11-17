import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import type { TaskDetail, TaskStatus } from "@shared/api";
import { Button, Pill } from "../ui";
import { RepeatEditor } from "../RepeatEditor";

const ease = [0.16, 1, 0.3, 1] as const;

interface TaskDrawerProps {
  taskId: string | null;
  onClose(): void;
  /** Something changed that other pages show. */
  onChange(): void;
  onWorkOn(id: string): void;
}

const STATUSES: Array<{ id: TaskStatus; label: string }> = [
  { id: "open", label: "Open" },
  { id: "in_progress", label: "In progress" },
  { id: "done", label: "Done" },
];

function CheckRow({ text, done, depth = 0, onToggle }: { text: string; done: boolean; depth?: number; onToggle(done: boolean): void }) {
  return (
    <div className={`drawer__check ${done ? "drawer__check--done" : ""}`} style={{ paddingLeft: depth * 28 }}>
      <button className="task-row__check" role="checkbox" aria-checked={done} aria-label={text} onClick={() => onToggle(!done)}>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 6.2 5 8.6 9.5 3.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: done ? 1 : 0 }} />
        </svg>
      </button>
      <span>{text}</span>
    </div>
  );
}

function AddLine({ label, onAdd }: { label: string; onAdd(text: string): void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  if (!open)
    return (
      <button className="drawer__add" onClick={() => setOpen(true)}>
        <span aria-hidden="true">+</span> {label}
      </button>
    );
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (text.trim()) onAdd(text.trim());
        setText("");
        setOpen(false);
      }}
    >
      <input className="input" autoFocus aria-label={label} maxLength={160} value={text} onChange={(e) => setText(e.target.value)} onBlur={() => !text && setOpen(false)} />
    </form>
  );
}

export function TaskDrawer({ taskId, onClose, onChange, onWorkOn }: TaskDrawerProps) {
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [repeating, setRepeating] = useState(false);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!taskId) return;
    let live = true;
    void window.mentem.taskGet(taskId).then((t) => {
      if (!live) return;
      setTask(t);
      setTitle(t.title);
      setNotes(t.notes);
    });
    return () => {
      live = false;
    };
  }, [taskId]);

  useEffect(() => {
    if (!taskId) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && !confirming && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [taskId, confirming, onClose]);

  const apply = (next: Promise<TaskDetail>) =>
    void next.then((t) => {
      setTask(t);
      onChange();
    });
  const patch = (change: Parameters<typeof window.mentem.taskUpdate>[1]) => task && apply(window.mentem.taskUpdate(task.id, change));
  const project = task?.projects.find((p) => p.id === task.projectId);

  return (
    <AnimatePresence>
      {taskId && task && (
        <>
          <motion.div key="scrim" className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onClick={onClose} />
          <motion.aside key="drawer" className="drawer" role="dialog" aria-label="Task" initial={{ x: 320, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 320, opacity: 0 }} transition={{ duration: 0.32, ease }}>
            <header className="drawer__top">
              <span className="t-label muted">Task</span>
              <div className="drawer__icons">
                <button className="icon-button" aria-label="Delete task" onClick={() => setConfirming(true)}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
                  </svg>
                </button>
                <button className="icon-button" aria-label="Close" onClick={onClose}>
                  ×
                </button>
              </div>
            </header>

            <div className="drawer__body">
              <textarea className="drawer__title t-h-xl" aria-label="Title" rows={2} maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title.trim() && title !== task.title && patch({ title })} />
              <div className="pills">
                {STATUSES.map((s) => (
                  <Pill key={s.id} selected={task.status === s.id} onClick={() => patch({ status: s.id })}>
                    {s.label}
                  </Pill>
                ))}
              </div>

              <div className="drawer__grid">
                <label className="field">
                  <span className="t-caption muted">Project</span>
                  <span className="dropdown">
                    <select value={task.projectId ?? ""} onChange={(e) => patch({ projectId: e.target.value || null, deliverableId: null })}>
                      <option value="">None</option>
                      {task.projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </span>
                </label>
                <label className="field">
                  <span className="t-caption muted">Deliverable</span>
                  <span className="dropdown">
                    <select disabled={!project} value={task.deliverableId ?? ""} onChange={(e) => patch({ deliverableId: e.target.value || null })}>
                      <option value="">None</option>
                      {project?.deliverables.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.title}
                        </option>
                      ))}
                    </select>
                  </span>
                </label>
                <label className="field">
                  <span className="t-caption muted">Due</span>
                  <input className="input" type="date" value={task.due ?? ""} onChange={(e) => patch({ due: e.target.value || null })} />
                </label>
                <div className="field">
                  <span className="t-caption muted">Estimate</span>
                  <div className="stepper">
                    <button aria-label="Fewer pomodoros" disabled={(task.estimate ?? 0) <= 1} onClick={() => patch({ estimate: Math.max(1, (task.estimate ?? 2) - 1) })}>
                      −
                    </button>
                    <span className="stepper__value">{task.estimate ?? "–"}</span>
                    <button aria-label="More pomodoros" onClick={() => patch({ estimate: Math.min(99, (task.estimate ?? 0) + 1) })}>
                      +
                    </button>
                  </div>
                </div>
              </div>

              <section className="drawer__section">
                <span className="t-caption muted">Steps</span>
                {task.steps.map((s) => (
                  <CheckRow key={s.id} text={s.text} done={s.done} onToggle={(done) => apply(window.mentem.stepToggle(task.id, s.id, done))} />
                ))}
                <AddLine label="Add a step" onAdd={(text) => apply(window.mentem.stepAdd(task.id, text))} />
              </section>

              <section className="drawer__section">
                <span className="t-caption muted">Assigned</span>
                <div className="pills">
                  {task.assigned ? (
                    <>
                      <Pill selected>{task.assigned.label}</Pill>
                      {task.blocks.map((b) => (
                        <Pill key={b.slot} selected={task.assigned?.slot === b.slot} onClick={() => task.assigned && apply(window.mentem.taskPlace(task.id, task.assigned.date, b.slot))}>
                          {b.name}
                        </Pill>
                      ))}
                      <Pill onClick={() => apply(window.mentem.taskPlace(task.id, null, null))}>Unschedule</Pill>
                    </>
                  ) : (
                    <>
                      <Pill selected>Unscheduled</Pill>
                      {task.blocks.map((b) => (
                        <Pill key={b.slot} onClick={() => apply(window.mentem.taskPlace(task.id, task.today, b.slot))}>
                          {b.name}
                        </Pill>
                      ))}
                    </>
                  )}
                </div>
                <div className="drawer__repeat">
                  <button
                    className={`toggle ${task.repeat ? "toggle--on" : ""}`}
                    role="switch"
                    aria-checked={!!task.repeat}
                    aria-label="Repeat"
                    disabled={!task.assigned}
                    onClick={() => (task.repeat ? apply(window.mentem.taskRepeatSet(task.id, null)) : setRepeating(true))}
                  >
                    <span className="toggle__knob" />
                  </button>
                  {task.repeat ? (
                    <button className="drawer__repeat-label" onClick={() => setRepeating(true)}>
                      {task.repeat.label}
                    </button>
                  ) : (
                    <span className={task.assigned ? "" : "muted"}>{task.assigned ? "Repeat" : "Repeat · schedule it first"}</span>
                  )}
                </div>
                {task.workable && task.status !== "done" && (
                  <Button variant="secondary" onClick={() => onWorkOn(task.id)}>
                    Work on this now
                  </Button>
                )}
              </section>

              <section className="drawer__section">
                <h3 className="t-h-l drawer__heading">Subtasks</h3>
                {task.subtasks.map((s) => (
                  <CheckRow key={s.id} text={s.title} done={s.done} depth={s.depth - 1} onToggle={(done) => apply(window.mentem.subtaskToggle(task.id, s.id, done))} />
                ))}
                <AddLine label="Add subtask" onAdd={(text) => apply(window.mentem.subtaskAdd(task.id, text))} />
              </section>

              <label className="drawer__section">
                <span className="t-caption muted">Notes</span>
                <textarea className="input drawer__notes" placeholder="Add notes" rows={4} maxLength={5000} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== task.notes && patch({ notes })} />
              </label>
            </div>

            <AnimatePresence>
              {repeating && task.assigned && (
                <RepeatEditor
                  rule={task.repeat?.rule ?? null}
                  anchor={task.assigned.date}
                  kind="task"
                  title="Repeat"
                  onClose={() => setRepeating(false)}
                  onSave={(rule) => {
                    setRepeating(false);
                    if (rule) apply(window.mentem.taskRepeatSet(task.id, rule));
                  }}
                />
              )}
            </AnimatePresence>
            <AnimatePresence>
              {confirming && (
                <motion.div className="dialog-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
                  <motion.div className="dialog" role="alertdialog" initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.22, ease }}>
                    <h3 className="t-h-l">Delete this task?</h3>
                    <p className="t-body-m muted">{task.subtasks.length ? "It has subtasks. Keep them as tasks of their own, or delete everything." : "This can’t be undone."}</p>
                    <div className="dialog__actions">
                      <Button variant="ghost" onClick={() => setConfirming(false)}>
                        Cancel
                      </Button>
                      {task.subtasks.length > 0 && (
                        <Button
                          variant="secondary"
                          onClick={() => void window.mentem.taskDelete(task.id, "detach").then(() => { onChange(); onClose(); })}
                        >
                          Keep subtasks
                        </Button>
                      )}
                      <Button onClick={() => void window.mentem.taskDelete(task.id, "delete").then(() => { onChange(); onClose(); })}>{task.subtasks.length ? "Delete all" : "Delete"}</Button>
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
