import { fields as detailFields } from "../../../../src/features/lab/fields";
import { kinds } from "./actions";
import type OpenAI from "openai";
import type { AppClient } from "../../../../src/platform/supabase";
import type {
  CoraSource,
  TaskProposal,
} from "../../../../src/features/cora/model";
import { priorities } from "../../../../src/features/work/model";
export const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function today(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
function definition(
  name: string,
  description: string,
  properties: Record<string, unknown> = {},
): OpenAI.Chat.Completions.ChatCompletionTool {
  return {
    type: "function",
    function: {
      name,
      description,
      strict: true,
      parameters: {
        type: "object",
        properties,
        required: Object.keys(properties),
        additionalProperties: false,
      },
    },
  };
}
const page = {
  offset: {
    type: "integer",
    description: "Zero-based page offset, in multiples of 25. Use 0 initially.",
  },
};
export const tools = [
  definition(
    "get_records",
    "Search or list any Command record type, including reminders. Returns versions for editing. Null kind searches all types; search uses indexed full text. Set archived=true to find archived records.",
    {
      kind: { type: ["string", "null"], enum: [...kinds, null] },
      search: { type: ["string", "null"] },
      archived: { type: "boolean" },
      ...page,
    },
  ),
  definition(
    "get_record",
    "Read one owned Command record and its current version before editing.",
    { record_id: { type: "string" }, ...page },
  ),
  definition(
    "prepare_record",
    'Prepare a reviewed update/convert action or a creation not supported by direct tools. For new Tasks, People, Projects, Initiatives, Journal and AI Lab records use create_record; for new reminders use create_reminder. No write occurs until confirmed. Update only requested fields. For convert, kind=reminder and fields_json="{}". For create use null record_id and expected_version. Read current record before update. fields_json is a JSON object with editable fields: title, body, status, priority, due_date (YYYY-MM-DD or null), remind_at and snoozed_until (ISO timestamp WITH timezone or null), archived, focus_slot (task 1-3 or null), tags (string array), entry_type, goals, current_state, next_milestone, organization, person_role, details (string-valued object), project_id, initiative_id, person_id, task_id, source_entry_id, learning_id, program_id, use_case_id, experiment_id, decision_id (UUID or null). For reminder snooze set status=Snoozed and snoozed_until; dismiss=Dismissed, complete=Complete. Tomorrow without a time means due_date only; do not invent a time. Preserve all existing details when editing details. Detail field definitions: ' +
      JSON.stringify(detailFields),
    {
      operation: { type: "string", enum: ["create", "update", "convert"] },
      kind: { type: "string", enum: kinds },
      record_id: { type: ["string", "null"] },
      expected_version: { type: ["integer", "null"] },
      fields_json: { type: "string" },
    },
  ),
  definition(
    "get_my_tasks",
    "Read open, unarchived tasks, earliest due first; includes exact total.",
    page,
  ),
  definition(
    "get_tasks_due_today",
    "Read due today and overdue open tasks, ordered by due date.",
    page,
  ),
  definition(
    "get_priority_tasks",
    "Read open critical and high-priority tasks, including those without due dates.",
    page,
  ),
  definition(
    "get_active_projects",
    "Read active/on-hold projects and their recorded current state.",
    page,
  ),
  definition(
    "get_project_details",
    "Read a project and its related open tasks and waiting records.",
    { project_id: { type: "string" }, ...page },
  ),
  definition(
    "get_waiting_on",
    "Read active private dependencies on others, including linked people and tasks.",
    page,
  ),
  definition(
    "prepare_task",
    "Legacy reviewed task proposal. For new requested tasks use create_record instead, which saves immediately.",
    {
      title: { type: "string" },
      due_date: {
        type: ["string", "null"],
        description: "YYYY-MM-DD, or null when not requested.",
      },
      priority: { type: "string", enum: [...priorities] },
      project_id: { type: ["string", "null"] },
    },
  ),
];
export function validateProposal(value: unknown): TaskProposal {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid task proposal.");
  const p = value as Record<string, unknown>;
  if (
    Object.keys(p).sort().join() !== "due_date,priority,project_id,title" ||
    typeof p.title !== "string" ||
    !p.title.trim() ||
    p.title.length > 200 ||
    !priorities.includes(p.priority as TaskProposal["priority"]) ||
    !(
      p.project_id === null ||
      (typeof p.project_id === "string" && uuid.test(p.project_id))
    )
  )
    throw new Error("Invalid task proposal.");
  if (
    p.due_date !== null &&
    (typeof p.due_date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(p.due_date) ||
      !Number.isFinite(Date.parse(p.due_date)) ||
      new Date(p.due_date).toISOString().slice(0, 10) !== p.due_date)
  )
    throw new Error("Invalid due date.");
  return {
    title: p.title.trim(),
    due_date: p.due_date as string | null,
    priority: p.priority as TaskProposal["priority"],
    project_id: p.project_id as string | null,
  };
}
const columns =
  "id,title,kind,status,priority,due_date,remind_at,snoozed_until,version,archived,details,tags,entry_type,focus_slot,initiative_id,learning_id,program_id,use_case_id,experiment_id,decision_id,source_entry_id,organization,person_role,project_id,person_id,task_id,current_state,next_milestone,goals,body,updated_at" as const;
export async function readTool(
  client: AppClient,
  name: string,
  args: Record<string, unknown>,
  sources: Map<string, CoraSource>,
  ownerId?: string,
) {
  const offset = args.offset;
  if (
    !Number.isInteger(offset) ||
    Number(offset) < 0 ||
    Number(offset) > 500 ||
    Number(offset) % 25 !== 0
  )
    throw new Error("Invalid result page. Narrow the question.");
  const allowed =
    name === "get_records"
      ? ["offset", "kind", "search", "archived"]
      : name === "get_record"
        ? ["offset", "record_id"]
        : name === "get_project_details"
          ? ["offset", "project_id"]
          : ["offset"];
  if (Object.keys(args).some((key) => !allowed.includes(key)))
    throw new Error("Unsupported tool argument.");
  const query = () => {
    const q = client
      .from("work_items")
      .select(columns, { count: "exact" })
      .eq("archived", name === "get_records" ? args.archived === true : false);
    return ownerId ? q.eq("user_id", ownerId) : q;
  };
  const add = (rows: { id: string; title: string; kind: string }[]) =>
    rows.forEach((row) =>
      sources.set(row.id, { id: row.id, title: row.title, kind: row.kind }),
    );
  const summarize = (rows: Record<string, unknown>[]) =>
    rows.map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => [
          key,
          typeof value === "string" && value.length > 1500
            ? value.slice(0, 1500) + " [truncated]"
            : value,
        ]),
      ),
    );
  if (name === "get_record") {
    if (typeof args.record_id !== "string" || !uuid.test(args.record_id))
      throw new Error("Invalid record reference.");
    let q = client.from("work_items").select("*").eq("id", args.record_id);
    if (ownerId) q = q.eq("user_id", ownerId);
    const r = await q.maybeSingle();
    if (r.error || !r.data) throw new Error("Record unavailable.");
    add([r.data]);
    const { search_vector, ...record } = r.data;
    void search_vector;
    return { record };
  }
  if (name === "get_project_details") {
    if (typeof args.project_id !== "string" || !uuid.test(args.project_id))
      throw new Error("Invalid project reference.");
    const project = await query()
      .eq("id", args.project_id)
      .eq("kind", "project")
      .maybeSingle();
    if (project.error || !project.data) throw new Error("Project unavailable.");
    const related = await query()
      .eq("project_id", args.project_id)
      .in("kind", ["task", "waiting"])
      .not("status", "in", "(Complete,Cancelled)")
      .order("due_date", { nullsFirst: false })
      .order("id")
      .range(Number(offset), Number(offset) + 24);
    if (related.error) throw new Error("Related work unavailable.");
    add([project.data, ...related.data]);
    return {
      project: summarize([project.data])[0],
      related: summarize(related.data),
      total: related.count,
      offset,
      has_more: Number(offset) + related.data.length < (related.count ?? 0),
    };
  }
  let q = query();
  if (name === "get_records") {
    if (
      !(
        args.kind === null ||
        kinds.includes(args.kind as (typeof kinds)[number])
      ) ||
      !(
        args.search === null ||
        (typeof args.search === "string" && args.search.length <= 200)
      ) ||
      typeof args.archived !== "boolean"
    )
      throw new Error("Invalid search.");
    if (args.kind) q = q.eq("kind", args.kind as (typeof kinds)[number]);
    if (args.search)
      q = q.textSearch("search_vector", args.search as string, {
        type: "websearch",
        config: "english",
      });
  } else if (
    name === "get_my_tasks" ||
    name === "get_tasks_due_today" ||
    name === "get_priority_tasks"
  ) {
    q = q.eq("kind", "task").not("status", "in", "(Complete,Cancelled)");
    if (name === "get_tasks_due_today") q = q.lte("due_date", today());
    if (name === "get_priority_tasks")
      q = q.in("priority", ["Critical", "High"]);
  } else if (name === "get_active_projects")
    q = q.eq("kind", "project").in("status", ["Active", "On Hold"]);
  else if (name === "get_waiting_on")
    q = q.eq("kind", "waiting").eq("status", "Active");
  else throw new Error("Tool not available.");
  const result = await q
    .order("due_date", { nullsFirst: false })
    .order("updated_at", { ascending: false })
    .order("id")
    .range(Number(offset), Number(offset) + 24);
  if (result.error) throw new Error("Command data could not be loaded.");
  add(result.data);
  const ids = [
    ...new Set(
      result.data
        .flatMap((row) => [row.person_id, row.project_id, row.task_id])
        .filter((id): id is string => !!id),
    ),
  ];
  let linked = client
    .from("work_items")
    .select("id,title,kind,status")
    .in("id", ids)
    .limit(75);
  if (ownerId) linked = linked.eq("user_id", ownerId);
  const links = ids.length ? await linked : { data: [], error: null };
  if (links.error) throw new Error("Related context could not be loaded.");
  add(links.data ?? []);
  return {
    records: summarize(result.data),
    total: result.count,
    offset,
    has_more: Number(offset) + result.data.length < (result.count ?? 0),
    related: links.data,
  };
}
