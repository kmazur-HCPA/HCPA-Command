import type { AppClient } from "../../../../src/platform/supabase";
import { outlookLink } from "../../../../src/features/microsoft/model";
import { connection, graphRead, graphUrl } from "./client";

const zone = "America/New_York";
const maxSent = 1000;
const str = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const rows = (v: unknown) => (Array.isArray(v) ? v.map(obj) : []);

const etParts = (ms: number) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" })
      .formatToParts(new Date(ms)).map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}`, weekday: p.weekday! };
};
// Midnight Eastern on a business date, as a UTC instant (handles DST).
function easternMidnight(date: string) {
  for (const offset of ["-04:00", "-05:00"]) {
    const ms = Date.parse(`${date}T00:00:00${offset}`);
    const t = etParts(ms);
    if (t.date === date && t.hm === "00:00") return ms;
  }
  throw new Error("Invalid date.");
}
export function defaultSince(now = Date.now()) {
  let date = etParts(now).date,
    left = 3;
  while (left > 0) {
    const ms = Date.parse(date + "T12:00:00Z") - 86400000;
    date = new Date(ms).toISOString().slice(0, 10);
    const day = new Date(date + "T12:00:00Z").getUTCDay();
    if (day !== 0 && day !== 6) left--;
  }
  return new Date(easternMidnight(date)).toISOString();
}
const offsetDate =
  /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(Z|[+-]\d\d:\d\d)$/;
export function directArgs(args: Record<string, unknown>, now = Date.now()) {
  if (Object.keys(args).sort().join() !== "limit,since")
    throw new Error("Provide only since and limit (null for defaults).");
  let since = defaultSince(now);
  if (args.since !== null) {
    if (typeof args.since !== "string" || !offsetDate.test(args.since) || !Number.isFinite(Date.parse(args.since)))
      throw new Error("since needs an ISO date-time with a timezone offset.");
    const ms = Date.parse(args.since);
    if (ms < now - 14 * 86400000 || ms > now) throw new Error("since must be within the last 14 days.");
    since = new Date(ms).toISOString();
  }
  let limit = 50;
  if (args.limit !== null) {
    if (!Number.isInteger(args.limit) || Number(args.limit) < 1 || Number(args.limit) > 100)
      throw new Error("limit must be an integer from 1 to 100.");
    limit = Number(args.limit);
  }
  return { since, limit };
}
const escape = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
export function isAutomated(address: string, patterns: string[]) {
  const a = address.toLowerCase(), domain = a.split("@")[1] ?? "";
  return patterns.some((raw) => {
    const re = new RegExp("^" + raw.toLowerCase().split("*").map(escape).join(".*") + "$");
    return re.test(a) || (!!domain && re.test(domain));
  });
}

export async function directMail(
  store: AppClient,
  userId: string,
  accessToken: string,
  signal: AbortSignal,
  args: Record<string, unknown>,
  now = Date.now(),
) {
  const { since, limit } = directArgs(args, now);
  const [conn, senders] = await Promise.all([
    connection(store, userId),
    store.from("mail_automated_senders").select("pattern"),
  ]);
  const me = conn?.account_email?.toLowerCase() ?? "";
  if (!me) throw new Error("Microsoft account unavailable. Reconnect in Settings.");
  if (senders.error) throw new Error("Automated-sender list unavailable.");
  const patterns = senders.data.map((s) => s.pattern);

  const inbox = new URL("https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages");
  inbox.searchParams.set("$filter", `receivedDateTime ge ${since}`);
  inbox.searchParams.set("$orderby", "receivedDateTime desc");
  inbox.searchParams.set("$select", "id,conversationId,subject,from,toRecipients,receivedDateTime,importance,flag,inferenceClassification,webLink");
  inbox.searchParams.set("$top", String(limit));
  const sent = new URL("https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages");
  sent.searchParams.set("$filter", `sentDateTime ge ${since}`);
  sent.searchParams.set("$select", "conversationId,sentDateTime");
  sent.searchParams.set("$top", "200");

  const received = await graphRead(graphUrl(inbox.href, "inbox"), accessToken, signal, true);
  const messages = rows(received.value).slice(0, limit);
  const truncated = typeof received["@odata.nextLink"] === "string";

  // Latest reply per conversation. Paged so a busy week doesn't hide replies.
  const lastSent = new Map<string, number>();
  let seen = 0,
    next: string | undefined = sent.href,
    sentTruncated = false;
  while (next) {
    const page = await graphRead(graphUrl(next, "sentitems"), accessToken, signal, true);
    for (const m of rows(page.value)) {
      seen++;
      const id = str(m.conversationId, 1500), at = Date.parse(str(m.sentDateTime, 40));
      if (id && Number.isFinite(at)) lastSent.set(id, Math.max(lastSent.get(id) ?? 0, at));
    }
    next = typeof page["@odata.nextLink"] === "string" ? page["@odata.nextLink"] : undefined;
    if (next && seen >= maxSent) {
      sentTruncated = true;
      break;
    }
  }
  const records = messages.map((m) => {
    const from = obj(obj(m.from).emailAddress),
      address = str(from.address, 254).toLowerCase(),
      conv = str(m.conversationId, 1500),
      received = Date.parse(str(m.receivedDateTime, 40));
    return {
      immutable_id: str(m.id, 1500),
      conversation_id: conv,
      sender_name: str(from.name, 150),
      sender_address: address,
      subject: str(m.subject, 250),
      received_at: str(m.receivedDateTime, 40),
      importance: str(m.importance, 20),
      flag_status: str(obj(m.flag).flagStatus, 20),
      to_me: rows(m.toRecipients).some((r) => str(obj(r.emailAddress).address, 254).toLowerCase() === me),
      replied: !!conv && (lastSent.get(conv) ?? 0) > received,
      focused: str(m.inferenceClassification, 20) === "focused",
      automated: isAutomated(address, patterns),
      web_link: outlookLink(m.webLink) ?? null,
    };
  });
  return {
    source: "Microsoft Outlook",
    records,
    total_returned: records.length,
    truncated,
    sent_items_truncated: sentTruncated,
    since,
    retrieved_at: new Date().toISOString(),
  };
}
