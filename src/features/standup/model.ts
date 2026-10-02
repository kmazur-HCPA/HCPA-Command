// Stand-up weeks run Tuesday through the following Monday. The week is blank on Tuesday
// because the app only shows rows whose week_start is the current Tuesday.
const dayMs = 86400000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const noon = (date: string) => Date.parse(`${date}T12:00:00Z`);

/** Most recent Tuesday on or before `date` (a YYYY-MM-DD New York date). */
export function weekStart(date: string) {
  const day = new Date(noon(date)).getUTCDay(); // Sunday = 0
  return iso(noon(date) - ((day + 5) % 7) * dayMs);
}
/** The Monday that ends the week: when the stand-up happens. */
export const standupMonday = (start: string) => iso(noon(start) + 6 * dayMs);
export const addDays = (date: string, days: number) => iso(noon(date) + days * dayMs);

const fmt = (date: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...opts }).format(new Date(noon(date)));
export const mondayLabel = (start: string) => fmt(standupMonday(start), { weekday: "short", month: "short", day: "numeric" });
export const weekRangeLabel = (start: string) =>
  `${fmt(start, { month: "short", day: "numeric" })} – ${fmt(standupMonday(start), { month: "short", day: "numeric" })}`;
