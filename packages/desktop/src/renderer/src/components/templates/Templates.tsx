import { useCallback, useEffect, useState } from "react";
import { AnimatePresence } from "motion/react";
import type { TemplateDetail, TemplatesData } from "@shared/api";
import { describeRule } from "@mentem/core/repeat";
import { RepeatEditor } from "../RepeatEditor";
import { freeGap, hasDuplicateName, isStandardBlock, nextBlockName } from "../../lib/blocks";
import { MAX_BLOCKS } from "@shared/pages";
import { formatSpan, formatTime } from "../../lib/time";
import { Button, Pill, RangeField, TimeField } from "../ui";
import type { ToastMessage } from "../Toast";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function Bars({ t }: { t: TemplateDetail }) {
  const span = Math.max(1, t.bedMin - t.wakeMin);
  const pos = (m: number) => `${((m - t.wakeMin) / span) * 100}%`;
  return (
    <div className="glance__track" role="img" aria-label="The day at a glance">
      {t.blocks
        .filter((b) => b.enabled)
        .map((b) => (
          <span key={b.name} className="glance__block" style={{ left: pos(b.startHour * 60), width: `${(((b.endHour - b.startHour) * 60) / span) * 100}%` }}>
            {b.name}
          </span>
        ))}
      {t.routine.map((r, i) => (
        <span key={`${r.id ?? "new"}-${i}`} className="glance__dot" style={{ left: pos(r.startMin) }} />
      ))}
    </div>
  );
}

