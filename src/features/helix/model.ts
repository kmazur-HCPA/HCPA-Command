export type HelixConnection = {
  user_id: string;
  generation: string;
  auth_state: string | null;
  browser_hash: string | null;
  verifier: string | null;
  auth_expires_at: string | null;
  tokens: string | null;
  connected_at: string | null;
  revision: number;
  summary: HelixSummary | null;
  summary_at: string | null;
  updated_at: string;
};
export type HelixStatus = {
  configured: boolean;
  connected: boolean;
  connectedAt?: string;
};
export const helixSections = [
  "opsqueue_mine",
  "tickets_mine",
  "tickets_unassigned",
  "changes_recent",
  "contracts_expiring",
  "assets_lifecycle",
] as const;
export type HelixSection = (typeof helixSections)[number];
export type HelixItem = {
  id: string;
  module: "opsqueue" | "ticket" | "change" | "vendor" | "asset";
  number: string | null;
  title: string | null;
  status: string | null;
  priority: string | null;
  due_date: string | null;
  updated_at: string | null;
  url: string;
};
export type HelixSummary = {
  as_of: string;
  sections: Record<HelixSection, { total: number; records: HelixItem[] }>;
};
export type HelixSummaryResponse = HelixSummary & {
  stale: boolean;
  retrievedAt: string;
};
export const helixSectionTitles: Record<HelixSection, string> = {
  opsqueue_mine: "My OpsQueue tasks",
  tickets_mine: "My tickets",
  tickets_unassigned: "Unassigned urgent and high tickets",
  changes_recent: "Changes recorded this week",
  contracts_expiring: "Contracts ending in 90 days",
  assets_lifecycle: "Assets reaching warranty end or replacement",
};
const modules = ["opsqueue", "ticket", "change", "vendor", "asset"];
const text = (v: unknown, max = 300) =>
  typeof v === "string" ? v.slice(0, max) : null;
/** Rebuild the summary from an allowlist, so nothing unexpected from Helix is stored or shown. */
export function sanitizeSummary(value: unknown): HelixSummary | null {
  const root = value as { as_of?: unknown; sections?: Record<string, unknown> };
  if (!root || typeof root.as_of !== "string" || !root.sections) return null;
  const sections = {} as HelixSummary["sections"];
  for (const name of helixSections) {
    const section = root.sections[name] as
      { total?: unknown; records?: unknown } | undefined;
    if (!section || !Array.isArray(section.records)) return null;
    const records: HelixItem[] = [];
    for (const row of section.records.slice(0, 10) as Record<
      string,
      unknown
    >[]) {
      const url = text(row.url, 500);
      if (
        !row ||
        typeof row.id !== "string" ||
        !modules.includes(row.module as string) ||
        !url ||
        !url.startsWith("https://helix.hillspafl.gov/")
      )
        continue;
      records.push({
        id: row.id.slice(0, 64),
        module: row.module as HelixItem["module"],
        number: text(row.number, 60),
        title: text(row.title),
        status: text(row.status, 60),
        priority: text(row.priority, 60),
        due_date: text(row.due_date, 10),
        updated_at: text(row.updated_at, 40),
        url,
      });
    }
    const total = Number(section.total);
    sections[name] = {
      total: Number.isInteger(total) && total >= 0 ? total : records.length,
      records,
    };
  }
  return { as_of: root.as_of.slice(0, 40), sections };
}
