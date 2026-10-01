import type { AppClient } from "../../../../src/platform/supabase";
import { outlookLink } from "../../../../src/features/microsoft/model";
import { graphRead, graphUrl } from "./client";

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
const zone = "America/New_York";
const day = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(new Date(iso));
const str = (v: unknown, limit: number) =>
  typeof v === "string" ? v.slice(0, limit) : "";
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
export const windowDays = 90;

function flaggedUrl(since: string, ordered: boolean) {
  const url = new URL("https://graph.microsoft.com/v1.0/me/messages");
  // Graph wants $orderby properties first in $filter. If it rejects the combination
  // we retry unordered and sort here (see flaggedMail).
  url.searchParams.set(
    "$filter",
    ordered
      ? `receivedDateTime ge ${since} and flag/flagStatus eq 'flagged'`
      : `flag/flagStatus eq 'flagged'`,
  );
  if (ordered) url.searchParams.set("$orderby", "receivedDateTime desc");
  url.searchParams.set(
    "$select",
    "id,conversationId,subject,from,receivedDateTime,importance,flag,webLink",
  );
  url.searchParams.set("$top", ordered ? "50" : "100");
  return url;
}
export function summarizeFlagged(row: Record<string, unknown>) {
  const from = obj(obj(row.from).emailAddress),
    flag = obj(row.flag),
    due = obj(flag.dueDateTime);
  const dueTime = str(due.dateTime, 40);
  return {
    id: str(row.id, 1500),
    conversation_id: str(row.conversationId, 1500),
    sender: str(from.name, 150) || str(from.address, 254),
    subject: str(row.subject, 250),
    received_at: str(row.receivedDateTime, 40),
    // Graph returns UTC because graphRead asks for it; show Kevin's Eastern date.
    flag_due:
      dueTime && Number.isFinite(Date.parse(dueTime + "Z"))
        ? day(dueTime + "Z")
        : null,
    importance: str(row.importance, 20),
    url: outlookLink(row.webLink) ?? null,
    flagged: flag.flagStatus === "flagged",
  };
}

// Live read: nothing from Outlook is stored. Capture rows hold IDs only.
export async function flaggedMail(
  store: AppClient,
  userId: string,
  accessToken: string,
  signal: AbortSignal,
  now = Date.now(),
) {
  const since = new Date(now - windowDays * 86400000).toISOString();
  let truncated: boolean;
  let rows: Record<string, unknown>[];
  try {
    const data = await graphRead(
      graphUrl(flaggedUrl(since, true).href, "messages"),
      accessToken,
      signal,
      true,
    );
    rows = Array.isArray(data.value) ? data.value.map(obj) : [];
    truncated = typeof data["@odata.nextLink"] === "string";
  } catch (error) {
    if ((error as { status?: number }).status !== 400) throw error;
    const data = await graphRead(
      graphUrl(flaggedUrl(since, false).href, "messages"),
      accessToken,
      signal,
      true,
    );
    rows = (Array.isArray(data.value) ? data.value.map(obj) : [])
      .filter((r) => Date.parse(str(r.receivedDateTime, 40)) >= Date.parse(since))
      .sort((a, b) =>
        str(b.receivedDateTime, 40).localeCompare(str(a.receivedDateTime, 40)),
      )
      .slice(0, 50);
    truncated = typeof data["@odata.nextLink"] === "string";
  }
  const items = rows.map(summarizeFlagged).filter((m) => m.id && m.flagged);
  const captures = items.length
    ? await store
        .from("email_captures")
        .select("message_id,action,record_id")
        .eq("user_id", userId)
        .in(
          "message_id",
          items.map((m) => m.id),
        )
    : { data: [], error: null };
  if (captures.error) throw new Error("Flagged mail state is unavailable.");
  const state = new Map(captures.data!.map((c) => [c.message_id, c]));
  const messages: FlaggedMessage[] = items.map(({ flagged, ...m }) => {
    void flagged;
    const c = state.get(m.id);
    return {
      ...m,
      capture: (c?.action as FlaggedMessage["capture"]) ?? null,
      record_id: c?.record_id ?? null,
    };
  });
  return { messages, truncated, window_days: windowDays };
}
