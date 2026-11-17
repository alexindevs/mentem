import { AnimatePresence } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import type { TimerAction, TimerTarget, TodayData } from "@shared/api";
import { isTicking, useNow, useTimer } from "../../lib/useTimer";
import { Pill } from "../ui";
import { DayList } from "./DayList";
import { NowCard } from "./NowCard";
import { TaskRow } from "./TaskRow";
import { Unscheduled } from "./Unscheduled";

function greeting(name: string, at: Date): string {
  const hour = at.getHours();
  const part = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : hour < 21 ? "Good evening" : "Good night";
  return name ? `${part}, ${name}` : part;
}

const dateLabel = (date: Date) => new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(date);

export function Today({ tick, hideDone, onOpenTask, onChange }: { tick: number; hideDone: boolean; onOpenTask(id: string): void; onChange(): void }) {
  const [data, setData] = useState<TodayData | null>(null);
  const snapshot = useTimer();
  const view = snapshot?.view ?? null;
  const now = useNow(isTicking(view), snapshot?.offset ?? 0);

  const load = useCallback(() => void window.mentem.todayGet().then(setData), []);
  // The timer changes whenever the day does, so it is also the cue to re-read the lists.
  useEffect(load, [load, view, tick]);

  if (!data || !snapshot || !view) return null;

  const run = (next: Promise<TodayData>) => void next.then((d) => { setData(d); onChange(); });
  const toggle = (id: string, done: boolean) => run(window.mentem.taskSetDone(id, done));
  const act = (action: TimerAction, target?: TimerTarget) => void window.mentem.timerAct(action, target);
  const currentBlock = data.blocks.find((block) => block.name === view.blockName);

  return (
    <>
        <header className="today__header">
          <h1 className="t-h-l">{greeting(data.userName, new Date(now))}</h1>
          <div className="today__header-side">
            <button className="today__mini" onClick={() => void window.mentem.miniToggle()} aria-label="Show or hide the mini window" title="Mini window">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="5" width="18" height="14" rx="3" />
                <rect x="12" y="11" width="7" height="5" rx="1.5" />
              </svg>
              <span>Mini window</span>
            </button>
            <span className="t-caption today__date">{dateLabel(new Date(now))}</span>
          </div>
        </header>
        <NowCard
          view={view}
          at={snapshot.at}
          now={now}
          data={data}
          onAct={act}
          onExtend={(minutes) => void window.mentem.routineExtend(minutes)}
          onStartNow={() => void window.mentem.blockStartNow()}
          onIdle={() => void window.mentem.blockIdle()}
          onDayOff={(off) => run(window.mentem.dayOffSet(off))}
          onCreateTemplate={() => run(window.mentem.templateCreate())}
          onPull={() => {
            const first = data.unscheduled[0];
            if (first && currentBlock) run(window.mentem.taskAssign(first.id, currentBlock.slot));
          }}
        />
        <div className="today__columns">
          {data.hasTemplate ? (
            <DayList hideDone={hideDone} data={data} timer={view} onToggle={toggle} onOpen={onOpenTask} onDrop={(id, slot) => run(window.mentem.taskAssign(id, slot))} />
          ) : (
            <div className="day-list">
              <h2 className="t-h-m">Pick a template</h2>
              <div className="pills">
                {data.templates.map((template) => (
                  <Pill key={template.id} onClick={() => run(window.mentem.templateSetToday(template.id))}>
                    {template.name}
                  </Pill>
                ))}
                <Pill onClick={() => run(window.mentem.templateCreate())}>+ New</Pill>
              </div>
              {data.dueSoon.length > 0 && (
                <>
                  <h2 className="t-h-m">Due today</h2>
                  <ul className="task-list">
                    <AnimatePresence initial={false}>
                      {data.dueSoon.map((task) => (
                        <TaskRow key={task.id} task={task} onToggle={(done) => toggle(task.id, done)} />
                      ))}
                    </AnimatePresence>
                  </ul>
                </>
              )}
            </div>
          )}
          <Unscheduled tasks={data.unscheduled} onOpen={onOpenTask} onCreate={(title) => run(window.mentem.taskCreate(title))} onToggle={toggle} onDrop={(id) => run(window.mentem.taskAssign(id, null))} />
        </div>
    </>
  );
}
