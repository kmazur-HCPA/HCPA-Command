import type { AppClient } from "../platform/supabase";
import { measured } from "../platform/telemetry";

export type StandupItem = {
  id: string;
  user_id: string;
  week_start: string;
  body: string;
  done: boolean;
  carried_from: string | null;
  created_at: string;
};

export async function listStandupWeek(client: AppClient, weekStart: string) {
  return measured("work.read", async () => {
    const { data, error } = await client.from("standup_items").select("*").eq("week_start", weekStart).order("created_at");
    if (error) throw new Error("Stand-up items could not be loaded. Reconnect and retry.");
    return data as StandupItem[];
  });
}
// Earlier weeks, newest first. The 200-item cap is far above a year of weekly lists.
export async function listStandupHistory(client: AppClient, beforeWeekStart: string) {
  return measured("work.read", async () => {
    const { data, error } = await client
      .from("standup_items")
      .select("*")
      .lt("week_start", beforeWeekStart)
      .order("week_start", { ascending: false })
      .order("created_at")
      .limit(200);
    if (error) throw new Error("Earlier stand-up weeks could not be loaded. Retry.");
    return data as StandupItem[];
  });
}
export async function addStandupItem(
  client: AppClient,
  userId: string,
  weekStart: string,
  body: string,
  carriedFrom: string | null = null,
) {
  return measured("work.write", async () => {
    const text = body.trim();
    if (!text) throw new Error("Write something to bring up first.");
    if (text.length > 300) throw new Error("Keep it to 300 characters or fewer.");
    const { error } = await client
      .from("standup_items")
      .insert({ id: crypto.randomUUID(), user_id: userId, week_start: weekStart, body: text, carried_from: carriedFrom });
    if (error) throw new Error("Not saved. Check your connection and try again.");
  });
}
export async function updateStandupItem(client: AppClient, id: string, body: string) {
  return measured("work.write", async () => {
    const text = body.trim();
    if (!text || text.length > 300) throw new Error("Write between 1 and 300 characters.");
    const { error } = await client.from("standup_items").update({ body: text }).eq("id", id);
    if (error) throw new Error("The change was not saved. Try again.");
  });
}
export async function removeStandupItem(client: AppClient, id: string) {
  return measured("work.write", async () => {
    const { error } = await client.from("standup_items").delete().eq("id", id);
    if (error) throw new Error("The item was not removed. Try again.");
  });
}
export async function setStandupDone(client: AppClient, id: string, done: boolean) {
  return measured("work.write", async () => {
    const { error } = await client.from("standup_items").update({ done }).eq("id", id);
    if (error) throw new Error("The change was not saved. Try again.");
  });
}
