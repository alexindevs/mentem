import type { Page } from "../components/today/Sidebar";

export type Shortcut = { type: "quick-add" } | { type: "meeting" } | { type: "done" } | { type: "pause" } | { type: "page"; page: Page };

/** The pages 1 to 6 open, in the order of the sidebar. */
export const SHORTCUT_PAGES: Page[] = ["Today", "Week", "Meetings", "Templates", "Projects", "Reports"];

/** What to show in Settings: the key and what it does. */
export const SHORTCUT_LIST: Array<[string, string]> = [
  ["N", "New task"],
  ["M", "New meeting"],
  ["D", "Mark the current task done"],
  ["P", "Pause or resume"],
  ["1 – 6", "Today, Week, Meetings, Templates, Projects, Reports"],
  ["Esc", "Close a drawer or popup"],
];

interface KeyInfo {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  repeat?: boolean;
}

/**
 * Maps a key press to what it should do. Nothing happens while typing in a field, while a
 * drawer or popup is open, or with a modifier held, so ordinary typing and the system's own
 * shortcuts are never taken over.
 */
export function shortcutFor(event: KeyInfo, typing: boolean, covered: boolean): Shortcut | null {
  if (typing || covered || event.ctrlKey || event.altKey || event.metaKey || event.repeat) return null;
  switch (event.key.toLowerCase()) {
    case "n": return { type: "quick-add" };
    case "m": return { type: "meeting" };
    case "d": return { type: "done" };
    case "p": return { type: "pause" };
  }
  const page = SHORTCUT_PAGES[Number(event.key) - 1];
  return /^[1-6]$/.test(event.key) && page ? { type: "page", page } : null;
}

/** True when the focus is somewhere text is typed. */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}
