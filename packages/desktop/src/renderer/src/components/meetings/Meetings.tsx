import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import type { MeetingListItem } from "@shared/api";
import { formatTime } from "../../lib/time";
import { Button, Pill } from "../ui";

const ease = [0.16, 1, 0.3, 1] as const;
type View = "upcoming" | "past";

const local = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, day ?? 1);
};
const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const heading = (date: string) => {
  const now = new Date();
  const offset = Math.round((local(date).getTime() - local(key(now)).getTime()) / 86_400_000);
  if (offset === 0) return "Today";
  if (offset === 1) return "Tomorrow";
  if (offset === -1) return "Yesterday";
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(local(date));
};

function Where({ kind }: { kind: MeetingListItem["kind"] }) {
  return kind === "online" ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-label="Online">
      <path d="M4 6.5h11a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H4z" />
      <path d="m17 10.5 4-2.5v8l-4-2.5" />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-label="In person">
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.400-6.500 11-6.500 11Z" />
      <circle cx="12" cy="10" r="2.3" />
    </svg>
  );
}

interface MeetingsProps {
  tick: number;
  onOpenMeeting(target: { id: string | null; date: string }): void;
}

/** Every meeting in one place: what is coming, and what has been and needs its minutes. */
export function Meetings({ tick, onOpenMeeting }: MeetingsProps) {
  const [view, setView] = useState<View>("upcoming");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<MeetingListItem[] | null>(null);

  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => void window.mentem.meetingsList(view, query).then((list) => live && setItems(list)), query ? 150 : 0);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [view, query, tick]);

  const groups: Array<{ date: string; rows: MeetingListItem[] }> = [];
  for (const item of items ?? []) {
    const last = groups[groups.length - 1];
    if (last && last.date === item.date) last.rows.push(item);
    else groups.push({ date: item.date, rows: [item] });
  }
  const missing = view === "past" ? (items ?? []).filter((i) => i.needsMinutes).length : 0;

  return (
    <>
      <header className="page-header">
        <div className="page-header__title">
          <h1 className="t-h-l">Meetings</h1>
          <div className="pills" role="tablist">
            <Pill role="tab" aria-selected={view === "upcoming"} selected={view === "upcoming"} onClick={() => setView("upcoming")}>
              Upcoming
            </Pill>
            <Pill role="tab" aria-selected={view === "past"} selected={view === "past"} onClick={() => setView("past")}>
              Past
            </Pill>
          </div>
        </div>
        <div className="page-header__actions">
          <input className="input meetings__search" type="search" aria-label="Search meetings" placeholder="Search" maxLength={80} value={query} onChange={(e) => setQuery(e.target.value)} />
          <Button onClick={() => onOpenMeeting({ id: null, date: key(new Date()) })}>New meeting</Button>
        </div>
      </header>
      {missing > 0 && (
        <p className="t-body-m muted meetings__hint">
          {missing} {missing === 1 ? "meeting has" : "meetings have"} no minutes yet.
        </p>
      )}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={`${view}:${query}`} className="meetings" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease }}>
          {items !== null && groups.length === 0 && <p className="t-body-m muted">{query ? "No matches." : view === "upcoming" ? "No meetings coming up." : "No past meetings."}</p>}
          {groups.map((group) => (
            <section key={group.date} className="meetings__day">
              <h2 className="t-label muted">{heading(group.date)}</h2>
              <div className="meetings__list">
                {group.rows.map((m) => (
                  <button key={`${m.id}:${m.date}`} className="meeting-row" onClick={() => onOpenMeeting({ id: m.id, date: m.date })}>
                    <span className="meeting-row__time t-body-m">
                      {formatTime(m.startMin)}
                      <span className="muted"> – {formatTime(m.endMin)}</span>
                    </span>
                    <span className="meeting-row__main">
                      <span className="t-body-m-strong">{m.title}</span>
                      <span className="t-caption muted meeting-row__meta">
                        <Where kind={m.kind} />
                        <span>{m.kind === "online" ? "Online" : (m.place ?? "In person")}</span>
                        {m.people > 0 && <span>· {m.people} {m.people === 1 ? "person" : "people"}</span>}
                        {m.repeatLabel && <span>· {m.repeatLabel}</span>}
                      </span>
                    </span>
                    {m.hasMinutes && <span className="chip chip--accent-outline">Minutes</span>}
                    {m.needsMinutes && <span className="chip">No minutes</span>}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </motion.div>
      </AnimatePresence>
    </>
  );
}
