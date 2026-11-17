import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { RepeatRule } from "@mentem/core";
import { describeRule } from "@mentem/core/repeat";
import type { MeetingDetail } from "@shared/api";
import { RepeatEditor } from "../RepeatEditor";
import { Button, Pill, TimeField } from "../ui";

const ease = [0.16, 1, 0.3, 1] as const;

/** Which meeting the drawer is on: an existing one, or a new one on a day. */
export interface MeetingTarget {
  id: string | null;
  /** The day it was opened from. A repeating meeting can be removed for just this day. */
  date: string;
}

interface MeetingDrawerProps {
  target: MeetingTarget | null;
  onClose(): void;
  onChange(): void;
}

interface Form {
  title: string;
  date: string;
  startMin: number;
  endMin: number;
  kind: "online" | "in-person";
  link: string;
  place: string;
  minutes: string;
  notes: string;
  attendees: string[];
  repeat: { rule: RepeatRule; label: string } | null;
}

/** The next quarter hour from now, so a new meeting starts at something sensible. */
function nextQuarter(): number {
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  return Math.min(23 * 60, Math.ceil((minutes + 1) / 15) * 15);
}

function blank(date: string): Form {
  const startMin = nextQuarter();
  return { title: "", date, startMin, endMin: Math.min(24 * 60, startMin + 30), kind: "online", link: "", place: "", minutes: "", notes: "", attendees: [], repeat: null };
}

