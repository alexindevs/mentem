import { useEffect, useState } from "react";
import type { Settings as AppSettings, ThemeId } from "@mentem/core";
import type { CliInfo, SnapshotView } from "@shared/api";
import { Button, Pill, StepperRow, SwitchRow } from "../ui";
import { DAY_SHORT, PRESETS, THEME_NAMES } from "../onboarding/draft";

type Tab = "General" | "Appearance" | "Focus" | "Alerts" | "Data";
const TABS: Tab[] = ["General", "Appearance", "Focus", "Alerts", "Data"];
type Patch = Parameters<typeof window.mentem.settingsUpdate>[0];

interface SettingsProps {
  settings: AppSettings;
  onSettings(settings: AppSettings): void;
  onRunSetup(): void;
}

const CLI_NAME = /^[A-Za-z0-9-]{1,30}$/;

function General({ settings, save, onRunSetup }: { settings: AppSettings; save(patch: Patch): void; onRunSetup(): void }) {
  const [name, setName] = useState(settings.userName);
  const [app, setApp] = useState(settings.appName);
  const [cli, setCli] = useState(settings.cliName);
  const cliBad = !CLI_NAME.test(cli);
  const [info, setInfo] = useState<CliInfo | null>(null);
  useEffect(() => void window.mentem.cliInfo().then(setInfo), [settings.cliName]);
  return (
    <div className="settings__form">
      <label className="field">
        <span className="t-body-m-strong">Your name</span>
        <input className="input" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== settings.userName && save({ userName: name })} />
      </label>
      <label className="field">
        <span className="t-body-m-strong">App name</span>
        <input className="input" maxLength={40} value={app} onChange={(e) => setApp(e.target.value)} onBlur={() => app.trim() && app !== settings.appName && save({ appName: app })} />
      </label>
      <label className="field">
        <span className="t-body-m-strong">Command name</span>
        <input className="input" maxLength={30} value={cli} onChange={(e) => setCli(e.target.value)} onBlur={() => !cliBad && cli !== settings.cliName && save({ cliName: cli })} />
        {cliBad ? <span className="field__hint danger-text t-caption">Letters, numbers and hyphens only.</span> : cli !== settings.cliName && <span className="settings__note t-caption">Scripts using the old command will stop working.</span>}
      </label>
      {info && !info.onPath && (
        <div className="settings__note settings__note--row t-caption">
          <span>
            The <strong>{info.name}</strong> command lives in {info.dir}, which isn’t on your PATH yet.
          </span>
          {info.canAddToPath && (
            <Button variant="secondary" onClick={() => void window.mentem.cliAddToPath().then(setInfo)}>
              Add to PATH
            </Button>
          )}
        </div>
      )}
      <div className="field">
        <span className="t-body-m-strong">My week ends on</span>
        <div className="pills">
          {DAY_SHORT.map((d, day) => (
            <Pill key={d} selected={settings.weekEndDay === day} onClick={() => save({ weekEndDay: day })}>
              {d}
            </Pill>
          ))}
        </div>
      </div>
      <div className="group">
        <SwitchRow title="Hide done tasks" body="Finished tasks leave Today and Week." checked={settings.hideDoneTasks} onChange={(hideDoneTasks) => save({ hideDoneTasks })} />
      </div>
      <Button variant="secondary" onClick={onRunSetup} style={{ justifySelf: "start" }}>
        Run setup again
      </Button>
    </div>
  );
}

