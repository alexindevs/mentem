import { formatHour, formatSpan } from "../../lib/time";
import { overlapsOf, type Draft } from "./draft";

/** The waking hours as a bar, with "16 hours awake" under it. */
export function DayBar({ draft }: { draft: Draft }) {
  const left = (draft.wakeMin / 1440) * 100;
  const width = (Math.max(0, draft.bedMin - draft.wakeMin) / 1440) * 100;
  return (
    <div className="day-bar">
      <div className="day-bar__track" role="img" aria-label="Your waking hours">
        <span style={{ left: `${left}%`, width: `${width}%` }} />
      </div>
      <div className="day-bar__ticks t-caption">
        {[0, 6, 12, 18, 24].map((hour) => (
          <span key={hour}>{formatHour(hour)}</span>
        ))}
      </div>
      <strong className="t-body-m-strong">{formatSpan(Math.max(0, draft.bedMin - draft.wakeMin))} awake</strong>
    </div>
  );
}

/** The day from wake to bed: routine items as dots, work blocks as bars, overlaps lighter. */
export function Glance({ draft }: { draft: Draft }) {
  const span = Math.max(1, draft.bedMin - draft.wakeMin);
  const pos = (minutes: number) => `${((minutes - draft.wakeMin) / span) * 100}%`;
  const overlaps = overlapsOf(draft);
  return (
    <div className="glance">
      <span className="t-body-m-strong">Your day at a glance</span>
      <div className="glance__track" role="img" aria-label="Routine items and work blocks across your day">
        {draft.blocks
          .filter((b) => b.enabled)
          .map((block) => (
            <span key={block.name} className="glance__block" style={{ left: pos(block.startHour * 60), width: `${(((block.endHour - block.startHour) * 60) / span) * 100}%` }}>
              {block.name}
            </span>
          ))}
        {overlaps.map(({ item, from, to }) => (
          <span key={`${item.id}-${from}`} className="glance__overlap" style={{ left: pos(from), width: `${((to - from) / span) * 100}%` }} />
        ))}
        {[{ id: 0, startMin: draft.wakeMin }, ...draft.routine].map((item) => (
          <span key={item.id} className="glance__dot" style={{ left: pos(item.startMin) }} />
        ))}
      </div>
      <div className="glance__legend t-caption">
        <span><i className="glance__key glance__key--dot" />Routine items</span>
        <span><i className="glance__key glance__key--block" />Work blocks</span>
        {overlaps.length > 0 && <span><i className="glance__key glance__key--overlap" />Overlap</span>}
      </div>
    </div>
  );
}
