import type { AppClient } from "../platform/supabase";
import { fromLocalDateTime } from "../features/work/dates";

export type UsageEvent = "app_open" | "capture" | "day_close" | "sitrep_opened";
// Habit metrics only count events; they never store what was captured or read.
// Best effort: a metric must never block or fail the action it describes.
export async function recordUsage(
  client: AppClient,
  userId: string,
  event: UsageEvent,
  source: "web" | "chat" | "shortcut" | "push" = "web",
) {
  try {
    await client.from("usage_events").insert({ user_id: userId, event, source });
  } catch {
    // Ignore.
  }
}

export type WeekSummary = { closedDays: number; weekdays: number; captures: number };
// "This week: 4/5 days closed · 11 captures" for the current Monday-to-Friday week (Eastern).
export async function weekSummary(client: AppClient, userId: string, mondayIso: string, weekdays: number): Promise<WeekSummary> {
  const [closes, captures] = await Promise.all([
    client.from("day_closes").select("for_date").eq("user_id", userId).gte("for_date", mondayIso).limit(60),
    client
      .from("usage_events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("event", "capture")
      .gte("created_at", fromLocalDateTime(`${mondayIso}T00:00`)),
  ]);
  if (closes.error || captures.error) throw new Error("Weekly habit summary unavailable.");
  return { closedDays: new Set(closes.data!.map((r) => r.for_date)).size, weekdays, captures: captures.count ?? 0 };
}

// The latest receipt for a given Eastern date, so Work Day can say the day is already closed.
export async function closeReceipt(client: AppClient, userId: string, date: string) {
  const { data, error } = await client
    .from("day_closes")
    .select("completed_at,counts")
    .eq("user_id", userId)
    .eq("for_date", date)
    .order("completed_at", { ascending: false })
    .limit(1);
  if (error) throw new Error("Close receipt unavailable.");
  return data[0] ?? null;
}
