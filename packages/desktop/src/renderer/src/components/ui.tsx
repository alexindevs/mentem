import { motion } from "motion/react";
import type { ReactNode } from "react";
import { formatHour, formatTime, timeSteps } from "../lib/time";

export function Button({
  children,
  variant = "primary",
  ...rest
}: { variant?: "primary" | "secondary" | "ghost" } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`button button--${variant}`} {...rest}>
      {children}
    </button>
  );
}

/** A rounded pill that is either chosen or not. */
export function Pill({ children, selected, ...rest }: { selected?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`pill ${selected ? "pill--on" : ""}`} aria-pressed={selected} {...rest}>
      {children}
    </button>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span className="t-body-m-strong">{label}</span>
      {children}
      {hint && <span className="t-caption field__hint">{hint}</span>}
    </label>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className="input" {...props} />;
}

const CHECK = (
  <motion.svg width="12" height="12" viewBox="0 0 12 12" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}>
    <path d="M2.5 6.2 5 8.6 9.5 3.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </motion.svg>
);

export function Choice({ title, body, selected, onClick }: { title: string; body: string; selected: boolean; onClick(): void }) {
  return (
    <button className={`choice ${selected ? "choice--selected" : ""}`} onClick={onClick} aria-pressed={selected}>
      <span className="choice__top">
        <span className="t-h-m">{title}</span>
        <span className="choice__check" aria-hidden="true">
          {selected && CHECK}
        </span>
      </span>
      <span className="t-body-m choice__body">{body}</span>
    </button>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange(next: boolean): void; label: string; disabled?: boolean }) {
  return (
    <button className={`toggle ${checked ? "toggle--on" : ""}`} role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}>
      <span className="toggle__knob" />
    </button>
  );
}

/** A titled row inside a bordered group, with a switch at the right. */
export function SwitchRow({ title, body, checked, onChange }: { title: string; body: string; checked: boolean; onChange(next: boolean): void }) {
  return (
    <div className="group__row">
      <div className="group__text">
        <span className="t-body-l group__title">{title}</span>
        <span className="t-caption group__body">{body}</span>
      </div>
      <Toggle label={title} checked={checked} onChange={onChange} />
    </div>
  );
}

interface TimeFieldProps {
  value: number | null;
  onChange(value: number | null): void;
  label: string;
  from?: number;
  to?: number;
  step?: number;
  /** Adds an empty choice with this label, for optional times. */
  noneLabel?: string;
  /** Shows hours only, such as "9 AM", for block hours. */
  hours?: boolean;
  disabled?: boolean;
}

/**
 * Looks like a plain time box. Clicking it opens the list of every time between
 * `from` and `to`; the list itself is the transparent select laid over the box.
 */
export function TimeField({ value, onChange, label, from = 0, to = 24 * 60, step = 15, noneLabel, hours, disabled }: TimeFieldProps) {
  const options = hours ? timeSteps(Math.ceil(from / 60), Math.floor(to / 60), 1).map((h) => h * 60) : timeSteps(from, to, step);
  if (value !== null && !options.includes(value)) options.push(value);
  options.sort((a, b) => a - b);
  const text = value === null ? (noneLabel ?? "") : hours ? formatHour(value / 60) : formatTime(value);
  return (
    <span className={`time-field ${disabled ? "time-field--off" : ""}`}>
      <span className="time-field__text">{text}</span>
      <select aria-label={label} disabled={disabled} value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}>
        {noneLabel && <option value="">{noneLabel}</option>}
        {options.map((minutes) => (
          <option key={minutes} value={minutes}>
            {hours ? formatHour(minutes / 60) : formatTime(minutes)}
          </option>
        ))}
      </select>
    </span>
  );
}

interface RangeFieldProps {
  start: number;
  end: number | null;
  onChange(start: number, end: number | null): void;
  label: string;
}

/** "7:15 – 7:25 AM" as one small box; each half opens its own list. */
export function RangeField({ start, end, onChange, label }: RangeFieldProps) {
  const startText = formatTime(start);
  const endText = end === null ? null : formatTime(end);
  const sameHalf = endText !== null && startText.slice(-2) === endText.slice(-2);
  const shown = endText === null ? startText : `${sameHalf ? startText.slice(0, -3) : startText} – ${endText}`;
  const list = (from: number, to: number) => timeSteps(from, to, 5);
  return (
    <span className="range-field">
      <span className="range-field__text">{shown}</span>
      <select aria-label={`${label} start`} className="range-field__half" value={start} onChange={(e) => onChange(Number(e.target.value), end !== null && end <= Number(e.target.value) ? null : end)}>
        {list(0, 24 * 60 - 5).map((m) => (
          <option key={m} value={m}>
            {formatTime(m)}
          </option>
        ))}
      </select>
      <select aria-label={`${label} end`} className="range-field__half" value={end ?? ""} onChange={(e) => onChange(start, e.target.value === "" ? null : Number(e.target.value))}>
        <option value="">No end</option>
        {list(start + 5, 24 * 60).map((m) => (
          <option key={m} value={m}>
            {formatTime(m)}
          </option>
        ))}
      </select>
    </span>
  );
}

interface StepperProps {
  title: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  onChange(value: number): void;
}

/** A row in a bordered group with a − value + control at the right. */
export function StepperRow({ title, unit, value, min, max, onChange }: StepperProps) {
  return (
    <div className="group__row">
      <div className="group__text">
        <span className="t-body-l group__title">{title}</span>
        <span className="t-caption group__body">{unit}</span>
      </div>
      <div className="stepper">
        <button aria-label={`Decrease ${title}`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>
          −
        </button>
        <span className="stepper__value">{value}</span>
        <button aria-label={`Increase ${title}`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}>
          +
        </button>
      </div>
    </div>
  );
}
