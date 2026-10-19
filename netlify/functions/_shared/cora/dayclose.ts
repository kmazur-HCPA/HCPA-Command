import type { AppClient } from "../../../../src/platform/supabase";
import { outlookLink } from "../../../../src/features/microsoft/model";
import { applyDayClose, loadDayClose } from "../../../../src/services/close";
import { etDate, type CloseAction, type CloseMail } from "../../../../src/features/close/rules";
import { definition } from "../microsoft/tools";
import { uuid } from "./tools";

export const dayCloseDefinitions = [
  definition(
    "get_day_close",
    "Read Close the Day, the end-of-day tidy-up: what was Done today, what is Still open (due today or overdue up to 7 days), Stale items (more than 7 days overdue, or reminders past due and untouched) each with a proposed action, flagged Outlook mail not yet converted, and open tasks that could be tomorrow's first item. Proposals come from fixed rules, not judgment. This only reads; it changes nothing. Present the sections, let Kevin choose, then call apply_day_close with only what he confirmed.",
    {},
  ),
  definition(
    "apply_day_close",
    'Apply the choices Kevin explicitly confirmed in chat for Close the Day, atomically. Never include an action he did not confirm; a proposal is not a confirmation. actions_json is a JSON array of {"id","version","op"} with op done (complete), date (needs "date" YYYY-MM-DD, moves the due date or reminder) or drop (archives; never deletes). Versions come from get_day_close; a stale version rejects the whole batch, so read again instead of guessing. mail_json is a JSON array of flagged-mail conversions {"message_id","conversation_id","action","title","due","priority","url"} where action is task, reminder (needs due), waiting (due is the follow-up date) or dismissed; take message_id, conversation_id and url from get_flagged_mail or get_day_close, never invent them. first_item_id is the open task for tomorrow\'s priority slot 1, or null. Set finish=true on the last call: it records the receipt that the next morning\'s SITREP reads. Only claim it is saved from a returned receipt_id.',
    {
      actions_json: { type: "string" },
      mail_json: { type: "string" },
      first_item_id: { type: ["string", "null"] },
      finish: { type: "boolean" },
    },
  ),
];

const compact = (i: Record<string, unknown>, keys: string[]) =>
  Object.fromEntries(keys.filter((k) => i[k] !== null && i[k] !== undefined).map((k) => [k, i[k]]));
const itemKeys = ["id", "title", "kind", "status", "priority", "due_date", "remind_at", "snoozed_until", "version", "overdue_days", "proposal"];

export async function getDayClose(store: AppClient, userId: string, now = new Date()) {
  const close = await loadDayClose(store, userId, etDate(now));
  return {
    for_date: close.for_date,
    roll_date: close.roll_date,
    done_today: close.done.map((i) => compact(i as never, ["id", "title", "kind", "completed_at"])),
    still_open: close.open.map((i) => compact(i as never, itemKeys)),
    stale: close.stale.map((i) => compact(i as never, itemKeys)),
    first_item_candidates: close.first_candidates.map((i) => compact(i as never, ["id", "title", "priority", "due_date", "version"])),
    flagged_mail: null as unknown,
    note: "Nothing has been changed. Apply only what Kevin confirms, with apply_day_close.",
  };
}

const isDate = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const parseArray = (value: unknown, max: number, label: string) => {
  if (typeof value !== "string" || value.length > 60000) throw new Error(`${label} must be a JSON string.`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
  if (!Array.isArray(parsed) || parsed.length > max) throw new Error(`${label} must be a JSON array of at most ${max} entries.`);
  return parsed as Record<string, unknown>[];
};
export function dayCloseInput(args: Record<string, unknown>) {
  if (
    Object.keys(args).sort().join() !== "actions_json,finish,first_item_id,mail_json" ||
    typeof args.finish !== "boolean" ||
    !(args.first_item_id === null || (typeof args.first_item_id === "string" && uuid.test(args.first_item_id)))
  )
    throw new Error("Send actions_json, mail_json, first_item_id and finish.");
  const actions = parseArray(args.actions_json, 100, "actions_json").map((a): CloseAction => {
    if (
      Object.keys(a).some((k) => !["id", "version", "op", "date"].includes(k)) ||
      typeof a.id !== "string" || !uuid.test(a.id) ||
      !Number.isInteger(a.version) || Number(a.version) < 1 ||
      !["done", "date", "drop"].includes(String(a.op)) ||
      (a.op === "date" ? !isDate(a.date) : a.date !== undefined)
    )
      throw new Error("Each action needs id, version, op (done|date|drop) and, for date, a YYYY-MM-DD date.");
    return { id: a.id, version: Number(a.version), op: a.op as CloseAction["op"], ...(a.op === "date" ? { date: a.date as string } : {}) };
  });
  const mail = parseArray(args.mail_json, 50, "mail_json").map((m): CloseMail => {
    const url = m.url === null || m.url === undefined || m.url === "" ? null : (outlookLink(m.url) ?? null);
    if (
      Object.keys(m).some((k) => !["message_id", "conversation_id", "action", "title", "due", "priority", "url"].includes(k)) ||
      typeof m.message_id !== "string" || !m.message_id || m.message_id.length > 1500 ||
      !["task", "reminder", "waiting", "dismissed"].includes(String(m.action)) ||
      (m.action !== "dismissed" && (typeof m.title !== "string" || !m.title.trim() || m.title.length > 200)) ||
      (m.due !== undefined && m.due !== null && m.due !== "" && !isDate(m.due)) ||
      (m.action === "reminder" && !isDate(m.due)) ||
      (m.priority !== undefined && !["Critical", "High", "Normal", "Low"].includes(String(m.priority))) ||
      (m.url && !url)
    )
      throw new Error("Each mail conversion needs message_id, action, a title (not for dismissed), a valid due date, and an Outlook link.");
    return {
      message_id: m.message_id,
      conversation_id: typeof m.conversation_id === "string" ? m.conversation_id.slice(0, 1500) : "",
      action: m.action as CloseMail["action"],
      title: typeof m.title === "string" ? m.title.trim() : "",
      due: isDate(m.due) ? m.due : null,
      priority: typeof m.priority === "string" ? m.priority : "Normal",
      url,
    };
  });
  if (!actions.length && !mail.length && args.first_item_id === null && !args.finish)
    throw new Error("Nothing to apply. Send at least one confirmed choice, or finish=true to record the close.");
  return { actions, mail, first: args.first_item_id as string | null, finish: args.finish };
}
export async function applyDayCloseTool(store: AppClient, userId: string, args: Record<string, unknown>, now = new Date()) {
  const input = dayCloseInput(args);
  const result = await applyDayClose(store, userId, etDate(now), {
    actions: input.actions,
    mail: input.mail,
    first: input.first,
    finish: input.finish,
    source: "chat",
  });
  return { saved: true, finished: input.finish, ...result };
}
