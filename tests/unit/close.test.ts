import { describe, expect, it } from "vitest";
import { addDays, classify, closeIsOffered, dueDay, rollDate, rollLabel, type CloseItem } from "../../src/features/close/rules";

const today = "2026-10-19"; // Monday
const item = (over: Partial<CloseItem> & { id: string; title: string }): CloseItem => ({
  kind: "task", status: "Next", priority: "Normal", due_date: null, remind_at: null, snoozed_until: null,
  version: 1, updated_at: "2026-10-19T12:00:00Z", completed_at: null, project_id: null, person_id: null, focus_slot: null, ...over,
});
const empty = { open: [] as CloseItem[], done: [] as CloseItem[], tasks: [] as CloseItem[] };

describe("working-day dates", () => {
  it("rolls to the next working day and labels it", () => {
    expect(rollDate("2026-10-19")).toBe("2026-10-20");
    expect(rollDate("2026-10-23")).toBe("2026-10-26");
    expect(rollDate("2026-10-24")).toBe("2026-10-26");
    expect(rollLabel("2026-10-19")).toBe("Tomorrow");
    expect(rollLabel("2026-10-23")).toBe("Monday");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("offers the close from 3:00 PM Eastern on weekdays only", () => {
    expect(closeIsOffered(new Date("2026-10-19T18:59:00Z"))).toBe(false); // 2:59 PM EDT
    expect(closeIsOffered(new Date("2026-10-19T19:00:00Z"))).toBe(true); // 3:00 PM EDT
    expect(closeIsOffered(new Date("2026-10-17T19:00:00Z"))).toBe(false); // Saturday
    expect(closeIsOffered(new Date("2026-11-02T20:00:00Z"))).toBe(true); // 3:00 PM EST
  });
  it("uses the Eastern date of a timed reminder and the snooze date of a snoozed one", () => {
    expect(dueDay({ due_date: null, remind_at: "2026-10-20T02:00:00Z", snoozed_until: null, status: "Active" })).toBe("2026-10-19");
    expect(dueDay({ due_date: null, remind_at: null, snoozed_until: "2026-10-19T13:00:00Z", status: "Snoozed" })).toBe("2026-10-19");
  });
});

describe("classify", () => {
  it("puts today and recent overdue work in Still open, oldest first, and ignores the future and closed items", () => {
    const result = classify({ ...empty, open: [
      item({ id: "a", title: "Due today", due_date: today }),
      item({ id: "b", title: "Three days late", due_date: "2026-10-16" }),
      item({ id: "c", title: "Tomorrow", due_date: "2026-10-20" }),
      item({ id: "d", title: "Finished", due_date: today, status: "Complete" }),
      item({ id: "e", title: "No date" }),
    ] }, today);
    expect(result.open.map((i) => i.id)).toEqual(["b", "a"]);
    expect(result.open[0]!.overdue_days).toBe(3);
    expect(result.stale).toEqual([]);
    expect(result.roll_date).toBe("2026-10-20");
  });
  it("marks work more than 7 days overdue Stale with a deterministic proposal", () => {
    const result = classify({ ...empty, open: [
      item({ id: "datto", title: "Datto email", status: "Inbox", due_date: "2026-09-25" }),
      item({ id: "active", title: "Real work", status: "In Progress", due_date: "2026-10-01" }),
      item({ id: "barracuda", title: "Barracuda renewal", kind: "reminder", status: "Active", due_date: "2026-09-30", updated_at: "2026-09-22T12:00:00Z" }),
      item({ id: "wait", title: "Vendor reply", kind: "waiting", status: "Active", due_date: "2026-10-05" }),
      item({ id: "edge", title: "Exactly seven days", due_date: "2026-10-12" }),
    ] }, today);
    const byId = Object.fromEntries(result.stale.map((i) => [i.id, i.proposal]));
    expect(Object.keys(byId).sort()).toEqual(["active", "barracuda", "datto", "wait"]);
    expect(byId.datto).toMatchObject({ op: "drop", reason: "Never started and 24 days overdue" });
    expect(byId.active).toMatchObject({ op: "date", date: "2026-10-20" });
    expect(byId.barracuda!.op).toBe("drop");
    expect(byId.wait!.op).toBe("review");
    expect(result.open.map((i) => i.id)).toEqual(["edge"]);
    expect(result.stale[0]!.id).toBe("datto");
  });
  it("treats a reminder that is past due and untouched for a week as stale even when only briefly overdue", () => {
    const result = classify({ ...empty, open: [
      item({ id: "old", title: "Ignored reminder", kind: "reminder", status: "Active", due_date: "2026-10-17", updated_at: "2026-10-01T12:00:00Z" }),
      item({ id: "fresh", title: "Recently touched", kind: "reminder", status: "Active", due_date: "2026-10-17", updated_at: "2026-10-18T12:00:00Z" }),
    ] }, today);
    expect(result.stale.map((i) => i.id)).toEqual(["old"]);
    expect(result.open.map((i) => i.id)).toEqual(["fresh"]);
  });
  it("offers open tasks for tomorrow's first item, most important first, and lists what was done", () => {
    const result = classify({
      open: [],
      done: [item({ id: "x", title: "Early", status: "Complete", completed_at: "2026-10-19T13:00:00Z" }), item({ id: "y", title: "Late", status: "Complete", completed_at: "2026-10-19T19:00:00Z" })],
      tasks: [
        item({ id: "n", title: "Normal", priority: "Normal", due_date: "2026-10-21" }),
        item({ id: "h", title: "High", priority: "High", due_date: "2026-10-30" }),
        item({ id: "c", title: "Critical", priority: "Critical" }),
        item({ id: "r", title: "A reminder", kind: "reminder" }),
        item({ id: "z", title: "Closed", status: "Cancelled", priority: "Critical" }),
      ],
    }, today);
    expect(result.first_candidates.map((i) => i.id)).toEqual(["c", "h", "n"]);
    expect(result.done.map((i) => i.id)).toEqual(["y", "x"]);
  });
});