function Appearance({ settings, save }: { settings: AppSettings; save(patch: Patch): void }) {
  const themes: ThemeId[][] = [["white-green", "white-black"], ["black-orange", "black-white"]];
  return (
    <div className="settings__form">
      {themes.map((pair, i) => (
        <div key={i} className="field">
          <span className="t-body-m-strong">{i === 0 ? "Day" : "Night"}</span>
          <div className="theme-pair">
            {pair.map((theme) => (
              <div key={theme} className="theme-option">
                <button className={`theme-card ${settings.theme === theme ? "theme-card--on" : ""}`} data-theme={theme} aria-pressed={settings.theme === theme} onClick={() => save({ theme })}>
                  <span className="t-label theme-card__label">Now</span>
                  <span className="t-timer theme-card__time">18:42</span>
                  <span className="theme-card__bar">
                    <span />
                  </span>
                  <span className="theme-card__start">Start</span>
                </button>
                <span className="theme-option__name">
                  <span className="t-body-m-strong">{THEME_NAMES[theme]}</span>
                  {settings.theme === theme && <span className="t-caption muted">Selected</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="group">
        <SwitchRow title="Match my system" body="Switch between Day and Night automatically, keeping the accent you picked." checked={settings.matchSystem} onChange={(matchSystem) => save({ matchSystem })} />
      </div>
    </div>
  );
}

function Focus({ settings, save }: { settings: AppSettings; save(patch: Patch): void }) {
  const current = PRESETS.find((p) => p.values.focus === settings.pomodoroMinutes && p.values.short === settings.shortBreakMinutes && p.values.long === settings.longBreakMinutes && p.values.cycles === settings.cyclesBeforeLongBreak)?.key ?? "custom";
  return (
    <div className="settings__form">
      <div className="pills">
        {PRESETS.map((p) => (
          <Pill key={p.key} selected={current === p.key} onClick={() => save({ pomodoroMinutes: p.values.focus, shortBreakMinutes: p.values.short, longBreakMinutes: p.values.long, cyclesBeforeLongBreak: p.values.cycles })}>
            {p.label}
          </Pill>
        ))}
        <Pill selected={current === "custom"}>Custom</Pill>
      </div>
      <div className="group">
        <StepperRow title="Focus session" unit="minutes" min={1} max={180} value={settings.pomodoroMinutes} onChange={(v) => save({ pomodoroMinutes: v })} />
        <StepperRow title="Short break" unit="minutes" min={1} max={60} value={settings.shortBreakMinutes} onChange={(v) => save({ shortBreakMinutes: v })} />
        <StepperRow title="Long break" unit="minutes" min={1} max={120} value={settings.longBreakMinutes} onChange={(v) => save({ longBreakMinutes: v })} />
        <StepperRow title="Pomodoros before a long break" unit="sessions" min={1} max={12} value={settings.cyclesBeforeLongBreak} onChange={(v) => save({ cyclesBeforeLongBreak: v })} />
      </div>
      <p className="t-caption muted">If a block doesn’t divide evenly, the last pomodoro is shortened so the block ends on time.</p>
    </div>
  );
}

function Alerts({ settings, save }: { settings: AppSettings; save(patch: Patch): void }) {
  return (
    <div className="settings__form">
      <div className="group">
        <SwitchRow title="Play a sound at each change" body="Work to break, break to work, and new blocks." checked={settings.soundEnabled} onChange={(soundEnabled) => save({ soundEnabled })} />
        <SwitchRow title="Show notifications" body="A quiet nudge on the desktop when something changes." checked={settings.notificationsEnabled} onChange={(notificationsEnabled) => save({ notificationsEnabled })} />
        <SwitchRow title="Keep running in the tray" body="Closing the window won’t stop your timer." checked={settings.keepRunningInTray} onChange={(keepRunningInTray) => save({ keepRunningInTray })} />
        <SwitchRow title="Start when I log in" body="So your day begins without you opening anything." checked={settings.startOnLogin} onChange={(startOnLogin) => save({ startOnLogin })} />
        <SwitchRow title="Weekly popups" body="Offer the weekly report and planning when a week ends and begins." checked={settings.weekPopupsEnabled} onChange={(weekPopupsEnabled) => save({ weekPopupsEnabled })} />
      </div>
      <Button variant="secondary" style={{ justifySelf: "start" }} onClick={() => void window.mentem.miniToggle()}>
        Mini window
      </Button>
    </div>
  );
}

const KIND: Record<SnapshotView["kind"], string> = { daily: "Daily", "pre-migration": "Before an update", "pre-update": "Before an update", "pre-restore": "Before a restore or import", manual: "Backed up by you" };
const sizeOf = (bytes: number) => (bytes < 1_048_576 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1_048_576).toFixed(1)} MB`);

function Data() {
  const [snaps, setSnaps] = useState<SnapshotView[] | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => void window.mentem.dataSnapshots().then(setSnaps), []);
  const say = (text: string) => setMessage(text);
  const fail = () => say("That didn’t work. Nothing was changed.");
  return (
    <div className="settings__form">
      <section className="settings__section">
        <h2 className="t-h-m">Backups</h2>
        <p className="t-body-m muted">A copy is kept every day, and before anything is replaced.</p>
        <Button variant="secondary" style={{ justifySelf: "start" }} onClick={() => window.mentem.dataBackup().then((s) => { setSnaps(s); say("Backed up."); }, fail)}>
          Back up now
        </Button>
        <div className="group">
          {snaps?.length === 0 && <div className="group__row t-body-m muted">No backups yet.</div>}
          {snaps?.map((s) => (
            <div key={s.name} className="group__row">
              <div className="group__text">
                <span className="t-body-l group__title">{new Date(s.createdAt).toLocaleString()}</span>
                <span className="t-caption group__body">
                  {KIND[s.kind]} · {sizeOf(s.bytes)}
                </span>
              </div>
              {confirm === s.name ? (
                <div className="settings__confirm">
                  <span className="t-caption muted">The app restarts.</span>
                  <Button variant="ghost" onClick={() => setConfirm(null)}>
                    Cancel
                  </Button>
                  <Button onClick={() => window.mentem.dataRestore(s.name).catch(fail)}>Restore</Button>
                </div>
              ) : (
                <Button variant="secondary" onClick={() => setConfirm(s.name)}>
                  Restore
                </Button>
              )}
            </div>
          ))}
        </div>
      </section>
      <section className="settings__section">
        <h2 className="t-h-m">Export and import</h2>
        <p className="t-body-m muted">A file you can keep, move, or open in another version of the app.</p>
        <div className="row">
          <Button variant="secondary" onClick={() => window.mentem.dataExport().then((p) => p && say("Exported."), fail)}>
            Export
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              window.mentem.dataImport().then(
                (r) => {
                  if (!r) return;
                  say(`Imported ${r.rows} rows. A backup of what was here was kept. Restart to see everything.`);
                  void window.mentem.dataSnapshots().then(setSnaps);
                },
                () => say("That file couldn’t be imported. Nothing was changed."),
              )
            }
          >
            Import
          </Button>
        </div>
      </section>
      {message && (
        <p className="t-caption" role="status">
          {message}
        </p>
      )}
    </div>
  );
}

export function Settings({ settings, onSettings, onRunSetup }: SettingsProps) {
  const [tab, setTab] = useState<Tab>("General");
  const [error, setError] = useState("");
  useEffect(() => setError(""), [tab]);
  const save = (patch: Patch) => window.mentem.settingsUpdate(patch).then(onSettings, () => setError("Couldn’t save that"));

  return (
    <>
      <header className="page-header">
        <h1 className="t-h-l">Settings</h1>
        {error && <span className="t-caption danger-text">{error}</span>}
      </header>
      <div className="settings">
        <nav className="settings__tabs" aria-label="Settings">
          {TABS.map((t) => (
            <button key={t} className={`settings__tab ${t === tab ? "settings__tab--on" : ""}`} onClick={() => setTab(t)} aria-current={t === tab ? "page" : undefined}>
              {t}
            </button>
          ))}
        </nav>
        <div>
          {tab === "General" && <General key={settings.userName + settings.appName} settings={settings} save={save} onRunSetup={onRunSetup} />}
          {tab === "Appearance" && <Appearance settings={settings} save={save} />}
          {tab === "Focus" && <Focus settings={settings} save={save} />}
          {tab === "Alerts" && <Alerts settings={settings} save={save} />}
          {tab === "Data" && <Data />}
        </div>
      </div>
    </>
  );
}
