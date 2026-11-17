import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import type { ChipTone, NewProject, ProjectCard, ProjectDetail } from "@shared/api";
import { Button, Pill } from "../ui";
import { TaskRow } from "../today/TaskRow";

const ease = [0.16, 1, 0.3, 1] as const;
type Kind = NewProject["deliverables"][number]["type"];
const KINDS: Array<{ id: Kind; label: string }> = [
  { id: "deliverable", label: "Deliverable" },
  { id: "milestone", label: "Milestone" },
  { id: "deadline", label: "Deadline" },
];

const toneClass = (tone: ChipTone) => (tone === "danger" ? "chip chip--danger" : tone === "accent" ? "chip chip--accent-outline" : "chip");
const KIND_CHIP: Record<Kind, string> = { deliverable: "chip", milestone: "chip chip--accent-outline", deadline: "chip chip--danger" };

function Meter({ done, total }: { done: number; total: number }) {
  return (
    <div className="project__meter">
      <span style={{ width: total ? `${(done / total) * 100}%` : 0 }} />
    </div>
  );
}

/** A small modal with a title, used for creating and adding. */
function Modal({ title, onClose, children }: { title: string; onClose(): void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <motion.div className="dialog-scrim dialog-scrim--page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} onMouseDown={onClose}>
      <motion.div className="dialog dialog--wide" role="dialog" aria-label={title} initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.22, ease }} onMouseDown={(e) => e.stopPropagation()}>
        <header className="dialog__head">
          <h3 className="t-h-l">{title}</h3>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        {children}
      </motion.div>
    </motion.div>
  );
}

function NewProjectDialog({ onClose, onCreate }: { onClose(): void; onCreate(project: NewProject): void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [context, setContext] = useState("");
  const [rows, setRows] = useState<NewProject["deliverables"]>([]);
  const set = (i: number, change: Partial<NewProject["deliverables"][number]>) => setRows(rows.map((r, n) => (n === i ? { ...r, ...change } : r)));
  return (
    <Modal title="New project" onClose={onClose}>
      <div className="dialog__form">
        <label className="field">
          <span className="t-caption muted">Name</span>
          <input className="input" autoFocus placeholder="Project name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span className="t-caption muted">Description</span>
          <input className="input" placeholder="What is it for?" maxLength={200} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label className="field">
          <span className="t-caption muted">Context</span>
          <textarea className="input drawer__notes" placeholder="Notes, links, anything to remember" rows={3} maxLength={2000} value={context} onChange={(e) => setContext(e.target.value)} />
        </label>
        <div className="field">
          <span className="t-body-m-strong">Deliverables</span>
          {rows.map((row, i) => (
            <div key={i} className="project__row">
              {KINDS.map((k) => (
                <Pill key={k.id} selected={row.type === k.id} onClick={() => set(i, { type: k.id })}>
                  {k.label}
                </Pill>
              ))}
              <input className="input" aria-label="Deliverable title" maxLength={80} value={row.title} onChange={(e) => set(i, { title: e.target.value })} />
            </div>
          ))}
          <button className="drawer__add" onClick={() => setRows([...rows, { type: "deliverable", title: "" }])}>
            <span aria-hidden="true">+</span> Add deliverable
          </button>
        </div>
      </div>
      <div className="dialog__actions">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={!name.trim()} onClick={() => onCreate({ name: name.trim(), description: description.trim(), context, deliverables: rows.filter((r) => r.title.trim()) })}>
          Create project
        </Button>
      </div>
    </Modal>
  );
}

function Detail({ id, tick, onBack, onOpenTask, onChange }: { id: string; tick: number; onBack(): void; onOpenTask(id: string): void; onChange(): void }) {
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [dialog, setDialog] = useState<null | "deliverable" | "task">(null);
  const [editing, setEditing] = useState(false);
  const [context, setContext] = useState("");
  const load = useCallback(() => void window.mentem.projectGet(id).then((p) => { setProject(p); setContext(p.context); }), [id]);
  useEffect(load, [load, tick]);
  if (!project) return null;
  const apply = (next: Promise<ProjectDetail>) => void next.then((p) => { setProject(p); onChange(); });

  return (
    <>
      <header className="page-header">
        <div className="page-header__title">
          <button className="icon-button" aria-label="Back to projects" onClick={onBack}>
            ‹
          </button>
          <h1 className="t-h-l">{project.name}</h1>
          <span className="t-body-m muted">
            {project.done} of {project.total} tasks
          </span>
        </div>
        <div className="page-header__actions">
          <Button variant="secondary" onClick={() => setDialog("deliverable")}>
            Add deliverable
          </Button>
          <Button onClick={() => setDialog("task")}>Add task</Button>
        </div>
      </header>
      <div className="project__columns">
        <div className="project__groups">
          {project.groups.map((g) => (
            <section key={g.id ?? "other"} className="project__group">
              <header>
                {g.type && <span className={KIND_CHIP[g.type]}>{KINDS.find((k) => k.id === g.type)?.label}</span>}
                <h2 className="t-h-m">{g.title}</h2>
                {g.due && <span className={`${toneClass(g.due.tone)} project__due`}>{g.due.label}</span>}
              </header>
              <ul className="task-list">
                <AnimatePresence initial={false}>
                  {g.tasks.map((t) => (
                    <TaskRow key={t.id} task={t} onToggle={(done) => apply(window.mentem.taskSetDone(t.id, done).then(() => window.mentem.projectGet(id)))} onOpen={() => onOpenTask(t.id)} />
                  ))}
                </AnimatePresence>
              </ul>
            </section>
          ))}
        </div>
        <aside className="project__side">
          <h2 className="t-h-m">Context</h2>
          <div className="project__context">
            {editing ? (
              <>
                <textarea className="input drawer__notes" autoFocus rows={5} maxLength={2000} value={context} onChange={(e) => setContext(e.target.value)} />
                <button className="drawer__add" onClick={() => { setEditing(false); apply(window.mentem.projectContextSet(id, context)); }}>
                  Save
                </button>
              </>
            ) : (
              <>
                <p className="t-body-m">{project.context || "Nothing here yet."}</p>
                <button className="drawer__add" onClick={() => setEditing(true)}>
                  Edit
                </button>
              </>
            )}
          </div>
          <Meter done={project.done} total={project.total} />
        </aside>
      </div>
      <AnimatePresence>
        {dialog === "deliverable" && <AddDeliverable onClose={() => setDialog(null)} onAdd={(type, title) => { setDialog(null); apply(window.mentem.deliverableAdd(id, type, title)); }} />}
        {dialog === "task" && <AddTask project={project} onClose={() => setDialog(null)} onAdd={(deliverableId, title) => { setDialog(null); apply(window.mentem.projectTaskAdd(id, deliverableId, title)); }} />}
      </AnimatePresence>
    </>
  );
}

function AddDeliverable({ onClose, onAdd }: { onClose(): void; onAdd(type: Kind, title: string): void }) {
  const [type, setType] = useState<Kind>("deliverable");
  const [title, setTitle] = useState("");
  return (
    <Modal title="Add deliverable" onClose={onClose}>
      <div className="pills">
        {KINDS.map((k) => (
          <Pill key={k.id} selected={type === k.id} onClick={() => setType(k.id)}>
            {k.label}
          </Pill>
        ))}
      </div>
      <input className="input" autoFocus aria-label="Title" placeholder="Title" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} />
      <div className="dialog__actions">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={!title.trim()} onClick={() => onAdd(type, title.trim())}>
          Add
        </Button>
      </div>
    </Modal>
  );
}

