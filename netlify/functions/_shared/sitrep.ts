import type { AppClient } from "../../../src/platform/supabase";
import {
  SitrepError,
  parsePayload,
  recordRefs,
} from "../../../src/features/sitrep/schema";
import { definition } from "./microsoft/tools";

export const sitrepTools = [
  definition(
    "save_sitrep",
    'Save one SITREP run. Two steps, same run_id: first status="running" with run_slot (am|midday|manual) and for_date (YYYY-MM-DD, America/New_York), then ONE finish call with status complete|partial|failed. On complete/partial send sources (object: each key ok|partial|failed) and payload_json (a JSON string matching SITREP schema v1: now, next, prep, owed_by_me, owed_to_me, coming_up, watch). On failed send error_note (max 300 chars, no message content). Text allows **bold** only: no links, HTML or other Markdown. refs use source IDs, never URLs (email refs: the Graph immutable_id); record refs must be real Command records. A rejected finish leaves the run open: fix exactly what detail names and resend with the same run_id. Fields not used by a step must be null. Only claim saved from saved:true.',
    {
      run_id: { type: "string" },
      status: { type: "string", enum: ["running", "complete", "partial", "failed"] },
      run_slot: { type: ["string", "null"], enum: ["am", "midday", "manual", null] },
      for_date: { type: ["string", "null"] },
      sources: { type: ["object", "null"], additionalProperties: { type: "string", enum: ["ok", "partial", "failed"] } },
      payload_json: { type: ["string", "null"] },
      error_note: { type: ["string", "null"] },
    },
  ),
  definition(
    "get_sitrep_runs",
    "Read the five most recent SITREP runs: run_id, for_date, run_slot, status and generated_at. No payload. Use it to see whether a morning run exists before a midday run.",
    {},
  ),
];

const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const slots = ["am", "midday", "manual"];
const finals = ["complete", "partial", "failed"];
const states = ["ok", "partial", "failed"];
const sourceKeys = ["command", "calendar", "mail", "teams", "helix", "flagged"];
const bad = (detail: string) => new SitrepError("schema_invalid", detail);

function audit(runId: unknown, status: unknown, result: string) {
  // No payload contents, ever.
  console.info(
    JSON.stringify({ event: "save_sitrep", run_id: runId, status, result }),
  );
}
export function validDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value
  );
}

type Run = {
  status: string;
  run_slot: string;
  for_date: string;
  sources: Record<string, string>;
  payload: unknown;
  error_note: string | null;
  generated_at: string | null;
};
// jsonb reorders keys, so compare canonically.
const canon = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canon)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.entries(v as object)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, x]) => [k, canon(x)]),
        )
      : v;
const same = (a: unknown, b: unknown) =>
  JSON.stringify(canon(a)) === JSON.stringify(canon(b));

