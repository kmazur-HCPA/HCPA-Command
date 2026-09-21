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
    "Prepare one task for user review; this does not save it.",
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
  "id,title,kind,status,priority,due_date,project_id,person_id,task_id,current_state,next_milestone,goals,body,updated_at" as const;
export async function readTool(
  client: AppClient,
  name: string,
  args: Record<string, unknown>,
  sources: Map<string, CoraSource>,
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
    name === "get_project_details" ? ["offset", "project_id"] : ["offset"];
  if (Object.keys(args).some((key) => !allowed.includes(key)))
    throw new Error("Unsupported tool argument.");
  const query = () =>
    client
      .from("work_items")
      .select(columns, { count: "exact" })
      .eq("archived", false);
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
  if (
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
  const links = ids.length
    ? await client
        .from("work_items")
        .select("id,title,kind,status")
        .in("id", ids)
        .limit(75)
    : { data: [], error: null };
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