function AddTask({ project, onClose, onAdd }: { project: ProjectDetail; onClose(): void; onAdd(deliverableId: string | null, title: string): void }) {
  const [title, setTitle] = useState("");
  const [deliverable, setDeliverable] = useState<string>(project.groups.find((g) => g.id)?.id ?? "");
  return (
    <Modal title="Add task" onClose={onClose}>
      <input className="input" autoFocus aria-label="Task" placeholder="Task" maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} />
      <span className="dropdown">
        <select aria-label="Deliverable" value={deliverable} onChange={(e) => setDeliverable(e.target.value)}>
          <option value="">No deliverable</option>
          {project.groups.filter((g) => g.id).map((g) => (
            <option key={g.id} value={g.id ?? ""}>
              {g.title}
            </option>
          ))}
        </select>
      </span>
      <div className="dialog__actions">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={!title.trim()} onClick={() => onAdd(deliverable || null, title.trim())}>
          Add
        </Button>
      </div>
    </Modal>
  );
}

export function Projects({ tick, onOpenTask, onChange }: { tick: number; onOpenTask(id: string): void; onChange(): void }) {
  const [projects, setProjects] = useState<ProjectCard[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  useEffect(() => void window.mentem.projectsGet().then(setProjects), [tick, open]);
  if (!projects) return null;
  if (open) return <Detail id={open} tick={tick} onBack={() => setOpen(null)} onOpenTask={onOpenTask} onChange={onChange} />;

  return (
    <>
      <header className="page-header">
        <h1 className="t-h-l">Projects</h1>
        <Button onClick={() => setCreating(true)}>New project</Button>
      </header>
      <div className="project-grid">
        {projects.map((p) => (
          <motion.button key={p.id} className="project-card" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease }} onClick={() => setOpen(p.id)}>
            <h2 className="t-h-m">{p.name}</h2>
            <p className="t-body-m muted">{p.description}</p>
            <Meter done={p.done} total={p.total} />
            <div className="project-card__foot">
              <span className="t-caption muted">
                {p.done} of {p.total} tasks
              </span>
              {p.chip && <span className={toneClass(p.chip.tone)}>{p.chip.label}</span>}
            </div>
          </motion.button>
        ))}
        <button className="project-card project-card--new" onClick={() => setCreating(true)}>
          <span className="project-card__plus" aria-hidden="true">
            +
          </span>
          <span className="t-body-m muted">New project</span>
        </button>
      </div>
      <AnimatePresence>{creating && <NewProjectDialog onClose={() => setCreating(false)} onCreate={(project) => { setCreating(false); void window.mentem.projectCreate(project).then((next) => { setProjects(next); onChange(); }); }} />}</AnimatePresence>
    </>
  );
}
