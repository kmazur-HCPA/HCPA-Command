import { useCallback, useEffect, useState } from "react";
import type { SitrepRun } from "../../services/sitrep";

const sourceNames: Record<string, string> = {
  command: "Command",
  calendar: "Calendar",
  mail: "Mail",
  teams: "Teams",
  helix: "Helix",
  flagged: "Flagged email",
};
const storageKey = "command.sitrep.collapsed";
export const drawerQuery = "(max-width: 1100px)";

// Whitelist rendering: **bold** becomes <strong>, everything else is literal text.
export function boldParts(text: string) {
  return text.split(/\*\*([^*]+)\*\*/g).map((part, i) =>
    i % 2 ? <strong key={i}>{part}</strong> : part,
  );
}
export function problems(run: SitrepRun) {
  const bad = Object.entries(run.sources).filter(([, s]) => s !== "ok");
  return bad.map(([k, s]) => `${sourceNames[k] ?? k} ${s === "failed" ? "unavailable" : "incomplete"}`);
}

export function useSitrepLayout() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(storageKey) === "1";
    } catch {
      return false;
    }
  });
  const [drawer, setDrawer] = useState(false);
  const [narrow, setNarrow] = useState(() => window.matchMedia(drawerQuery).matches);
  useEffect(() => {
    const query = window.matchMedia(drawerQuery);
    const change = () => {
      setNarrow(query.matches);
      if (!query.matches) setDrawer(false);
    };
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  const toggleCollapsed = useCallback(() => {
    setCollapsed((v) => {
      try {
        localStorage.setItem(storageKey, v ? "0" : "1");
      } catch {
        /* Storage can be blocked; the panel still works for this visit. */
      }
      return !v;
    });
  }, []);
  return { collapsed, toggleCollapsed, drawer, setDrawer, narrow };
}

