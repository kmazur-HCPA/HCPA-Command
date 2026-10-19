import type { AppClient } from "../platform/supabase";
import { measured } from "../platform/telemetry";
import { fromLocalDateTime } from "../features/work/dates";
import {
  addDays,
  classify,
  closedStatuses,
  type CloseAction,
  type CloseCounts,
  type CloseItem,
  type CloseMail,
  type CloseResult,
  type DayClose,
} from "../features/close/rules";

const columns =
  "id,title,kind,status,priority,due_date,remind_at,snoozed_until,version,updated_at,completed_at,project_id,person_id,focus_slot" as const;
const kinds = ["task", "reminder", "waiting"] as const;

// Works with the browser session (row-level security) or the server's owner-scoped store.
export async function loadDayClose(client: AppClient, userId: string, date: string): Promise<DayClose> {
  return measured("work.read", async () => {
    const start = fromLocalDateTime(`${date}T00:00`),
      end = fromLocalDateTime(`${addDays(date, 1)}T00:00`),
      // Quoted values: ISO timestamps contain PostgREST filter delimiters.
      endOfDay = `"${new Date(Date.parse(end) - 1000).toISOString()}"`,
      closed = `(${closedStatuses.join(",")})`;
    const base = () =>
      client.from("work_items").select(columns).eq("user_id", userId).eq("archived", false);
    const open = () => base().not("status", "in", closed);
    const [due, active, snoozed, done, tasks] = await Promise.all([
      open().in("kind", ["task", "waiting"]).lte("due_date", date).limit(300),
      open()
        .eq("kind", "reminder")
        .eq("status", "Active")
        .or(`due_date.lte.${date},remind_at.lte.${endOfDay}`)
        .limit(300),
      open().eq("kind", "reminder").eq("status", "Snoozed").lte("snoozed_until", endOfDay.replaceAll('"', "")).limit(300),
      base().in("kind", kinds).eq("status", "Complete").gte("completed_at", start).lt("completed_at", end).limit(200),
      base().eq("kind", "task").not("status", "in", closed).order("due_date", { nullsFirst: false }).limit(200),
    ]);
    if ([due, active, snoozed, done, tasks].some((r) => r.error))
      throw new Error("Close the Day could not be loaded. Reconnect and retry.");
    const rows = [...due.data!, ...active.data!, ...snoozed.data!];
    return classify(
      { open: rows as CloseItem[], done: done.data as CloseItem[], tasks: tasks.data as CloseItem[] },
      date,
    );
  });
}

export async function applyDayClose(
  client: AppClient,
  userId: string,
  date: string,
  options: {
    actions?: CloseAction[];
    mail?: CloseMail[];
    first?: string | null;
    finish?: boolean;
    counts?: Partial<CloseCounts>;
    source?: "web" | "chat";
  },
): Promise<CloseResult> {
  return measured("work.write", async () => {
    const { data, error } = await client.rpc("apply_day_close", {
      p_user: userId,
      p_for_date: date,
      p_actions: options.actions ?? [],
      p_first: options.first ?? null,
      p_finish: options.finish ?? false,
      p_source: options.source ?? "web",
      p_mail: options.mail ?? [],
      p_counts: options.counts ?? {},
    });
    if (error) {
      if (/changed since it was read|already closed/i.test(error.message))
        throw new Error("Something changed since you opened Close the Day. Reload it and try again.");
      throw new Error("Close the Day was not saved. Nothing was half applied; retry.");
    }
    return data;
  });
}
