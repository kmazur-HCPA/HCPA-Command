// Close the Day: deterministic rules shared by the browser and the MCP tools.
// Nothing here reads or writes data, and nothing is proposed by a model.
export type CloseCounts = { done: number; rolled: number; dropped: number; converted: number };
export type CloseAction = { id: string; version: number; op: "done" | "date" | "drop"; date?: string };
export type CloseMail = {
  message_id: string;
  conversation_id?: string;
  action: "task" | "reminder" | "waiting" | "dismissed";
  title?: string;
  due?: string | null;
  priority?: string;
  url?: string | null;
};
export type CloseResult = { applied: CloseCounts; counts: CloseCounts; receipt_id: string | null };
export type CloseItem = {
  id: string;
  title: string;
  kind: "task" | "reminder" | "waiting";
  status: string;
  priority: string;
  due_date: string | null;
  remind_at: string | null;
  snoozed_until: string | null;
  version: number;
  updated_at: string;
  completed_at: string | null;
  project_id: string | null;
  person_id: string | null;
  focus_slot: number | null;
};
export type Proposal = {
  op: "drop" | "date" | "review";
  date?: string;
  reason: string;
};
export type StaleItem = CloseItem & { overdue_days: number; proposal: Proposal };
export type OpenItem = CloseItem & { overdue_days: number };
export type DayClose = {
  for_date: string;
  roll_date: string;
  done: CloseItem[];
  open: OpenItem[];
  stale: StaleItem[];
  first_candidates: CloseItem[];
};
export const closedStatuses = ["Complete", "Cancelled", "Dismissed"];
export const staleAfterDays = 7;
// Close the Day is offered from 3:00 PM Eastern on weekdays.
export const closeHour = 15;

const zone = "America/New_York";
export const etDate = (value: number | string | Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
export const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000);
const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
export const isWeekday = (date: string) => ![0, 6].includes(weekday(date));
// "Tomorrow" is the next working day, so a Friday close rolls to Monday.
export function rollDate(date: string) {
  let next = addDays(date, 1);
  while (!isWeekday(next)) next = addDays(next, 1);
  return next;
}
export const rollLabel = (date: string) =>
  daysBetween(date, rollDate(date)) === 1 ? "Tomorrow" : new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long" }).format(new Date(`${rollDate(date)}T12:00:00Z`));
// True once Close the Day is offered: a weekday at or after closeHour Eastern.
export function closeIsOffered(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", hourCycle: "h23" }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")!.value);
  return isWeekday(etDate(now)) && hour >= closeHour;
}

// The day an open item is due: its date, or the Eastern date of a timed reminder.
export function dueDay(item: Pick<CloseItem, "due_date" | "remind_at" | "snoozed_until" | "status">) {
  if (item.status === "Snoozed" && item.snoozed_until) return etDate(item.snoozed_until);
  return item.due_date ?? (item.remind_at ? etDate(item.remind_at) : null);
}

function propose(item: CloseItem, overdue: number, today: string): Proposal {
  const roll = rollDate(today);
  if (item.kind === "reminder")
    return { op: "drop", reason: `Past due ${overdue} days with no activity` };
  if (item.kind === "waiting")
    return { op: "review", reason: `${overdue} days past its follow-up date: chase it or close it` };
  if (["Inbox", "Someday"].includes(item.status))
    return { op: "drop", reason: `${item.status === "Inbox" ? "Never started" : "Parked"} and ${overdue} days overdue` };
  return { op: "date", date: roll, reason: `${overdue} days overdue and still active: set a new date` };
}
const rank: Record<string, number> = { Critical: 0, High: 1, Normal: 2, Low: 3 };

// Splits live rows into the sections of the close. Rows must already exclude archived records.
export function classify(
  rows: { open: CloseItem[]; done: CloseItem[]; tasks: CloseItem[] },
  today: string,
): DayClose {
  const open: OpenItem[] = [];
  const stale: StaleItem[] = [];
  for (const item of rows.open) {
    if (closedStatuses.includes(item.status)) continue;
    const due = dueDay(item);
    if (!due || due > today) continue;
    const overdue = daysBetween(due, today);
    const idle = daysBetween(etDate(item.updated_at), today);
    const isStale =
      overdue > staleAfterDays ||
      (item.kind === "reminder" && overdue >= 1 && idle > staleAfterDays);
    if (isStale) stale.push({ ...item, overdue_days: overdue, proposal: propose(item, overdue, today) });
    else open.push({ ...item, overdue_days: overdue });
  }
  const order = (a: OpenItem, b: OpenItem) =>
    b.overdue_days - a.overdue_days || (rank[a.priority] ?? 2) - (rank[b.priority] ?? 2) || a.title.localeCompare(b.title);
  open.sort(order);
  stale.sort((a, b) => b.overdue_days - a.overdue_days || a.title.localeCompare(b.title));
  const candidates = rows.tasks
    .filter((t) => t.kind === "task" && !closedStatuses.includes(t.status))
    .sort(
      (a, b) =>
        (rank[a.priority] ?? 2) - (rank[b.priority] ?? 2) ||
        (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") ||
        a.title.localeCompare(b.title),
    )
    .slice(0, 12);
  return {
    for_date: today,
    roll_date: rollDate(today),
    done: [...rows.done].sort((a, b) => Date.parse(b.completed_at ?? "") - Date.parse(a.completed_at ?? "")),
    open,
    stale,
    first_candidates: candidates,
  };
}
export const emptyCounts = (): CloseCounts => ({ done: 0, rolled: 0, dropped: 0, converted: 0 });
