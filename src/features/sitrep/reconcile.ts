import type { SitrepItem } from "./schema";

// Display-only: nothing here changes stored SITREP data.
export type RecordState = { status: string; archived: boolean } | null; // null = gone
export type LiveContext = {
  now: number;
  today: string; // America/New_York business date
  records: Map<string, RecordState>;
  // Message IDs still flagged and not captured/dismissed; null when Outlook is unreachable.
  openFlagged: Set<string> | null;
};
export type Reconciled = {
  item: SitrepItem;
  struck: boolean;
  dimmed: boolean;
  label: string | null; // Done | Handled | Record removed
  marker: SitrepItem["marker"];
  when: string | null; // "in 40 min", "Now", "due in 2h"
  removedRecords: Set<string>;
};
const closed = ["Complete", "Cancelled", "Dismissed"];
const minute = 60000;

export function reconcileItem(item: SitrepItem, ctx: LiveContext): Reconciled {
  const refs = item.refs ?? [];
  const records = refs.filter((r) => r.kind === "record");
  const removedRecords = new Set(
    records.filter((r) => ctx.records.has(r.id) && ctx.records.get(r.id) === null).map((r) => r.id),
  );
  const states = records.map((r) => ctx.records.get(r.id));
  const done = states.length > 0 && states.every((s) => s && (s.archived || closed.includes(s.status)));
  const emails = refs.filter((r) => r.kind === "email");
  const handled =
    ctx.openFlagged !== null && emails.length > 0 && emails.every((r) => !ctx.openFlagged!.has(r.id));
  let label: string | null = null;
  if (done) label = "Done";
  else if (handled) label = "Handled";
  else if (removedRecords.size) label = "Record removed";
  const struck = label === "Done" || label === "Handled";

  const starts = item.starts_at ? Date.parse(item.starts_at) : NaN;
  const ends = item.ends_at ? Date.parse(item.ends_at) : NaN;
  const due = item.due_at ? Date.parse(item.due_at) : NaN;
  const dimmed = !struck && Number.isFinite(ends) && ends <= ctx.now;
  let when: string | null = null;
  if (!struck && !dimmed && Number.isFinite(starts)) {
    if (starts <= ctx.now) when = "Now";
    else if (starts - ctx.now <= 60 * minute) when = `in ${Math.max(1, Math.round((starts - ctx.now) / minute))} min`;
  }
  let marker = item.marker ?? null;
  const pastDue =
    (Number.isFinite(due) && due <= ctx.now) || (!!item.due_date && !item.due_at && item.due_date < ctx.today);
  if (marker === "due_today" && pastDue) marker = "overdue";
  if (!struck && !when && Number.isFinite(due) && due > ctx.now && due - ctx.now <= 240 * minute) {
    const hours = Math.floor((due - ctx.now) / (60 * minute));
    when = hours ? `due in ${hours}h` : `due in ${Math.max(1, Math.round((due - ctx.now) / minute))} min`;
  }
  return { item, struck, dimmed, label, marker, when, removedRecords };
}
// Struck items sink to the bottom of their section; order is otherwise preserved.
export function reconcileSection(items: SitrepItem[], ctx: LiveContext) {
  const all = items.map((i) => reconcileItem(i, ctx));
  return [...all.filter((r) => !r.struck), ...all.filter((r) => r.struck)];
}
export const mostlyDone = (items: Reconciled[]) =>
  items.length > 0 && items.filter((r) => r.struck).length * 2 > items.length;
