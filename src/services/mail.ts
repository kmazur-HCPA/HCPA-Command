import type { AppClient } from "../platform/supabase";
import { measured } from "../platform/telemetry";

export type FlaggedMessage = {
  id: string;
  conversation_id: string;
  sender: string;
  subject: string;
  received_at: string;
  flag_due: string | null;
  importance: string;
  url: string | null;
  capture: "task" | "reminder" | "dismissed" | null;
  record_id: string | null;
};
export type FlaggedMail = {
  messages: FlaggedMessage[];
  truncated: boolean;
  window_days: number;
  retrievedAt: string;
};

async function token(client: AppClient) {
  const session = await client.auth.getSession();
  if (session.error || !session.data.session)
    throw new Error("Sign in again to see flagged email.");
  return session.data.session.access_token;
}
export async function flaggedMail(client: AppClient, signal?: AbortSignal) {
  return measured("work.read", async () => {
    const response = await fetch("/api/microsoft/flagged", {
      headers: { Authorization: `Bearer ${await token(client)}` },
      cache: "no-store",
      signal: AbortSignal.any([
        ...(signal ? [signal] : []),
        AbortSignal.timeout(30000),
      ]),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(
        result.message ||
          "Flagged email is unavailable. Check Microsoft 365 in Settings.",
      );
    return result as FlaggedMail;
  });
}
// Message ID -> record. One database transaction writes the record and capture row.
export async function captureFlagged(
  client: AppClient,
  message: Pick<FlaggedMessage, "id" | "conversation_id" | "url">,
  action: "task" | "reminder" | "dismissed",
  fields: { title?: string; due?: string | null; priority?: string } = {},
) {
  const { data, error } = await client.rpc("capture_flagged_email", {
    p_message_id: message.id,
    p_conversation_id: message.conversation_id || null,
    p_action: action,
    p_title: action === "dismissed" ? null : (fields.title ?? ""),
    p_due: fields.due ?? null,
    p_priority: fields.priority ?? "Normal",
    p_source_url: action === "dismissed" ? null : message.url,
  });
  if (error)
    throw new Error(
      error.message.includes("Choose a date")
        ? "Choose a date for the reminder."
        : error.message.includes("Add a title")
          ? "Add a title before saving."
          : "Not saved. Retry; a retry cannot create a second record.",
    );
  return data;
}
export async function undoDismiss(client: AppClient, messageId: string) {
  const { error } = await client
    .from("email_captures")
    .delete()
    .eq("message_id", messageId)
    .eq("action", "dismissed");
  if (error) throw new Error("Undo was not saved. Retry.");
}
// RE:/FW: prefixes stripped, capped at 120 characters.
export function taskTitle(subject: string) {
  const title = subject.replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, "").trim();
  return (title || "Follow up on flagged email").slice(0, 120);
}
