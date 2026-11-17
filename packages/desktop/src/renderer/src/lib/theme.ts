import { useEffect } from "react";
import type { ThemeId } from "@mentem/core";

const OPPOSITE: Record<ThemeId, ThemeId> = {
  "white-green": "black-orange",
  "black-orange": "white-green",
  "white-black": "black-white",
  "black-white": "white-black",
};

/** With "match my system" on, the chosen theme flips to its day or night twin to follow the OS. */
export function resolveTheme(theme: ThemeId, matchSystem: boolean, systemDark: boolean): ThemeId {
  if (!matchSystem) return theme;
  const isDark = theme.startsWith("black");
  return isDark === systemDark ? theme : OPPOSITE[theme];
}

/** Keeps the document's theme in step with the chosen theme and the system setting. */
export function useAppliedTheme(theme: ThemeId, matchSystem: boolean): void {
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme = resolveTheme(theme, matchSystem, query.matches);
    };
    apply();
    if (!matchSystem) return;
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [theme, matchSystem]);
}
