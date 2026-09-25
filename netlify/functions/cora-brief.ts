import type { Config } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/data/database.types";
import { slotAt, slotRunId, writeBrief } from "./_shared/cora/brief";
import { createProvider } from "./_shared/cora/provider";
import { today } from "./_shared/cora/tools";
import { microsoftConfig } from "./_shared/microsoft/config";

// Replaces the ChatGPT agent automations: Command prepares the weekday Command
// Brief itself at 6:45 AM, 9 AM, 11 AM, 1 PM and 3 PM Eastern. The cron runs every
// quarter hour across both EDT and EST offsets; slotAt() picks the Eastern slot.
export default async () => {
  const env = (name: string) => Netlify.env.get(name);
  const url = env("SUPABASE_URL"),
    secret = env("SUPABASE_SECRET_KEY"),
    apiKey = env("ANTHROPIC_API_KEY"),
    deploy = env("CONTEXT");
  const now = new Date(),
    slot = slotAt(now);
  if ((deploy && deploy !== "production") || !url || !secret || !apiKey || !slot)
    return;
  const store = createClient<Database>(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(8000) }),
    },
  });
  const owners = await store
    .from("cora_review_preferences")
    .select("user_id")
    .eq("automatic_reminders", true);
  if (owners.error) {
    console.error(JSON.stringify({ event: "cora_brief_schedule", slot, error: "owners_unavailable" }));
    return;
  }
  const settings = {
    apiKey,
    baseURL: env("ANTHROPIC_BASE_URL"),
    model: env("CORA_MODEL"),
    effort: env("CORA_EFFORT"),
  };
  // Scheduled functions stop at 30 seconds; leave room to record a failure.
  const signal = AbortSignal.timeout(25000);
  const results = await Promise.allSettled(
    owners.data.map(({ user_id }) =>
      writeBrief({
        store,
        userId: user_id,
        provider: createProvider(settings, 24000),
        settings,
        microsoft: microsoftConfig(env),
        signal,
        runId: slotRunId(user_id, today(now), slot),
        now,
      }),
    ),
  );
  // Counts only: no brief text, record content or owner IDs enter logs.
  console.info(
    JSON.stringify({
      event: "cora_brief_schedule",
      slot,
      saved: results.filter((r) => r.status === "fulfilled" && r.value.state === "saved").length,
      skipped: results.filter((r) => r.status === "fulfilled" && r.value.state === "skipped").length,
      failed: results.filter((r) => r.status === "rejected" || r.value.state === "failed").length,
    }),
  );
};
export const config: Config = { schedule: "*/15 10-20 * * 1-5" };
