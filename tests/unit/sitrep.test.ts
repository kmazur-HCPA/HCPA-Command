import { describe, expect, it } from "vitest";
import { parsePayload, plainText } from "../../src/features/sitrep/schema";
import { saveSitrep, getSitrepRuns } from "../../netlify/functions/_shared/sitrep";
import type { AppClient } from "../../src/platform/supabase";

const owner = "11111111-1111-4111-8111-111111111111";
const record = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const run = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const empty = { schema_version: 1, now: "Quiet morning.", next: [], prep: [], owed_by_me: [], owed_to_me: [], coming_up: [], watch: [] };
const start = { run_id: run, status: "running", run_slot: "am", for_date: "2026-10-01", sources: null, payload_json: null, error_note: null };
const finish = (payload: unknown, extra: Record<string, unknown> = {}) => ({
  ...start, status: "complete", run_slot: null, for_date: null,
  sources: { command: "ok" }, payload_json: JSON.stringify(payload), ...extra,
});

// Minimal in-memory stand-in for the Supabase query builder used by saveSitrep.
function fakeStore(opts: { paused?: boolean; records?: string[] } = {}) {
  const runs: Record<string, unknown>[] = [];
  const store = {
    from(table: string) {
      const filters: [string, unknown][] = [];
      let mode = "select", patch: Record<string, unknown> = {}, list: string[] | null = null;
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (k: string, v: unknown) => (filters.push([k, v]), q),
        in: (_: string, v: string[]) => ((list = v), q),
        order: () => q, limit: () => q,
        insert: (row: Record<string, unknown>) => { runs.push({ generated_at: null, sources: {}, payload: null, error_note: null, ...row }); return Promise.resolve({ error: null }); },
        update: (p: Record<string, unknown>) => ((mode = "update"), (patch = p), q),
        maybeSingle: () => {
          if (table === "cora_review_preferences") return Promise.resolve({ data: { automatic_reminders: !opts.paused }, error: null });
          const hit = runs.find((r) => filters.every(([k, v]) => r[k] === v));
          if (mode === "update" && hit) Object.assign(hit, patch);
          return Promise.resolve({ data: hit ?? null, error: null });
        },
        then: (resolve: (v: unknown) => void) =>
          resolve(table === "work_items"
            ? { data: (opts.records ?? []).filter((id) => list?.includes(id)).map((id) => ({ id })), error: null }
            : { data: runs, error: null }),
      };
      return q;
    },
  };
  return { store: store as unknown as AppClient, runs };
}
const call = (s: AppClient, args: Record<string, unknown>) => saveSitrep(s, owner, args);

describe("SITREP payload validation", () => {
  it("accepts the empty-section payload and bold-only text", () => {
    expect(parsePayload(JSON.stringify(empty)).now).toBe("Quiet morning.");
    expect(plainText("Reply to **Budget** thread")).toBeNull();
  });
  it.each([
    ["a link", "See [this](https://x.org)"],
    ["a bare URL", "Open https://evil.example now"],
    ["HTML", "Call <b>now</b>"],
    ["a heading", "# Urgent"],
    ["italics", "Call *Sam*"],
    ["a line break", "a\nb"],
  ])("rejects %s in text", (_, text) => {
    expect(plainText(text)).not.toBeNull();
    expect(() => parsePayload(JSON.stringify({ ...empty, now: text }))).toThrow();
  });
  it("rejects extra keys, bad markers, too many items and oversize payloads with the right code", () => {
    const code = (v: unknown) => { try { parsePayload(typeof v === "string" ? v : JSON.stringify(v)); } catch (e) { return (e as { code: string }).code; } };
    expect(code({ ...empty, extra: 1 })).toBe("schema_invalid");
    expect(code({ ...empty, next: [{ text: "x", marker: "urgent" }] })).toBe("schema_invalid");
    expect(code({ ...empty, next: Array(5).fill({ text: "x" }) })).toBe("schema_invalid");
    expect(code({ ...empty, next: [{ text: "x", starts_at: "2026-10-01T09:00:00" }] })).toBe("schema_invalid");
    expect(code({ ...empty, next: [{ text: "x", refs: [{ kind: "record", id: "u", url: "https://x" }] }] })).toBe("schema_invalid");
    const { now: _omitted, ...missing } = empty; void _omitted;
    expect(code(missing)).toBe("schema_invalid");
    expect(code("x".repeat(40000))).toBe("payload_too_large");
    expect(code("{not json")).toBe("schema_invalid");
  });
});

