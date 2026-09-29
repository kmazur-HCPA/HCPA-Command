import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { quickUpdate } from "../../netlify/functions/_shared/cora/quick";

const owner = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
let row: Record<string, unknown>, patches: Record<string, unknown>[];
const store = () =>
  createClient("https://fixture.supabase.co", "secret-fixture", {
    auth: { persistSession: false },
  }) as never;
const run = (fields: object, version = 3, record = id) =>
  quickUpdate(store(), owner, {
    record_id: record,
    expected_version: version,
    fields_json: JSON.stringify(fields),
  });
beforeEach(() => {
  patches = [];
  row = { id, kind: "task", title: "File report", version: 3, status: "Next", due_date: "2026-10-01", remind_at: null, snoozed_until: null, archived: false };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const r = new Request(input, init), u = new URL(r.url);
      if (!u.pathname.endsWith("/work_items")) throw new Error("Unexpected " + u.pathname);
      const owned = u.searchParams.get("user_id") === "eq." + owner && u.searchParams.get("id") === "eq." + row.id;
      if (r.method === "GET") return owned ? Response.json(row) : Response.json({ message: "none" }, { status: 406 });
      const patch = await r.json();
      if (!owned || u.searchParams.get("version") !== "eq." + row.version)
        return Response.json({ message: "none" }, { status: 406 });
      patches.push(patch);
      row = { ...row, ...patch, version: Number(row.version) + 1 };
      return Response.json(row);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("quick_update", () => {
  it("completes a task and returns a working undo", async () => {
    const done = await run({ status: "Complete" });
    expect(done).toMatchObject({ saved: true, changed: { status: "Complete" }, previous: { status: "Next" }, version: 4 });
    expect(done.undo).toEqual({ record_id: id, expected_version: 4, fields_json: JSON.stringify({ status: "Next" }) });
    const undone = await run(JSON.parse(done.undo.fields_json), done.undo.expected_version);
    expect(undone).toMatchObject({ saved: true, changed: { status: "Next" }, version: 5 });
  });
  it("moves a due date and undoes it", async () => {
    const moved = await run({ due_date: "2026-10-08" });
    expect(moved.previous).toEqual({ due_date: "2026-10-01" });
    expect(row.due_date).toBe("2026-10-08");
  });
  it("snoozes and reactivates a reminder, clearing the snooze on the way out", async () => {
    row = { ...row, kind: "reminder", status: "Active", due_date: null };
    const snoozed = await run({ status: "Snoozed", snoozed_until: "2026-10-02T09:00:00-04:00" });
    expect(snoozed.previous).toEqual({ status: "Active", snoozed_until: null });
    const back = await run(JSON.parse(snoozed.undo.fields_json), 4);
    expect(back.changed).toEqual({ status: "Active", snoozed_until: null });
    await expect(run({ status: "Snoozed" }, 5)).rejects.toThrow(/snooze time/);
    await expect(run({ status: "Active", snoozed_until: "2026-10-02T09:00:00-04:00" }, 5)).rejects.toThrow(/Only a Snoozed/);
  });
  it("refuses a stale version, unknown fields, other kinds and other owners", async () => {
    await expect(run({ status: "Complete" }, 2)).rejects.toThrow(/Record changed/);
    for (const bad of [{ title: "x" }, { priority: "High" }, { archived: true }, { status: "Bogus" }, {}])
      await expect(run(bad)).rejects.toThrow();
    await expect(run({ snoozed_until: "2026-10-02T09:00:00-04:00" })).rejects.toThrow(/snoozed_until/);
    row = { ...row, kind: "project" };
    await expect(run({ status: "Complete" })).rejects.toThrow(/Only open/);
    row = { ...row, kind: "task" };
    await expect(run({ status: "Complete" }, 3, "33333333-3333-4333-8333-333333333333")).rejects.toThrow(/unavailable/);
    expect(patches).toHaveLength(0);
  });
  it("will not add a date-only due date to a timed reminder", async () => {
    row = { ...row, kind: "reminder", status: "Active", due_date: null, remind_at: "2026-10-01T09:00:00-04:00" };
    await expect(run({ due_date: "2026-10-02" })).rejects.toThrow(/timed/);
  });
});
