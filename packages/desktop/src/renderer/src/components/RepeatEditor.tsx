import { motion } from "motion/react";
import { useEffect, useState } from "react";
import type { RepeatRule } from "@mentem/core";
import { Button, Pill } from "./ui";

const ease = [0.16, 1, 0.3, 1] as const;
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const UNITS: Array<{ id: RepeatRule["unit"]; label: string }> = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "year", label: "Year" },
];

const parts = (date: string) => {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return { month: m, day: d, weekday: (new Date(y, m - 1, d).getDay() + 6) % 7 };
};

function Number_({ value, min, max, label, onChange }: { value: number; min: number; max: number; label: string; onChange(v: number): void }) {
  return (
    <div className="stepper">
      <button aria-label={`Decrease ${label}`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>
        −
      </button>
      <span className="stepper__value">{value}</span>
      <button aria-label={`Increase ${label}`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}>
        +
      </button>
    </div>
  );
}

interface RepeatEditorProps {
  /** The rule being edited, or null when it does not repeat yet. */
  rule: RepeatRule | null;
  /** The date counting starts from: the task's day, or today for a routine item. */
  anchor: string;
  /** "Routine item" adds the Every time / Only some times choice. */
  kind: "task" | "routine";
  title: string;
  onSave(rule: RepeatRule | null): void;
  onClose(): void;
}

/** The Repeat popover: every or every other (or every 3rd, 4th…), by day, week, month or year. */
export function RepeatEditor({ rule, anchor, kind, title, onSave, onClose }: RepeatEditorProps) {
  const a = parts(anchor);
  const [some, setSome] = useState(kind === "task" ? true : rule !== null);
  const [interval, setInterval] = useState(rule?.interval ?? 1);
  const [custom, setCustom] = useState((rule?.interval ?? 1) > 2);
  const [unit, setUnit] = useState<RepeatRule["unit"]>(rule?.unit ?? "week");
  const [weekdays, setWeekdays] = useState<number[]>(rule?.weekdays?.length ? rule.weekdays : [a.weekday]);
  const [monthDay, setMonthDay] = useState(rule?.monthDay ?? a.day);
  const [yearMonth, setYearMonth] = useState(rule?.yearMonth ?? a.month);
  const [yearDay, setYearDay] = useState(rule?.yearDay ?? a.day);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const build = (): RepeatRule => ({
    interval,
    unit,
    anchor,
    ...(unit === "week" ? { weekdays } : unit === "month" ? { monthDay } : unit === "year" ? { yearMonth, yearDay } : {}),
  });
  const valid = !some || unit !== "week" || weekdays.length > 0;

  return (
    <motion.div className="dialog-scrim dialog-scrim--page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} onMouseDown={onClose}>
      <motion.div className="repeat" role="dialog" aria-label="Repeat" initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.22, ease }} onMouseDown={(e) => e.stopPropagation()}>
        <h3 className="t-h-l">{kind === "routine" ? title : "Repeat"}</h3>
        {kind === "routine" && (
          <div className="pills">
            <Pill selected={!some} onClick={() => setSome(false)}>
              Every time
            </Pill>
            <Pill selected={some} onClick={() => setSome(true)}>
              Only some times
            </Pill>
          </div>
        )}
        {some && (
          <>
            <div className="pills">
              <Pill selected={interval === 1 && !custom} onClick={() => { setInterval(1); setCustom(false); }}>
                Every
              </Pill>
              <Pill selected={interval === 2 && !custom} onClick={() => { setInterval(2); setCustom(false); }}>
                Every other
              </Pill>
              <Pill selected={custom} onClick={() => { setCustom(true); setInterval(Math.max(3, interval)); }}>
                Every…
              </Pill>
            </div>
            {custom && (
              <div className="repeat__line">
                <span className="t-caption muted">Every</span>
                <Number_ value={interval} min={3} max={99} label="how often" onChange={setInterval} />
                <span className="t-caption muted">{unit === "day" ? "days" : `${unit}s`}</span>
              </div>
            )}
            <div className="pills">
              {UNITS.map((u) => (
                <Pill key={u.id} selected={unit === u.id} onClick={() => setUnit(u.id)}>
                  {u.label}
                </Pill>
              ))}
            </div>
            {unit === "week" && (
              <div className="repeat__on">
                <span className="t-caption muted">On</span>
                <div className="pills">
                  {DAYS.map((d, i) => (
                    <Pill key={d} selected={weekdays.includes(i)} onClick={() => setWeekdays(weekdays.includes(i) ? weekdays.filter((x) => x !== i) : [...weekdays, i].sort())}>
                      {d}
                    </Pill>
                  ))}
                </div>
              </div>
            )}
            {unit === "month" && (
              <div className="repeat__on">
                <span className="t-caption muted">On day</span>
                <Number_ value={monthDay} min={1} max={31} label="day of the month" onChange={setMonthDay} />
              </div>
            )}
            {unit === "year" && (
              <div className="repeat__on">
                <span className="t-caption muted">On</span>
                <div className="repeat__line">
                  <span className="dropdown">
                    <select aria-label="Month" value={yearMonth} onChange={(e) => setYearMonth(Number(e.target.value))}>
                      {MONTHS.map((m, i) => (
                        <option key={m} value={i + 1}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </span>
                  <Number_ value={yearDay} min={1} max={31} label="day" onChange={setYearDay} />
                </div>
              </div>
            )}
            {unit === "day" && <span className="t-caption muted">Counting from {anchor}.</span>}
          </>
        )}
        <div className="repeat__done">
          <Button disabled={!valid} onClick={() => onSave(some ? build() : null)}>
            Done
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}
