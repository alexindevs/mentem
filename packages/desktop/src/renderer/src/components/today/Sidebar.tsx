import { useState } from "react";
import { Mark } from "../Mark";

export type Page = "Today" | "Week" | "Meetings" | "Templates" | "Projects" | "Reports" | "Settings";
type Name = Page;

const ICONS: Record<Name | "Collapse" | "Expand", ReactIconPath> = {
  Today: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "m8.5 12.2 2.4 2.4 4.6-4.9"],
  Week: ["M4 6.5h16V20H4zM4 10.5h16M8.5 4v4M15.5 4v4"],
  Meetings: ["M4 6.5h11a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H4z", "m17 10.5 4-2.5v8l-4-2.5"],
  Templates: ["m12 4 9 4.5-9 4.5-9-4.5z", "m3 12.5 9 4.5 9-4.5", "m3 16.5 9 4.5 9-4.5"],
  Projects: ["M3.5 6.5h6l2 2.2h9V19h-17z"],
  Reports: ["M5 20v-9M12 20V4M19 20v-6"],
  Settings: ["M4 7h9M17 7h3M4 17h3M11 17h9", "M15 5v4M9 15v4"],
  Collapse: ["m15 6-6 6 6 6"],
  Expand: ["m9 6 6 6-6 6"],
};
type ReactIconPath = string[];

/** Pages that exist. The rest show as unavailable until they are built. */
const AVAILABLE = new Set<Name>(["Today", "Week", "Meetings", "Templates", "Projects", "Reports", "Settings"]);
const NAV: Name[] = ["Today", "Week", "Meetings", "Templates", "Projects", "Reports"];

function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

function Item({ name, collapsed, active, onOpen }: { name: Name; collapsed: boolean; active?: boolean; onOpen(): void }) {
  return (
    <button className={`sidebar__item ${active ? "sidebar__item--active" : ""}`} disabled={!AVAILABLE.has(name)} onClick={onOpen} aria-current={active ? "page" : undefined} aria-label={name} title={collapsed ? name : undefined}>
      <Icon name={name} />
      {!collapsed && <span>{name}</span>}
    </button>
  );
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem("sidebar-collapsed") === "1";
  } catch {
    return false;
  }
}

export function Sidebar({ appName, page, onNavigate }: { appName: string; page: Page; onNavigate(page: Page): void }) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggle = () => {
    setCollapsed(!collapsed);
    try {
      localStorage.setItem("sidebar-collapsed", collapsed ? "0" : "1");
    } catch {
      /* the choice just won't be remembered */
    }
  };
  return (
    <aside className={`sidebar ${collapsed ? "sidebar--collapsed" : ""}`}>
      <div className="sidebar__brand">
        <Mark size={32} variant="small" />
        {!collapsed && <span className="t-h-m">{appName}</span>}
      </div>
      <nav className="sidebar__nav">
        {NAV.map((name) => (
          <Item key={name} name={name} collapsed={collapsed} active={name === page} onOpen={() => onNavigate(name)} />
        ))}
      </nav>
      <span className="sidebar__space" />
      <Item name="Settings" collapsed={collapsed} active={page === "Settings"} onOpen={() => onNavigate("Settings")} />
      <button className="sidebar__item" onClick={toggle} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand" : undefined}>
        <Icon name={collapsed ? "Expand" : "Collapse"} />
        {!collapsed && <span>Collapse</span>}
      </button>
    </aside>
  );
}
