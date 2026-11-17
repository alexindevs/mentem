import { contextBridge, ipcRenderer } from "electron";
import { CHANNEL, TIMER_CHANNEL } from "../shared/channel";
import type { Api, Bridge, TimerView } from "../shared/api";

const call =
  <K extends keyof Api>(method: K) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(CHANNEL, method, ...args) as ReturnType<Api[K]>;

const bridge: Bridge = {
  appInfo: call("appInfo"),
  settingsGet: call("settingsGet"),
  settingsUpdate: call("settingsUpdate"),
  onboardingComplete: call("onboardingComplete"),
  todayGet: call("todayGet"),
  timerGet: call("timerGet"),
  timerAct: call("timerAct"),
  routineExtend: call("routineExtend"),
  blockStartNow: call("blockStartNow"),
  blockIdle: call("blockIdle"),
  dayOffSet: call("dayOffSet"),
  templateCreate: call("templateCreate"),
  taskGet: call("taskGet"),
  taskUpdate: call("taskUpdate"),
  stepAdd: call("stepAdd"),
  stepToggle: call("stepToggle"),
  stepsReorder: call("stepsReorder"),
  stepUpdate: call("stepUpdate"),
  stepDelete: call("stepDelete"),
  subtaskAdd: call("subtaskAdd"),
  subtaskToggle: call("subtaskToggle"),
  taskPlace: call("taskPlace"),
  taskRepeatSet: call("taskRepeatSet"),
  taskDelete: call("taskDelete"),
  meetingGet: call("meetingGet"),
  meetingMinutesSet: call("meetingMinutesSet"),
  meetingsList: call("meetingsList"),
  meetingSave: call("meetingSave"),
  meetingDelete: call("meetingDelete"),
  weekGet: call("weekGet"),
  dayTemplateSet: call("dayTemplateSet"),
  dayTemplateUndo: call("dayTemplateUndo"),
  templatesGet: call("templatesGet"),
  templateNew: call("templateNew"),
  templateSave: call("templateSave"),
  templateDelete: call("templateDelete"),
  projectsGet: call("projectsGet"),
  projectGet: call("projectGet"),
  projectCreate: call("projectCreate"),
  projectContextSet: call("projectContextSet"),
  deliverableAdd: call("deliverableAdd"),
  projectTaskAdd: call("projectTaskAdd"),
  reportsGet: call("reportsGet"),
  reportGet: call("reportGet"),
  sessionsGet: call("sessionsGet"),
  promptsGet: call("promptsGet"),
  planningGet: call("planningGet"),
  dataSnapshots: call("dataSnapshots"),
  dataBackup: call("dataBackup"),
  dataRestore: call("dataRestore"),
  dataExport: call("dataExport"),
  dataImport: call("dataImport"),
  updateGet: call("updateGet"),
  updateCheck: call("updateCheck"),
  updateInstall: call("updateInstall"),
  cliInfo: call("cliInfo"),
  cliAddToPath: call("cliAddToPath"),
  miniToggle: call("miniToggle"),
  taskCreate: call("taskCreate"),
  taskSetDone: call("taskSetDone"),
  taskAssign: call("taskAssign"),
  taskFocus: call("taskFocus"),
  templateSetToday: call("templateSetToday"),
  onTimer(listener) {
    const handler = (_event: unknown, view: TimerView) => listener(view);
    ipcRenderer.on(TIMER_CHANNEL, handler);
    return () => ipcRenderer.removeListener(TIMER_CHANNEL, handler);
  },
};

contextBridge.exposeInMainWorld("mentem", bridge);