export async function saveSitrep(
  store: AppClient,
  userId: string,
  args: Record<string, unknown>,
) {
  const run = args.run_id;
  try {
    const keys = Object.keys(args).sort().join();
    if (
      keys !== "error_note,for_date,payload_json,run_id,run_slot,sources,status" ||
      typeof run !== "string" ||
      !uuid.test(run) ||
      !["running", ...finals].includes(String(args.status))
    )
      throw bad("Send all seven fields; unused ones as null. run_id must be a UUID and status a valid state.");
    // The kill switch is the existing automatic-writes preference.
    const pref = await store
      .from("cora_review_preferences")
      .select("automatic_reminders")
      .eq("user_id", userId)
      .maybeSingle();
    if (pref.error || !pref.data?.automatic_reminders)
      throw new SitrepError("writes_paused", "Automatic writes are paused in Command Settings");
    const status = String(args.status);
    const existing = await store
      .from("sitrep_runs")
      .select("status,run_slot,for_date,sources,payload,error_note,generated_at")
      .eq("run_id", run)
      .eq("user_id", userId)
      .maybeSingle();
    if (existing.error) throw bad("Run lookup failed; retry");
    const row = existing.data as Run | null;

    if (status === "running") {
      if (!slots.includes(String(args.run_slot)) || !validDate(args.for_date))
        throw bad("running needs run_slot (am|midday|manual) and for_date (YYYY-MM-DD)");
      if (args.sources !== null || args.payload_json !== null || args.error_note !== null)
        throw bad("running takes only run_slot and for_date; send other fields as null");
      if (row) {
        if (row.run_slot !== args.run_slot || row.for_date !== args.for_date)
          throw new SitrepError("run_id_conflict", "run_id already used with different inputs");
        return { saved: true, run_id: run, status: row.status, generated_at: row.generated_at };
      }
      const r = await store.from("sitrep_runs").insert({
        user_id: userId,
        run_id: run,
        run_slot: args.run_slot as string,
        for_date: args.for_date as string,
        status: "running",
      });
      if (r.error) throw bad("Could not start the run; retry");
      audit(run, status, "saved");
      return { saved: true, run_id: run, status: "running", generated_at: null };
    }

    if (!row) throw bad("Start the run with status=running first");
    // Validate before comparing, so a repeated identical finish is idempotent.
    let sources: Record<string, string> = {};
    let payload: unknown = null;
    let note: string | null = null;
    if (status === "failed") {
      if (
        typeof args.error_note !== "string" ||
        !args.error_note.trim() ||
        args.error_note.length > 300 ||
        args.payload_json !== null
      )
        throw bad("failed needs error_note (1-300 chars) and payload_json null");
      note = args.error_note.trim();
    } else {
      const s = args.sources;
      if (
        !s || typeof s !== "object" || Array.isArray(s) ||
        Object.entries(s).some(([k, v]) => !sourceKeys.includes(k) || !states.includes(String(v)))
      )
        throw bad(`sources keys must be among ${sourceKeys.join(", ")} with values ok|partial|failed`);
      if (args.error_note !== null) throw bad("error_note is only for failed runs");
      sources = s as Record<string, string>;
      const parsed = parsePayload(args.payload_json);
      const records = [...new Set(recordRefs(parsed).map((r) => r.id))];
      for (const r of recordRefs(parsed))
        if (!uuid.test(r.id)) throw new SitrepError("unknown_record", `${r.path}: record id is not a UUID`);
      if (records.length) {
        const found = await store
          .from("work_items")
          .select("id")
          .eq("user_id", userId)
          .in("id", records);
        if (found.error) throw bad("Record check failed; retry");
        const have = new Set(found.data.map((r) => r.id));
        const missing = recordRefs(parsed).find((r) => !have.has(r.id));
        if (missing) throw new SitrepError("unknown_record", `${missing.path}: no such Command record`);
      }
      payload = parsed;
    }
    if (row.status !== "running") {
      if (
        row.status === status &&
        same(row.payload, payload) &&
        same(row.sources, status === "failed" ? {} : sources) &&
        row.error_note === note
      )
        return { saved: true, run_id: run, status: row.status, generated_at: row.generated_at };
      throw new SitrepError("run_closed", "run is already " + row.status);
    }
    const generated = new Date().toISOString();
    const done = await store
      .from("sitrep_runs")
      .update(
        status === "failed"
          ? { status, error_note: note }
          : { status, sources, payload: payload as never, generated_at: generated },
      )
      .eq("run_id", run)
      .eq("user_id", userId)
      .eq("status", "running")
      .select("generated_at")
      .maybeSingle();
    if (done.error || !done.data)
      throw new SitrepError("run_closed", "run could not be finished; it may already be closed");
    audit(run, status, "saved");
    return { saved: true, run_id: run, status, generated_at: done.data.generated_at };
  } catch (error) {
    if (!(error instanceof SitrepError)) throw error;
    audit(run, args.status, error.code);
    return { saved: false, error: error.code, detail: error.detail };
  }
}

export async function getSitrepRuns(
  store: AppClient,
  userId: string,
  args: Record<string, unknown>,
) {
  if (Object.keys(args).length) throw new Error("No arguments accepted.");
  const r = await store
    .from("sitrep_runs")
    .select("run_id,for_date,run_slot,status,generated_at,started_at")
    .eq("user_id", userId)
    .order("started_at", { ascending: false })
    .limit(5);
  if (r.error) throw new Error("SITREP history unavailable.");
  return { runs: r.data, current_time: new Date().toISOString() };
}
