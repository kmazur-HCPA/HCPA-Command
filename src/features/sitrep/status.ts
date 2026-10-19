import type { SitrepRun } from "../../services/sitrep";

const names: Record<string, string> = {
  command: "Command",
  calendar: "Calendar",
  mail: "Mail",
  teams: "Teams",
  helix: "Helix",
  flagged: "Flagged mail",
};
const list = (items: string[]) =>
  items.length < 3 ? items.join(" and ") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
const partOfDay = (iso: string) => {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" })
      .formatToParts(new Date(iso))
      .find((p) => p.type === "hour")!.value,
  );
  return hour < 12 ? "this morning" : hour < 17 ? "this afternoon" : "this evening";
};

export type SitrepStatus = { tone: "complete" | "partial" | "failed"; text: string };
// A plain-language line for Work Day: whether the SITREP finished, and which source was the problem.
export function sitrepStatus(run: SitrepRun | null, attemptFailed = false): SitrepStatus | null {
  if (!run) return attemptFailed ? { tone: "failed", text: "SITREP did not finish today." } : null;
  if (run.status !== "partial" && run.status !== "complete") return null;
  if (run.status === "complete") return { tone: "complete", text: "SITREP complete." };
  const when = run.generated_at ? ` ${partOfDay(run.generated_at)}` : "";
  const failed = Object.entries(run.sources).filter(([, v]) => v === "failed").map(([k]) => names[k] ?? k);
  const partial = Object.entries(run.sources).filter(([, v]) => v === "partial").map(([k]) => names[k] ?? k);
  const parts = [
    failed.length ? `${list(failed)} unavailable` : "",
    partial.length ? `${list(partial)} incomplete` : "",
  ].filter(Boolean);
  return {
    tone: "partial",
    text: parts.length ? `SITREP is partial: ${parts.join(", ")}${when}.` : `SITREP is partial: some sources were incomplete${when}.`,
  };
}
