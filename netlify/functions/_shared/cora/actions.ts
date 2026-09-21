import { fields as detailFields } from "../../../../src/features/lab/fields";
import type { AppClient } from "../../../../src/platform/supabase";
import {
  labels,
  newItem,
  statuses,
  priorities,
  entryTypes,
  type Kind,
  type WorkInput,
} from "../../../../src/features/work/model";
import type { RecordProposal } from "../../../../src/features/cora/model";
import {
  patchWork,
  saveWork,
  convertReminder,
} from "../../../../src/services/work";
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export const kinds = Object.keys(labels) as Kind[];
const links = [
  "project_id",
  "initiative_id",
  "person_id",
  "task_id",
  "source_entry_id",
  "learning_id",
  "program_id",
  "use_case_id",
  "experiment_id",
  "decision_id",
];
const textFields = [
  "title",
  "body",
  "goals",
  "current_state",
  "next_milestone",
  "organization",
  "person_role",
];
export function validateFields(kind: Kind, value: unknown): Partial<WorkInput> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Record fields must be an object.");
  const fields = value as Record<string, unknown>;
  if (!Object.keys(fields).length || JSON.stringify(fields).length > 12000)
    throw new Error("Provide a bounded set of changes.");
  for (const [key, v] of Object.entries(fields)) {
    let valid = false;
    if (textFields.includes(key))
      valid =
        typeof v === "string" &&
        v.length <= (key === "title" ? 200 : 10000) &&
        (key !== "title" || !!v.trim());
    if (links.includes(key))
      valid = v === null || (typeof v === "string" && uuid.test(v));
    if (key === "status")
      valid = typeof v === "string" && statuses(kind).includes(v);
    if (key === "priority")
      valid = priorities.includes(v as (typeof priorities)[number]);
    if (key === "entry_type")
      valid = entryTypes.includes(v as (typeof entryTypes)[number]);
    if (key === "archived") valid = typeof v === "boolean";
    if (key === "focus_slot")
      valid =
        kind === "task" &&
        (v === null ||
          (Number.isInteger(v) && Number(v) >= 1 && Number(v) <= 3));
    if (key === "tags")
      valid =
        Array.isArray(v) &&
        v.length <= 30 &&
        v.every((t) => typeof t === "string" && t.length <= 80);
    if (key === "due_date")
      valid =
        v === null ||
        (typeof v === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(v) &&
          Number.isFinite(Date.parse(v)) &&
          new Date(v).toISOString().slice(0, 10) === v);
    if (key === "remind_at" || key === "snoozed_until")
      valid =
        kind === "reminder" &&
        (v === null ||
          (typeof v === "string" &&
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(
              v,
            ) &&
            Number.isFinite(Date.parse(v))));
    if (key === "details")
      valid =
        !!v &&
        typeof v === "object" &&
        !Array.isArray(v) &&
        Object.entries(v).every(
          ([k, val]) =>
            k.length <= 80 && typeof val === "string" && val.length <= 10000,
        );
    if (key === 'details' && valid) {
      for (const [name,content] of Object.entries(v as Record<string,string>)) {
        const spec = detailFields[kind]?.find(f => f.key === name);
        if (!spec || content && spec.options && !spec.options.includes(content)) valid = false;
      }
    }
    if (!valid) throw new Error(`Invalid or unsupported field: ${key}.`);
  }
  return Object.fromEntries(
    Object.entries(fields).sort(([a], [b]) => a.localeCompare(b)),
  ) as Partial<WorkInput>;
}
export function validateRecordProposal(value: unknown): RecordProposal {
  const p = value as RecordProposal;
  if (
    !p ||
    p.type !== "record" ||
    !kinds.includes(p.kind) ||
    !["create", "update", "convert"].includes(p.operation) ||
    typeof p.title !== "string" ||
    !p.title.trim() ||
    p.title.length > 200 ||
    Object.keys(p).some(
      (k) =>
        ![
          "type",
          "kind",
          "operation",
          "record_id",
          "expected_version",
          "title",
          "fields",
        ].includes(k),
    )
  )
    throw new Error("Invalid record proposal.");
  if (
    p.operation === "create"
      ? p.record_id !== null || p.expected_version !== null
      : typeof p.record_id !== "string" ||
        !uuid.test(p.record_id) ||
        !Number.isInteger(p.expected_version) ||
        Number(p.expected_version) < 1
  )
    throw new Error("A current record and version are required.");
  if (p.operation === "convert") {
    if (p.kind !== "reminder" || !p.fields || Object.keys(p.fields).length)
      throw new Error("Only reminders can be converted.");
  } else {
    const fields = validateFields(p.kind, p.fields);
    if (p.operation === "create" && !fields.title)
      throw new Error("A title is required.");
    p.fields = fields;
  }
  return {
    type: "record",
    kind: p.kind,
    operation: p.operation,
    record_id: p.record_id,
    expected_version: p.expected_version,
    title: p.title,
    fields: p.fields,
  };
}
export async function prepareRecord(
  client: AppClient,
  args: Record<string, unknown>,
  ownerId: string,
): Promise<RecordProposal> {
  if (
    Object.keys(args).some(
      (k) =>
        ![
          "kind",
          "record_id",
          "expected_version",
          "fields_json",
          "operation",
        ].includes(k),
    ) ||
    !kinds.includes(args.kind as Kind) ||
    typeof args.fields_json !== "string" ||
    args.fields_json.length > 12000
  )
    throw new Error("Invalid record action.");
  const kind = args.kind as Kind;
  const fields = JSON.parse(args.fields_json) as Partial<WorkInput>;
  let title = fields?.title ?? "";
  let schedule: {due_date?:string|null;remind_at?:string|null;status?:string;snoozed_until?:string|null} = {};
  if (args.operation !== "create") {
    if (typeof args.record_id !== "string" || !uuid.test(args.record_id))
      throw new Error("Read the target record first.");
    const r = await client
      .from("work_items")
      .select("id,title,kind,version,due_date,remind_at,status,snoozed_until")
      .eq("id", args.record_id)
      .eq("user_id", ownerId)
      .maybeSingle();
    if (
      r.error ||
      !r.data ||
      r.data.kind !== kind ||
      r.data.version !== args.expected_version
    )
      throw new Error(
        "Record changed or unavailable. Read it again before proposing changes.",
      );
    title = r.data.title;
    schedule = r.data;
  }
  schedule = {...schedule,...fields};
  if (schedule.due_date && schedule.remind_at) throw new Error('Use a date-only due_date OR a timed remind_at; clear the other field.');
  if (schedule.status === 'Snoozed' && !schedule.snoozed_until) throw new Error('A snooze time is required.');
  return validateRecordProposal({
    type: "record",
    kind,
    operation: args.operation,
    record_id: args.record_id,
    expected_version: args.expected_version,
    title,
    fields,
  });
}
export async function applyRecord(
  client: AppClient,
  proposal: RecordProposal,
  userId: string,
  stableId: string,
) {
  const p = validateRecordProposal(proposal);
  if (p.operation === "create")
    return (
      await saveWork(client, {
        ...newItem(p.kind, userId),
        ...p.fields,
        id: stableId,
      })
    ).id;
  // The JWT client enforces ownership even if a stored proposal is malformed.
  const r = await client
    .from("work_items")
    .select("id,kind,user_id")
    .eq("id", p.record_id!)
    .eq("user_id", userId)
    .maybeSingle();
  if (r.error || !r.data || r.data.kind !== p.kind)
    throw new Error("Record unavailable.");
  if (p.operation === "convert")
    return await convertReminder(client, {
      id: p.record_id!,
      version: p.expected_version!,
    });
  await patchWork(
    client,
    { id: p.record_id!, version: p.expected_version! },
    p.fields,
  );
  return p.record_id!;
}