export function Templates({ onToast, onChange }: { onToast(message: ToastMessage): void; onChange(): void }) {
  const [data, setData] = useState<TemplatesData | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<TemplateDetail | null>(null);
  const [dateOpen, setDateOpen] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<TemplateDetail["routine"][number] | null>(null);

  const adopt = useCallback((next: TemplatesData, pick?: string | null) => {
    setData(next);
    const id = pick ?? next.templates[0]?.id ?? null;
    setSelected(id);
    setDraft(structuredClone(next.templates.find((t) => t.id === id) ?? next.templates[0] ?? null));
  }, []);
  useEffect(() => void window.mentem.templatesGet().then((d) => adopt(d)), [adopt]);

  if (!data) return null;
  const choose = (id: string) => {
    setSelected(id);
    setDraft(structuredClone(data.templates.find((t) => t.id === id) ?? null));
    setError("");
  };
  const edit = (change: Partial<TemplateDetail>) => setDraft((d) => (d ? { ...d, ...change } : d));
  const saved = data.templates.find((t) => t.id === selected);
  const dirty = JSON.stringify(saved) !== JSON.stringify(draft);
  const gap = draft ? freeGap(draft.blocks, draft.wakeMin, draft.bedMin) : null;
  const dupes = draft ? hasDuplicateName(draft.blocks) : false;

  const save = () => {
    if (!draft) return;
    setError("");
    window.mentem.templateSave(draft).then((next) => { adopt(next, draft.id); onChange(); }, () => setError("Check the times and blocks"));
  };

  return (
    <>
      <header className="page-header">
        <h1 className="t-h-l">Templates</h1>
        <Button onClick={() => void window.mentem.templateNew().then((next) => { const before = new Set(data.templates.map((t) => t.id)); adopt(next, next.templates.find((t) => !before.has(t.id))?.id); onChange(); })}>New template</Button>
      </header>
      <div className="tpl">
        <div className="tpl__list">
          {data.templates.map((t) => (
            <button key={t.id} className={`choice ${t.id === selected ? "choice--selected" : ""}`} onClick={() => choose(t.id)} aria-pressed={t.id === selected}>
              <span className="choice__top">
                <span className="t-h-m">{t.name}</span>
                <span className="choice__check" aria-hidden="true">
                  {t.id === selected && (
                    <svg width="12" height="12" viewBox="0 0 12 12">
                      <path d="M2.5 6.2 5 8.6 9.5 3.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
              </span>
              <span className="t-body-m choice__body">{t.summary}</span>
            </button>
          ))}
        </div>

        {draft && (
          <div className="tpl__editor">
            <div className="tpl__bar">
              <input className="input tpl__name" aria-label="Template name" maxLength={40} value={draft.name} onChange={(e) => edit({ name: e.target.value })} />
              {error && <span className="t-caption danger-text">{error}</span>}
              <Button variant="ghost" onClick={() => void window.mentem.templateDelete(draft.id).then((next) => { adopt(next); onChange(); onToast({ text: "Template deleted" }); })}>
                Delete
              </Button>
              <Button disabled={!dirty || dupes} onClick={save}>
                Save
              </Button>
            </div>

            <div className="tpl__times">
              <span className="t-body-m-strong">Wake up</span>
              <TimeField label="Wake time" from={0} to={23 * 60 + 45} value={draft.wakeMin} onChange={(v) => v !== null && edit({ wakeMin: v })} />
              <span className="t-body-m-strong">Bed</span>
              <TimeField label="Bed time" from={15} to={24 * 60} value={draft.bedMin} onChange={(v) => v !== null && edit({ bedMin: v })} />
            </div>

            <Bars t={draft} />

            <div className="tpl__columns">
              <div className="tpl__col">
                <h2 className="t-h-m">Work blocks</h2>
                {draft.blocks.map((b, index) => {
                  const update = (change: Partial<typeof b>) => edit({ blocks: draft.blocks.map((x, i) => (i === index ? { ...x, ...change } : x)) });
                  return (
                    <div key={index} className={`block-row block-row--compact ${b.enabled ? "" : "block-row--off"}`}>
                      <button className={`toggle ${b.enabled ? "toggle--on" : ""}`} role="switch" aria-checked={b.enabled} aria-label={`${b.name} block`} onClick={() => update({ enabled: !b.enabled })}>
                        <span className="toggle__knob" />
                      </button>
                      <input className="block-row__name" aria-label="Block name" maxLength={30} value={b.name} disabled={!b.enabled} onChange={(e) => update({ name: e.target.value })} />
                      <TimeField disabled={!b.enabled} label={`${b.name} start`} from={draft.wakeMin} to={draft.bedMin - 15} value={b.startHour * 60} onChange={(v) => v !== null && update({ startHour: v / 60 })} />
                      <span className="muted">–</span>
                      <TimeField disabled={!b.enabled} label={`${b.name} end`} from={draft.wakeMin + 15} to={draft.bedMin} value={b.endHour * 60} onChange={(v) => v !== null && update({ endHour: v / 60 })} />
                      {!isStandardBlock(b.name) && (
                        <button className="icon-button" aria-label={`Remove ${b.name}`} onClick={() => edit({ blocks: draft.blocks.filter((_, i) => i !== index) })}>
                          ×
                        </button>
                      )}
                    </div>
                  );
                })}
                <button className="drawer__add" disabled={!gap || draft.blocks.length >= MAX_BLOCKS} onClick={() => gap && edit({ blocks: [...draft.blocks, { name: nextBlockName(draft.blocks), enabled: true, ...gap }] })}>
                  <span aria-hidden="true">+</span> Add a block
                </button>
                {dupes && <span className="t-caption danger-text">Blocks need different names.</span>}
              </div>

              <div className="tpl__col">
                <div className="tpl__routine-head">
                  <h2 className="t-h-m">Routine</h2>
                  <button className="icon-button accent-text" aria-label="Add a routine item" onClick={() => edit({ routine: [...draft.routine, { title: "New item", startMin: Math.min(draft.wakeMin + 60, 24 * 60 - 30), endMin: null, repeat: null }] })}>
                    +
                  </button>
                </div>
                <div className="group">
                  {[...draft.routine].sort((a, b) => a.startMin - b.startMin).map((item, index) => (
                    <div key={`${item.id ?? "new"}-${index}`} className="tpl-item">
                      <div className="tpl-item__top">
                        <input className="tpl-item__name" aria-label="Routine item" maxLength={80} value={item.title} onChange={(e) => edit({ routine: draft.routine.map((r) => (r === item ? { ...r, title: e.target.value } : r)) })} />
                        <button className="icon-button" aria-label={`Remove ${item.title}`} onClick={() => edit({ routine: draft.routine.filter((r) => r !== item) })}>
                          ×
                        </button>
                      </div>
                      <div className="tpl-item__meta">
                        <RangeField label={item.title} start={item.startMin} end={item.endMin} onChange={(s, e) => edit({ routine: draft.routine.map((r) => (r === item ? { ...r, startMin: s, endMin: e } : r)) })} />
                        <button className={`chip chip-button ${item.repeat ? "chip--accent-outline" : ""}`} aria-label={`Repeat for ${item.title}`} onClick={() => setEditing(item)}>
                          {item.repeat ? item.repeat.label : "Every time"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="tpl__runs">
              <span className="t-body-m-strong">Runs on</span>
              <div className="pills">
                {DAYS.map((d, day) => (
                  <Pill key={d} selected={draft.weekdays.includes(day)} onClick={() => edit({ weekdays: draft.weekdays.includes(day) ? draft.weekdays.filter((x) => x !== day) : [...draft.weekdays, day].sort() })}>
                    {d}
                  </Pill>
                ))}
              </div>
              <span className="tpl__date">
                <Button variant="secondary" onClick={() => setDateOpen(!dateOpen)}>
                  Use on a date
                </Button>
                {dateOpen && (
                  <input
                    className="input tpl__date-input"
                    type="date"
                    aria-label="Date"
                    autoFocus
                    onChange={(e) => {
                      if (!e.target.value) return;
                      void window.mentem.dayTemplateSet(e.target.value, draft.id).then((s) => {
                        setDateOpen(false);
                        onChange();
                        onToast({ text: `${draft.name} set for ${e.target.value}${s.moved ? ` · ${s.moved} moved` : ""}`, action: { label: "Undo", run: () => void window.mentem.dayTemplateUndo().then(onChange) } });
                      });
                    }}
                  />
                )}
              </span>
            </div>
            <AnimatePresence>
              {editing && (
                <RepeatEditor
                  rule={editing.repeat?.rule ?? null}
                  anchor={data.today}
                  kind="routine"
                  title={editing.title}
                  onClose={() => setEditing(null)}
                  onSave={(rule) => {
                    const target = editing;
                    setEditing(null);
                    edit({ routine: draft.routine.map((r) => (r === target ? { ...r, repeat: rule ? { rule, label: describeRule(rule) } : null } : r)) });
                  }}
                />
              )}
            </AnimatePresence>
            <p className="t-caption muted">
              {formatTime(draft.wakeMin)} – {formatTime(draft.bedMin)} · {formatSpan(Math.max(0, draft.bedMin - draft.wakeMin))} awake
            </p>
          </div>
        )}
      </div>
    </>
  );
}
