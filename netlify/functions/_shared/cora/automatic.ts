import { createHash } from "node:crypto";
import type { AppClient } from "../../../../src/platform/supabase";
import {
  outlookLink,
  teamsLink,
} from "../../../../src/features/microsoft/model";
import { validateFields } from "./actions";
import { definition } from "../microsoft/tools";
export const automaticTools = [
  definition(
    "get_workday_reviews",
    "Read the five most recent review receipts to establish the last successful review and any missed/partial coverage.",
    {},
  ),
  definition(
    "create_reminder",
    "Save a Command reminder immediately under Kevin’s explicit authorization. No confirmation needed. Only clear obligations/follow-ups; not every email or meeting. Search existing records first, including resolved/archived items. Never recreate a dismissed/completed source. For external evidence source_url MUST be its original Outlook/Teams link, and source_key its stable original message/event ID (never expiring reference or run ID). For direct user requests source_url=null and source_key a new UUID reused on retry. One reminder per source; combine related actions. Date-only=due_date, timed=remind_at with timezone; never both. Body is a short reason, not copied email/chat contents. Never change other record types with this tool.",
    {
      title: { type: "string" },
      body: { type: "string" },
      due_date: { type: ["string", "null"] },
      remind_at: { type: ["string", "null"] },
      source_key: { type: "string" },
      source_url: { type: ["string", "null"] },
    },
  ),
  definition(
    "record_workday_review",
    'Record a workday review in Command. Begin with status=running, summary="", and a new UUID run_id. Reuse that run_id to finish with complete/partial/failed and a concise summary of coverage, reminders, suggested priorities, Waiting On changes and source gaps. No emails or Teams messages are sent. These are observations, not changes to existing work records.',
    {
      run_id: { type: "string" },
      status: {
        type: "string",
        enum: ["running", "complete", "partial", "failed"],
      },
      summary: { type: "string" },
    },
  ),
];
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function reminderArgs(args: Record<string, unknown>) {
  if (
    Object.keys(args).sort().join() !==
      "body,due_date,remind_at,source_key,source_url,title" ||
    typeof args.source_key !== "string" ||
    !args.source_key.trim() ||
    args.source_key.length > 2000 ||
    typeof args.body !== "string" ||
    args.body.length > 1500
  )
    throw new Error("Invalid reminder fields.");
  const fields = validateFields("reminder", {
    title: args.title,
    body: args.body,
    due_date: args.due_date,
    remind_at: args.remind_at,
  });
  if (fields.due_date && fields.remind_at)
    throw new Error("Use a date OR a time, not both.");
  const url = outlookLink(args.source_url) ?? teamsLink(args.source_url);
  if (args.source_url !== null && !url)
    throw new Error("Use the original Outlook or Teams source link.");
  if (!url && !uuid.test(args.source_key))
    throw new Error("Direct requests require a stable UUID.");
  // A source URL is more stable than model-generated keys or expiring discovery references.
  const hash = createHash("sha256")
    .update(url ? "external:" + url : "direct:" + args.source_key)
    .digest("hex");
  return {
    fields,
    hash,
    body:
      args.body + (url ? "\n\nSource: " + url : "") + "\n\nCreated by Cora.",
  };
}
export async function automaticTool(
  store: AppClient,
  userId: string,
  name: string,
  args: Record<string, unknown>,
) {
  const membership = await store
    .from("app_memberships")
    .select("active")
    .eq("user_id", userId)
    .maybeSingle();
  if (membership.error || !membership.data?.active)
    throw new Error("Command access unavailable.");
  if (name === "get_workday_reviews") {
    if (Object.keys(args).length) throw new Error("No arguments accepted.");
    const r = await store
      .from("cora_workday_reviews")
      .select("*")
      .eq("user_id", userId)
      .order("started_at", { ascending: false })
      .limit(5);
    if (r.error) throw new Error("Review history unavailable.");
    return { reviews: r.data };
  }
  const pref = await store
    .from("cora_review_preferences")
    .select("automatic_reminders")
    .eq("user_id", userId)
    .maybeSingle();
  if (
    membership.error ||
    !membership.data?.active ||
    pref.error ||
    !pref.data?.automatic_reminders
  )
    throw new Error(
      "Automatic reviews/reminders are paused in Command Settings.",
    );
  if (name === "create_reminder") {
    const p = reminderArgs(args);
    const result = await store.rpc("cora_create_reminder", {
      p_user: userId,
      p_source_hash: p.hash,
      p_title: p.fields.title!,
      p_body: p.body,
      p_due: p.fields.due_date ?? null,
      p_at: p.fields.remind_at ?? null,
    });
    if (result.error)
      throw new Error(
        "Reminder save was not confirmed. Retry the same source; check Command Settings if the daily limit was reached.",
      );
    return result.data;
  }
  if (
    name !== "record_workday_review" ||
    Object.keys(args).sort().join() !== "run_id,status,summary" ||
    typeof args.run_id !== "string" ||
    !uuid.test(args.run_id) ||
    !["running", "complete", "partial", "failed"].includes(
      String(args.status),
    ) ||
    typeof args.summary !== "string" ||
    args.summary.length > 6000
  )
    throw new Error("Invalid review receipt.");
  if (args.status === "running") {
    const r = await store
      .from("cora_workday_reviews")
      .upsert(
        { id: args.run_id, user_id: userId, status: "running", summary: "" },
        { onConflict: "id", ignoreDuplicates: true },
      )
      .select("id");
    if (r.error) throw new Error("Could not start review.");
  } else {
    const r = await store
      .from("cora_workday_reviews")
      .update({
        status: String(args.status),
        summary: args.summary,
        finished_at: new Date().toISOString(),
      })
      .eq("id", args.run_id)
      .eq("user_id", userId)
      .select("id")
      .maybeSingle();
    if (r.error || !r.data)
      throw new Error("Review unavailable. Start the review first.");
  }
  return { saved: true, run_id: args.run_id, status: args.status };
}
