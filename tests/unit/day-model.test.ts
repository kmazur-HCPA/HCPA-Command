import { describe, expect, it } from "vitest";
import { dueMeta, headline, linePct, overdueTag, scheduleLine, weekStrip } from "../../src/features/work/dayModel";

const event = (id: string, start: string, end: string) => ({ id, subject: id, start, end, allDay: false, durationMinutes: 60 });

describe("Work Day model", () => {
  it("writes the headline from calendar and pending counts", () => {
    expect(headline(0, 2, "afternoon")).toEqual({ calendar: "A clear calendar.", focus: "Two things deserve your afternoon." });
    expect(headline(1, 1, "morning")).toEqual({ calendar: "1 meeting today.", focus: "One thing deserves your morning." });
    expect(headline(null, 0, "evening")).toEqual({ calendar: "Here’s your day.", focus: "Nothing is pressing." });
  });
  it("places now on the 8 AM to 5 PM line and clamps outside it", () => {
    expect(linePct(8 * 60)).toBe(0);
    expect(linePct(12 * 60 + 30)).toBe(50);
    expect(linePct(20 * 60)).toBe(100);
  });
  it("words overdue dates with the word Overdue", () => {
    expect(dueMeta("2026-09-25", "2026-10-01")).toEqual({ text: "Overdue · Sep 25", overdue: true });
    expect(dueMeta("2026-10-02", "2026-10-01").text).toBe("Tomorrow · Oct 2");
    expect(overdueTag("2026-09-30", "2026-10-01")).toBe("Overdue · 1 day");
  });
  it("shows the next meeting, or says the week is clear", () => {
    const now = Date.parse("2026-10-01T17:00:00Z");
    expect(scheduleLine([], now)).toBe("No meetings through Friday");
    expect(scheduleLine([event("Budget", "2026-10-02T14:00:00Z", "2026-10-02T15:00:00Z")], now)).toBe("Next: Budget · Fri 10:00 AM");
  });
  it("builds Monday to Friday and marks meeting days", () => {
    const week = weekStrip("2026-10-01", [event("x", "2026-10-02T14:00:00Z", "2026-10-02T15:00:00Z")]);
    expect(week.map((d) => d.num)).toEqual([28, 29, 30, 1, 2]);
    expect(week.filter((d) => d.today).map((d) => d.num)).toEqual([1]);
    expect(week.filter((d) => d.busy).map((d) => d.num)).toEqual([2]);
  });
});
