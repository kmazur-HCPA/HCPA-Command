import { fromLocalDateTime } from "../work/dates";
export type CalendarEvent = {
  id: string;
  subject: string;
  start: string;
  end: string;
  allDay: boolean;
  durationMinutes: number;
};
export type CalendarAgenda = {
  events: CalendarEvent[];
  truncated: boolean;
  retrievedAt: string;
};
export function agendaRange(date: string, days = 1) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || ![1, 5, 7].includes(days))
    throw new Error("Choose a valid calendar date and range.");
  const instant = new Date(`${date}T12:00:00Z`);
  if (
    !Number.isFinite(instant.getTime()) ||
    instant.toISOString().slice(0, 10) !== date
  )
    throw new Error("Choose a valid calendar date.");
  instant.setUTCDate(instant.getUTCDate() + days);
  return {
    start: fromLocalDateTime(`${date}T00:00`),
    end: fromLocalDateTime(`${instant.toISOString().slice(0, 10)}T00:00`),
  };
}
export function workWeekRange(date: string) {
  agendaRange(date); // Validate before doing calendar arithmetic.
  const monday = new Date(`${date}T12:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  return agendaRange(monday.toISOString().slice(0, 10), 5);
}
export function calendarInstant(value: unknown): string {
  if (!value || typeof value !== "object")
    throw new Error("Invalid calendar time.");
  const { dateTime, timeZone } = value as Record<string, unknown>;
  if (typeof dateTime !== "string" || timeZone !== "UTC")
    throw new Error("Invalid calendar timezone.");
  const iso =
    dateTime.replace(/(\.\d{3})\d+/, "$1") +
    (/Z$|[+-]\d\d:\d\d$/.test(dateTime) ? "" : "Z");
  if (!Number.isFinite(Date.parse(iso)))
    throw new Error("Invalid calendar time.");
  return new Date(iso).toISOString();
}
export function eventDuration(minutes: number) {
  const hours = Math.floor(minutes / 60),
    rest = minutes % 60;
  return hours ? `${hours}h${rest ? ` ${rest}m` : ""}` : `${rest} min`;
}

// Keep meetings in progress and all-day events until their exclusive end time.
export function upcomingEvents(events: CalendarEvent[], now: number) {
  return events.filter(event => Date.parse(event.end) > now);
}