describe("save_sitrep lifecycle", () => {
  it("opens, finishes once, and repeats are idempotent", async () => {
    const { store, runs } = fakeStore();
    expect(await call(store, start)).toMatchObject({ saved: true, status: "running" });
    expect(await call(store, start)).toMatchObject({ saved: true, status: "running" });
    expect(runs).toHaveLength(1);
    const done = await call(store, finish(empty));
    expect(done).toMatchObject({ saved: true, status: "complete" });
    expect(await call(store, finish(empty))).toMatchObject({ saved: true, status: "complete", generated_at: (done as { generated_at: string }).generated_at });
    expect(await call(store, finish({ ...empty, now: "Different." }))).toMatchObject({ saved: false, error: "run_closed" });
    expect(await call(store, { ...finish(empty), status: "failed", sources: null, payload_json: null, error_note: "x" })).toMatchObject({ saved: false, error: "run_closed" });
  });
  it("detects a run_id reused with different start inputs", async () => {
    const { store } = fakeStore();
    await call(store, start);
    expect(await call(store, { ...start, run_slot: "midday" })).toMatchObject({ saved: false, error: "run_id_conflict" });
  });
  it("leaves the run open after a rejected finish so the agent can resend", async () => {
    const { store, runs } = fakeStore();
    await call(store, start);
    expect(await call(store, finish({ ...empty, now: "[x](https://a.b)" }))).toMatchObject({ saved: false, error: "schema_invalid" });
    expect(runs[0]).toMatchObject({ status: "running" });
    expect(await call(store, finish(empty))).toMatchObject({ saved: true });
  });
  it("rejects record refs that are not real Command records", async () => {
    const { store } = fakeStore({ records: [record] });
    await call(store, start);
    const item = (id: string) => ({ ...empty, next: [{ text: "Do it", refs: [{ kind: "record", id }] }] });
    expect(await call(store, finish(item("cccccccc-cccc-4ccc-8ccc-cccccccccccc")))).toMatchObject({ saved: false, error: "unknown_record", detail: expect.stringContaining("next[0].refs[0]") });
    expect(await call(store, finish(item(record)))).toMatchObject({ saved: true });
  });
  it("returns payload_too_large and writes_paused without writing", async () => {
    const big = fakeStore();
    await call(big.store, start);
    expect(await call(big.store, { ...finish(empty), payload_json: JSON.stringify({ ...empty, pad: "x".repeat(40000) }) })).toMatchObject({ saved: false, error: "payload_too_large" });
    const paused = fakeStore({ paused: true });
    expect(await call(paused.store, start)).toMatchObject({ saved: false, error: "writes_paused" });
    expect(paused.runs).toHaveLength(0);
  });
  it("records a failed run with a short note", async () => {
    const { store, runs } = fakeStore();
    await call(store, start);
    expect(await call(store, { ...start, status: "failed", run_slot: null, for_date: null, error_note: "Command unavailable" })).toMatchObject({ saved: true, status: "failed" });
    expect(runs[0]).toMatchObject({ status: "failed", error_note: "Command unavailable" });
  });
  it("rejects malformed calls and a finish without a started run", async () => {
    const { store } = fakeStore();
    expect(await call(store, { run_id: run, status: "running" })).toMatchObject({ saved: false, error: "schema_invalid" });
    expect(await call(store, finish(empty))).toMatchObject({ saved: false, error: "schema_invalid" });
    expect((await getSitrepRuns(store, owner, {})) as object).toHaveProperty("runs");
    await expect(getSitrepRuns(store, owner, { x: 1 })).rejects.toThrow();
  });
});
