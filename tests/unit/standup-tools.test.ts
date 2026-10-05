import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { standupTool } from "../../netlify/functions/_shared/cora/standup";
import { directRecordInput } from "../../netlify/functions/_shared/cora/create";

const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const itemId = "33333333-3333-4333-8333-333333333333";
let rows: Record<string, unknown>[];
const store = () =>
  createClient("https://fixture.supabase.co", "secret-fixture", {
    auth: { persistSession: false },
  }) as never;
const call = (name: string, args: Record<string, unknown>) =>
  standupTool(store(), owner, name, args);

beforeEach(() => {
  rows = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const r = new Request(input, init),
        u = new URL(r.url);
      if (!u.pathname.endsWith("/standup_items")) throw new Error("Unexpected " + u.pathname);
      const mine = (row: Record<string, unknown>) =>
        u.searchParams.get("user_id") === "eq." + owner && row.user_id === owner &&
        (!u.searchParams.get("id") || u.searchParams.get("id") === "eq." + row.id);
      const wantsObject = r.headers.get("accept")?.includes("vnd.pgrst.object");
      const reply = (list: Record<string, unknown>[]) =>
        wantsObject
          ? list.length ? Response.json(list[0]) : Response.json({ message: "none" }, { status: 406 })
          : Response.json(list);
      if (r.method === "GET") return reply(rows.filter(mine));
      if (r.method === "POST") {
        const body = await r.json();
        if (rows.some((x) => x.id === body.id)) return reply([]);
        rows.push({ done: false, created_at: "2026-10-05T12:00:00Z", ...body });
        return reply([rows.at(-1)!]);
      }
      const hit = rows.filter(mine);
      if (r.method === "PATCH") {
        const patch = await r.json();
        hit.forEach((x) => Object.assign(x, patch));
      }
      if (r.method === "DELETE") rows = rows.filter((x) => !hit.includes(x));
      return reply(hit);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("stand-up tools", () => {
  it("adds, reads, edits, completes and removes an item", async () => {
    const added = await call("add_standup_item", { request_id: itemId, body: " Budget question ", carried_from: null });
    expect(added).toMatchObject({ saved: true, item: { body: "Budget question", done: false } });
    const week = (await call("get_standup_items", { scope: "current" })) as { items: { id: string }[] };
    expect(week.items.map((i) => i.id)).toEqual([itemId]);
    expect((await call("update_standup_item", { id: itemId, body: null, done: true })) as { item: { done: boolean } }).toMatchObject({ item: { done: true } });
    expect(await call("remove_standup_item", { id: itemId })).toEqual({ removed: true, id: itemId });
    expect(rows).toHaveLength(0);
  });
  it("a retried add with the same request_id does not duplicate, and a changed body is refused", async () => {
    const args = { request_id: itemId, body: "Same", carried_from: null };
    await call("add_standup_item", args);
    await expect(call("add_standup_item", args)).resolves.toMatchObject({ saved: true });
    expect(rows).toHaveLength(1);
    await expect(call("add_standup_item", { ...args, body: "Different" })).rejects.toThrow(/new request_id/);
  });
  it("rejects invalid input and other owners' items", async () => {
    await expect(call("add_standup_item", { request_id: itemId, body: "x".repeat(301), carried_from: null })).rejects.toThrow(/300/);
    await expect(call("add_standup_item", { request_id: "bad", body: "ok", carried_from: null })).rejects.toThrow();
    await expect(call("update_standup_item", { id: itemId, body: null, done: null })).rejects.toThrow(/Nothing/);
    rows.push({ id: itemId, user_id: other, body: "Theirs", done: false, week_start: "2026-10-06" });
    await expect(call("remove_standup_item", { id: itemId })).rejects.toThrow(/unavailable/);
    expect(rows).toHaveLength(1);
  });
});

describe("direct creation of Waiting On and Learning", () => {
  it("builds owner-scoped records with the right default status", () => {
    const waiting = directRecordInput(owner, { kind: "waiting", request_id: owner, fields_json: JSON.stringify({ title: "Quote from vendor", organization: "Acme", due_date: "2026-10-12" }) });
    expect(waiting).toMatchObject({ kind: "waiting", user_id: owner, status: "Active", organization: "Acme" });
    const learning = directRecordInput(owner, { kind: "learning", request_id: owner, fields_json: JSON.stringify({ title: "Spatial stats course" }) });
    expect(learning).toMatchObject({ kind: "learning", status: "Saved" });
  });
});
