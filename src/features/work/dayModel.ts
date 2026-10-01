import type { CalendarEvent } from "../microsoft/calendar";

// Display-only helpers for Work Day. Nothing here reads or writes stored data.
const zone = "America/New_York";
const dayStart = 8 * 60,
  dayEnd = 17 * 60;

export function etParts(value: number | string | Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}
export const partOfDay = (minutes: number) =>
  minutes < 12 * 60 ? "morning" : minutes < 17 * 60 ? "afternoon" : "evening";

// Position on the 8 AM–5 PM line, 0–100.
export function linePct(minutes: number) {
  return Math.max(0, Math.min(100, ((minutes - dayStart) / (dayEnd - dayStart)) * 100));
}

const number = ["No", "One", "Two", "Three", "Four"];
export function headline(meetingsToday: number | null, pending: number, part: string) {
  const calendar =
    meetingsToday === null
      ? "Here’s your day."
      : meetingsToday === 0
        ? "A clear calendar."
        : `${meetingsToday} meeting${meetingsToday === 1 ? "" : "s"} today.`;
  const focus =
    pending === 0
      ? "Nothing is pressing."
      : `${number[pending] ?? pending} thing${pending === 1 ? "" : "s"} deserve${pending === 1 ? "s" : ""} your ${part}.`;
  return { calendar, focus };
}

export type Mark = { id: string; pct: number; label: string };
export function meetingMarks(events: CalendarEvent[], date: string): Mark[] {
  return events
    .filter((e) => !e.allDay && etParts(e.start).date === date)
    .map((e) => ({ id: e.id, pct: linePct(etParts(e.start).minutes), label: `${e.subject}, ${clock(e.start)}` }));
}
export const clock = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));

// "No meetings through Friday", or the next meeting.
export function scheduleLine(events: CalendarEvent[], now: number) {
  const next = events
    .filter((e) => !e.allDay && Date.parse(e.end) > now)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0];
  if (!next) return "No meetings through Friday";
  const today = etParts(now).date === etParts(next.start).date;
  const day = today
    ? ""
    : new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short" }).format(new Date(next.start)) + " ";
  return `Next: ${next.subject} · ${day}${clock(next.start)}`;
}

export function weekStrip(date: string, events: CalendarEvent[]) {
  const base = new Date(`${date}T12:00:00Z`);
  const offset = (base.getUTCDay() + 6) % 7; // Monday = 0
  const monday = new Date(base);
  monday.setUTCDate(base.getUTCDate() - offset);
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    return {
      iso,
      label: new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" }).format(d).toUpperCase(),
      num: d.getUTCDate(),
      today: iso === date,
      busy: events.some((e) => !e.allDay && etParts(e.start).date === iso),
    };
  });
}

const short = (date: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(new Date(`${date}T12:00:00Z`));
export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000);
}
export function dueMeta(dueDate: string | null, today: string) {
  if (!dueDate) return { text: "No date", overdue: false };
  const diff = daysBetween(today, dueDate);
  if (diff < 0) return { text: `Overdue · ${short(dueDate)}`, overdue: true };
  if (diff === 0) return { text: "Due today", overdue: false };
  if (diff === 1) return { text: `Tomorrow · ${short(dueDate)}`, overdue: false };
  return { text: short(dueDate), overdue: false };
}
export function taskMeta(t: { due_date: string | null; priority: string; status: string }, today: string) {
  const due = dueMeta(t.due_date, today);
  const parts = [due.text];
  if (t.priority === "High" || t.priority === "Critical") parts.unshift(t.priority);
  if (!due.overdue || t.status !== "Next") parts.push(t.status);
  return { text: parts.join(" · "), overdue: due.overdue };
}
export function overdueTag(dueDate: string, today: string) {
  const n = daysBetween(dueDate, today);
  return n > 0 ? `Overdue · ${n} day${n === 1 ? "" : "s"}` : "Due today";
}
