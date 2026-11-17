import { addDays, dateOf, minutesOfDay } from "./dates";
import { occurrences } from "./repeat";
import type { Store } from "./store";

/**
 * Makes the copies of repeating tasks that fall in the next `horizonDays`. A copy is a task of
 * its own, so finishing or moving one never touches the others. Safe to run as often as you like:
 * a date that already has its copy is never filled twice, even if that copy was moved or finished.
 *
 * Nothing is made for days that have passed, for a day whose template has no block in the series'
 * slot (it is tried again later, in case the template changes), or for a block that has already ended today.
 */
export function materializeRepeats(store: Store, now: number = store.clock.now(), horizonDays = 14): { created: number } {
  const today = dateOf(now);
  const nowMin = minutesOfDay(now);
  const end = addDays(today, horizonDays);
  let created = 0;
  store.transaction(() => {
    for (const series of store.listActiveSeries()) {
      const origin = store.getTask(series.id);
      if (!origin) {
        store.endSeries(series.id);
        continue;
      }
      const have = store.seriesDates(series.id);
      const steps = store.listSteps(origin.id).map((s) => s.text);
      for (const date of occurrences(series.rule, today, end)) {
        if (have.has(date)) continue;
        const block = store.blocksFor(date).find((b) => b.slot === series.slot);
        if (!block) continue;
        if (date === today && block.endMin <= nowMin) continue;
        const copy = store.createTask({
          title: origin.title,
          notes: origin.notes,
          projectId: origin.projectId,
          deliverableId: origin.deliverableId,
          estimatePomodoros: origin.estimatePomodoros,
          steps,
        });
        store.setSeriesId(copy.id, series.id);
        store.assign(copy.id, { date, slot: series.slot });
        store.markOccurrence(series.id, date);
        created += 1;
      }
    }
  });
  return { created };
}
