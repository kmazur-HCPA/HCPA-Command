import { describe, expect, it } from "vitest";
import { mostlyDone, reconcileItem, reconcileSection, type LiveContext } from "../../src/features/sitrep/reconcile";

const now = Date.parse("2026-10-01T14:00:00-04:00");
const rec = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ctx = (over: Partial<LiveContext> = {}): LiveContext => ({ now, today: "2026-10-01", records: new Map(), openFlagged: null, ...over });
const at = (m: number) => new Date(now + m * 60000).toISOString();

describe("SITREP reconciliation", () => {
  it("strikes completed, dismissed and archived records and sinks them", () => {
    const items = [{ text: "A", refs: [{ kind: "record" as const, id: rec }] }, { text: "B" }];
    const done = reconcileSection(items, ctx({ records: new Map([[rec, { status: "Complete", archived: false }]]) }));
    expect(done.map((r) => [r.item.text, r.struck, r.label])).toEqual([["B", false, null], ["A", true, "Done"]]);
    for (const s of [{ status: "Dismissed", archived: false }, { status: "Next", archived: true }])
      expect(reconcileItem(items[0]!, ctx({ records: new Map([[rec, s]]) })).label).toBe("Done");
    expect(reconcileItem(items[0]!, ctx({ records: new Map([[rec, { status: "Next", archived: false }]]) })).struck).toBe(false);
  });
  it("labels a missing record and drops its link", () => {
    const r = reconcileItem({ text: "A", refs: [{ kind: "record", id: rec }] }, ctx({ records: new Map([[rec, null]]) }));
    expect(r).toMatchObject({ label: "Record removed", struck: false });
    expect([...r.removedRecords]).toEqual([rec]);
    // A record the lookup never covered (lookup failed) is left alone.
    expect(reconcileItem({ text: "A", refs: [{ kind: "record", id: rec }] }, ctx()).label).toBeNull();
  });
  it("marks email handled only when Outlook was reachable and the flag is gone", () => {
    const it = { text: "Reply", refs: [{ kind: "email" as const, id: "m1" }] };
    expect(reconcileItem(it, ctx({ openFlagged: new Set(["m1"]) })).label).toBeNull();
    expect(reconcileItem(it, ctx({ openFlagged: new Set() })).label).toBe("Handled");
    expect(reconcileItem(it, ctx({ openFlagged: null })).label).toBeNull();
  });
  it("shows countdown, Now, and dims past events", () => {
    expect(reconcileItem({ text: "M", starts_at: at(40), ends_at: at(100) }, ctx()).when).toBe("in 40 min");
    expect(reconcileItem({ text: "M", starts_at: at(90) }, ctx()).when).toBeNull();
    expect(reconcileItem({ text: "M", starts_at: at(-5), ends_at: at(30) }, ctx()).when).toBe("Now");
    expect(reconcileItem({ text: "M", starts_at: at(-60), ends_at: at(-5) }, ctx())).toMatchObject({ dimmed: true, when: null });
  });
  it("escalates due_today to overdue and shows due in hours", () => {
    expect(reconcileItem({ text: "T", marker: "due_today", due_at: at(-1) }, ctx()).marker).toBe("overdue");
    expect(reconcileItem({ text: "T", marker: "due_today", due_date: "2026-09-30" }, ctx()).marker).toBe("overdue");
    expect(reconcileItem({ text: "T", marker: "due_today", due_date: "2026-10-01" }, ctx()).marker).toBe("due_today");
    expect(reconcileItem({ text: "T", marker: "conflict", due_at: at(-1) }, ctx()).marker).toBe("conflict");
    expect(reconcileItem({ text: "T", due_at: at(130) }, ctx()).when).toBe("due in 2h");
    expect(reconcileItem({ text: "T", due_at: at(300) }, ctx()).when).toBeNull();
  });
  it("flags a mostly-done list only past half", () => {
    const row = (done: boolean) => ({ text: "x", refs: [{ kind: "record" as const, id: done ? rec : "other" }] });
    const records = new Map([[rec, { status: "Complete", archived: false }], ["other", { status: "Next", archived: false }]]);
    expect(mostlyDone(reconcileSection([row(true), row(false)], ctx({ records })))).toBe(false);
    expect(mostlyDone(reconcileSection([row(true), row(true), row(false)], ctx({ records })))).toBe(true);
    expect(mostlyDone([])).toBe(false);
  });
});
