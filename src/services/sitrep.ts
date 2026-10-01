import type { AppClient } from "../platform/supabase";
import type { SitrepPayload } from "../features/sitrep/schema";

export type SitrepRun = {
  run_id: string;
  for_date: string;
  run_slot: "am" | "midday" | "manual";
  status: "running" | "complete" | "partial" | "failed";
  started_at: string;
  generated_at: string | null;
  sources: Record<string, string>;
  payload: SitrepPayload | null;
  error_note: string | null;
};
export type SitrepState = {
  run: SitrepRun | null; // latest complete/partial, today's first
  isToday: boolean;
  todayFailure: SitrepRun | null; // today's failed or stale-running attempt
};
const columns =
  "run_id,for_date,run_slot,status,started_at,generated_at,sources,payload,error_note";
export const staleRunningMs = 30 * 60 * 1000;

export async function loadSitrep(
  client: AppClient,
  today: string,
  now = Date.now(),
): Promise<SitrepState> {
  const [todays, latest, attempts] = await Promise.all([
    client
      .from("sitrep_runs")
      .select(columns)
      .eq("for_date", today)
      .in("status", ["complete", "partial"])
      .order("generated_at", { ascending: false })
      .limit(1),
    client
      .from("sitrep_runs")
      .select(columns)
      .in("status", ["complete", "partial"])
      .order("generated_at", { ascending: false })
      .limit(1),
    client
      .from("sitrep_runs")
      .select(columns)
      .eq("for_date", today)
      .in("status", ["failed", "running"])
      .order("started_at", { ascending: false })
      .limit(3),
  ]);
  if (todays.error || latest.error || attempts.error)
    throw new Error("SITREP is unavailable. Retry in a moment.");
  const current = (todays.data[0] as SitrepRun | undefined) ?? null;
  const run = current ?? (latest.data[0] as SitrepRun | undefined) ?? null;
  const failure =
    (attempts.data as SitrepRun[]).find(
      (r) =>
        r.status === "failed" ||
        (r.status === "running" &&
          now - Date.parse(r.started_at) > staleRunningMs),
    ) ?? null;
  // A failed attempt only matters if nothing newer succeeded.
  const todayFailure =
    failure &&
    (!current ||
      Date.parse(failure.started_at) > Date.parse(current.generated_at ?? ""))
      ? failure
      : null;
  return { run, isToday: !!current, todayFailure };
}

// One batched lookup for the records a run points at. RLS scopes it to the owner.
export async function recordStatus(client: AppClient, ids: string[]) {
  const map = new Map<string, { status: string; archived: boolean } | null>(
    ids.map((id) => [id, null]),
  );
  if (!ids.length) return map;
  const r = await client.from("work_items").select("id,status,archived").in("id", ids);
  if (r.error) throw new Error("Record status unavailable.");
  for (const row of r.data) map.set(row.id, { status: row.status, archived: row.archived });
  return map;
}
