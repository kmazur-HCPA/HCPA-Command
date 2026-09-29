import type { AppClient } from "../../../../src/platform/supabase";
import type { Kind, WorkInput } from "../../../../src/features/work/model";
import { validateFields } from "./actions";
import { definition } from "../microsoft/tools";

const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const allowed = ["status", "due_date", "snoozed_until"];
const kinds = ["task", "reminder", "waiting"];
export const quickUpdateDefinition = definition(
  "quick_update",
  'Apply a small, reversible change to ONE existing Task, Reminder or Waiting On item immediately when Kevin asks: complete or reopen a task (status), complete/dismiss/snooze/reactivate a reminder (status, and snoozed_until for Snoozed), or change a due_date. No confirmation card. Read the record first for its version. fields_json is a JSON object with ONLY status, due_date (YYYY-MM-DD or null) and/or snoozed_until (ISO timestamp WITH timezone). Everything else (titles, notes, priority, links, archive) still uses prepare_record. A stale expected_version is refused; never retry with a guessed version, read the record again. The result includes an undo object: to undo, call quick_update again with its record_id, expected_version and fields_json. Only claim saved from saved:true.',
  {
    record_id: { type: "string" },
    expected_version: { type: "integer" },
    fields_json: { type: "string" },
  },
);
export async function quickUpdate(
  store: AppClient,
  ownerId: string,
  args: Record<string, unknown>,
) {
  if (
    Object.keys(args).sort().join() !== "expected_version,fields_json,record_id" ||
    typeof args.record_id !== "string" ||
    !uuid.test(args.record_id) ||
    !Number.isInteger(args.expected_version) ||
    Number(args.expected_version) < 1 ||
    typeof args.fields_json !== "string" ||
    args.fields_json.length > 2000
  )
    throw new Error("Invalid quick update request.");
  const requested = JSON.parse(args.fields_json) as Record<string, unknown>;
  if (
    !requested ||
    typeof requested !== "object" ||
    Object.keys(requested).some((key) => !allowed.includes(key))
  )
    throw new Error(
      "quick_update changes only status, due_date and snoozed_until. Use prepare_record for other edits.",
    );
  const current = await store
    .from("work_items")
    .select(
      "id,kind,title,version,status,due_date,remind_at,snoozed_until,archived",
    )
    .eq("id", args.record_id)
    .eq("user_id", ownerId)
    .maybeSingle();
  if (current.error || !current.data)
    throw new Error("Record unavailable. Read it again.");
  const row = current.data;
  if (!kinds.includes(row.kind) || row.archived)
    throw new Error("Only open Tasks, Reminders and Waiting On items can be quick-updated.");
  if (row.version !== args.expected_version)
    throw new Error(
      `Record changed since version ${args.expected_version} (now ${row.version}). Read it again before updating.`,
    );
  const fields = validateFields(row.kind as Kind, requested) as Record<
    string,
    string | null
  >;
  const patch: Record<string, string | null> = { ...fields };
  if (row.kind === "reminder") {
    const status = fields.status ?? row.status;
    if (status === "Snoozed") {
      const until = "snoozed_until" in fields ? fields.snoozed_until : row.snoozed_until;
      if (!until) throw new Error("A snooze time is required.");
    } else {
      if (fields.snoozed_until)
        throw new Error("Only a Snoozed reminder has a snooze time.");
      patch.snoozed_until = null;
    }
    if (fields.due_date && row.remind_at)
      throw new Error(
        "This reminder is timed; a date-only due_date would conflict. Use prepare_record.",
      );
  } else if ("snoozed_until" in fields)
    throw new Error("Only reminders can be snoozed.");
  const previous = Object.fromEntries(
    Object.keys(patch).map((key) => [
      key,
      (row as Record<string, unknown>)[key] ?? null,
    ]),
  );
  const saved = await store
    .from("work_items")
    .update(patch as Partial<WorkInput>)
    .eq("id", row.id)
    .eq("user_id", ownerId)
    .eq("version", row.version)
    .select("id,version,status,due_date,snoozed_until")
    .maybeSingle();
  if (saved.error || !saved.data)
    throw new Error(
      "The change was not saved or the record changed elsewhere. Read it again before retrying.",
    );
  return {
    saved: true,
    id: row.id,
    kind: row.kind,
    title: row.title,
    changed: patch,
    previous,
    version: saved.data.version,
    record_url: `https://cmd.hillspafl.gov/?record=${row.id}`,
    undo: {
      record_id: row.id,
      expected_version: saved.data.version,
      fields_json: JSON.stringify(previous),
    },
  };
}