export function MeetingDrawer({ target, onClose, onChange }: MeetingDrawerProps) {
  const [form, setForm] = useState<Form | null>(null);
  const [person, setPerson] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [repeating, setRepeating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  // Minutes are written while the meeting runs, so they save by themselves a moment after typing stops.
  const minutesRef = useRef("");
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (dirty.current && target?.id) {
      dirty.current = false;
      await window.mentem.meetingMinutesSet(target.id, target.date, minutesRef.current);
    }
  };
  const close = () => void flush().then(onClose);
  const typeMinutes = (text: string) => {
    minutesRef.current = text;
    dirty.current = true;
    set({ minutes: text });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 700);
  };

  useEffect(() => {
    if (!target) return;
    let live = true;
    setError(null);
    setPerson("");
    setConfirming(false);
    setRepeating(false);
    if (target.id === null) {
      setForm(blank(target.date));
      return;
    }
    void window.mentem.meetingGet(target.id, target.date).then((m: MeetingDetail) => {
      if (!live) return;
      minutesRef.current = m.minutes;
      dirty.current = false;
      setForm({ title: m.title, date: m.date, startMin: m.startMin, endMin: m.endMin, kind: m.kind, link: m.link ?? "", place: m.place ?? "", minutes: m.minutes, notes: m.notes, attendees: m.attendees, repeat: m.repeat });
    });
    return () => {
      live = false;
    };
  }, [target]);

  useEffect(() => {
    if (!target) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && !repeating && !confirming && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, onClose, repeating, confirming]);

  const set = (change: Partial<Form>) => setForm((f) => (f ? { ...f, ...change } : f));
  const addPerson = () => {
    const name = person.trim().replace(/,$/, "").trim();
    if (name && form && !form.attendees.includes(name)) set({ attendees: [...form.attendees, name] });
    setPerson("");
  };
  const changeStart = (startMin: number) => set({ startMin, endMin: form && form.endMin <= startMin ? Math.min(24 * 60, startMin + 30) : form?.endMin });

  const save = () => {
    if (!form || !target || saving) return;
    setSaving(true);
    setError(null);
    void flush()
      .then(() => window.mentem
      .meetingSave({
        id: target.id ?? undefined,
        title: form.title,
        date: form.date,
        startMin: form.startMin,
        endMin: form.endMin,
        kind: form.kind,
        link: form.kind === "online" ? form.link.trim() || null : null,
        place: form.kind === "in-person" ? form.place.trim() || null : null,
        notes: form.notes,
        attendees: form.attendees,
        repeat: form.repeat?.rule ?? null,
      }))
      .then(() => {
        onChange();
        onClose();
      })
      .catch((e: unknown) => {
        setSaving(false);
        // The main process says what is wrong in a short sentence; show only that.
        setError(String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']*': (Error: )?/, ""));
      });
  };

  const remove = (onlyDate: string | null) =>
    void window.mentem.meetingDelete(target!.id!, onlyDate).then(() => {
      onChange();
      onClose();
    });

  const repeatingMeeting = form?.repeat !== null && form?.repeat !== undefined;

  return (
    <AnimatePresence>
      {target && form && (
        <>
          <motion.div key="scrim" className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onClick={close} />
          <motion.aside key="drawer" className="drawer" role="dialog" aria-label="Meeting" initial={{ x: 320, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 320, opacity: 0 }} transition={{ duration: 0.32, ease }}>
            <header className="drawer__top">
              <span className="t-label muted">Meeting</span>
              <div className="drawer__icons">
                {target.id && (
                  <button className="icon-button" aria-label="Delete meeting" onClick={() => setConfirming(true)}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
                    </svg>
                  </button>
                )}
                <button className="icon-button" aria-label="Close" onClick={close}>
                  ×
                </button>
              </div>
            </header>

            <div className="drawer__body">
              <textarea className="drawer__title t-h-xl" aria-label="Title" placeholder="Meeting title" rows={2} maxLength={120} autoFocus={target.id === null} value={form.title} onChange={(e) => set({ title: e.target.value.replace(/\n/g, " ") })} />

              <div className="drawer__grid">
                <label className="field">
                  <span className="t-caption muted">{repeatingMeeting ? "Starts" : "Date"}</span>
                  <input className="input" type="date" value={form.date} onChange={(e) => e.target.value && set({ date: e.target.value })} />
                </label>
                <div className="field">
                  <span className="t-caption muted">Time</span>
                  <div className="meeting-times">
                    <TimeField label="Start" value={form.startMin} from={0} to={24 * 60 - 15} onChange={(v) => v !== null && changeStart(v)} />
                    <span aria-hidden="true">–</span>
                    <TimeField label="End" value={form.endMin} from={form.startMin + 15} to={24 * 60} onChange={(v) => v !== null && set({ endMin: v })} />
                  </div>
                </div>
              </div>

              {target.id && (
                <label className="drawer__section">
                  <span className="t-caption muted">Minutes{form.repeat ? ` · ${target.date}` : ""}</span>
                  <textarea className="input drawer__minutes" aria-label="Minutes" placeholder="Write the minutes here" rows={9} maxLength={20000} value={form.minutes} onChange={(e) => typeMinutes(e.target.value)} onBlur={() => void flush()} />
                </label>
              )}

              <section className="drawer__section">
                <span className="t-caption muted">Repeat</span>
                <div className="pills">
                  <Button variant="secondary" onClick={() => setRepeating(true)}>
                    {form.repeat ? form.repeat.label : "Doesn’t repeat"}
                  </Button>
                  {form.repeat && (
                    <Button variant="ghost" onClick={() => set({ repeat: null })}>
                      Remove
                    </Button>
                  )}
                </div>
              </section>

              <section className="drawer__section">
                <span className="t-caption muted">Where</span>
                <div className="pills">
                  <Pill selected={form.kind === "online"} onClick={() => set({ kind: "online" })}>
                    Online
                  </Pill>
                  <Pill selected={form.kind === "in-person"} onClick={() => set({ kind: "in-person" })}>
                    In person
                  </Pill>
                </div>
                {form.kind === "online" ? (
                  <input className="input" type="url" inputMode="url" aria-label="Link" placeholder="Link, https://" maxLength={500} value={form.link} onChange={(e) => set({ link: e.target.value })} />
                ) : (
                  <input className="input" aria-label="Place" placeholder="Place" maxLength={200} value={form.place} onChange={(e) => set({ place: e.target.value })} />
                )}
              </section>

              <section className="drawer__section">
                <span className="t-caption muted">People</span>
                {form.attendees.length > 0 && (
                  <ul className="people">
                    {form.attendees.map((name) => (
                      <li key={name} className="person">
                        <span>{name}</span>
                        <button aria-label={`Remove ${name}`} onClick={() => set({ attendees: form.attendees.filter((a) => a !== name) })}>
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <input
                  className="input"
                  aria-label="Add a person"
                  placeholder="Add a person"
                  maxLength={80}
                  value={person}
                  onChange={(e) => (e.target.value.endsWith(",") ? (setPerson(e.target.value), addPerson()) : setPerson(e.target.value))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addPerson();
                    }
                  }}
                  onBlur={addPerson}
                />
              </section>

              <label className="drawer__section">
                <span className="t-caption muted">Agenda</span>
                <textarea className="input drawer__notes" placeholder="Add an agenda" rows={3} maxLength={5000} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
              </label>


              {error && <p className="t-caption danger-text">{error}</p>}
              <div className="drawer__actions">
                {form.kind === "online" && form.link.trim() && /^https:\/\//i.test(form.link.trim()) && (
                  <Button variant="secondary" onClick={() => window.open(form.link.trim(), "_blank", "noopener")}>
                    Open link
                  </Button>
                )}
                <Button onClick={save} disabled={saving || !form.title.trim()}>
                  Save
                </Button>
              </div>
            </div>

            <AnimatePresence>
              {repeating && (
                <RepeatEditor
                  rule={form.repeat?.rule ?? null}
                  anchor={form.date}
                  kind="task"
                  title="Repeat"
                  onClose={() => setRepeating(false)}
                  onSave={(rule) => {
                    setRepeating(false);
                    if (rule) set({ repeat: { rule, label: describeRule(rule) } });
                  }}
                />
              )}
            </AnimatePresence>
            <AnimatePresence>
              {confirming && target.id && (
                <motion.div className="dialog-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
                  <motion.div className="dialog" role="alertdialog" initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.22, ease }}>
                    <h3 className="t-h-l">Delete this meeting?</h3>
                    {repeatingMeeting && <p className="t-body-m muted">It repeats.</p>}
                    <div className="dialog__actions">
                      <Button variant="ghost" onClick={() => setConfirming(false)}>
                        Cancel
                      </Button>
                      {repeatingMeeting && form.date !== target.date && (
                        <Button variant="secondary" onClick={() => remove(target.date)}>
                          Only this day
                        </Button>
                      )}
                      <Button onClick={() => remove(null)}>{repeatingMeeting ? "All days" : "Delete"}</Button>
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
