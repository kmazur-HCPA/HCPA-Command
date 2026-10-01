import { z } from "zod";

import { sections } from "./sections";
export { sections };
export const maxPayloadBytes = 32 * 1024;
export const refKinds = [
  "record",
  "event",
  "email",
  "teams",
  "helix_task",
  "helix_ticket",
  "helix_change",
  "helix_asset",
  "helix_vendor",
] as const;
export const markers = ["overdue", "due_today", "conflict"] as const;

// Only **bold** is allowed. Anything that could render as a link, heading, HTML or
// other Markdown is rejected rather than stripped, so the agent can fix and resend.
export function plainText(value: string): string | null {
  if (/[\r\n\t]/.test(value)) return "line breaks are not allowed";
  if (/[<>]/.test(value)) return "HTML is not allowed";
  if (/\]\(|\[[^\]]*\]/.test(value)) return "links are not allowed";
  if (/(?:^|[\s(])(?:[a-z][a-z0-9+.-]*:\/\/|www\.|mailto:)/i.test(value)) return "links are not allowed";
  if (/^\s*(#|[-+]\s|\d+[.)]\s)/.test(value)) return "Markdown blocks are not allowed";
  const rest = value.replace(/\*\*[^*]+\*\*/g, "");
  if (/[*`~[\]]|(?:^|\s)_|_(?:\s|$)/.test(rest)) return "only **bold** markup is allowed";
  return null;
}
const text = (max: number, min = 1) =>
  z
    .string()
    .min(min)
    .max(max)
    .superRefine((value, ctx) => {
      const problem = plainText(value);
      if (problem) ctx.addIssue({ code: "custom", message: problem });
    });
const offsetDateTime = z.iso.datetime({ offset: true });
const refSchema = z
  .object({
    kind: z.enum(refKinds),
    id: z.string().min(1).max(200),
    label: text(80, 0).optional(),
  })
  .strict();
const itemSchema = z
  .object({
    text: text(220),
    reason: text(160, 0).optional(),
    marker: z.enum(markers).nullable().optional(),
    due_date: z.iso.date().optional(),
    due_at: offsetDateTime.optional(),
    starts_at: offsetDateTime.optional(),
    ends_at: offsetDateTime.optional(),
    refs: z.array(refSchema).max(3).optional(),
  })
  .strict();
export const sitrepSchema = z
  .object({
    schema_version: z.literal(1),
    now: text(300),
    next: z.array(itemSchema).max(4),
    prep: z.array(itemSchema).max(3),
    owed_by_me: z.array(itemSchema).max(6),
    owed_to_me: z.array(itemSchema).max(5),
    coming_up: z.array(itemSchema).max(5),
    watch: z.array(itemSchema).max(3),
  })
  .strict();
export type SitrepItem = z.infer<typeof itemSchema>;
export type SitrepRef = z.infer<typeof refSchema>;
export type SitrepPayload = z.infer<typeof sitrepSchema>;
export type SourceState = "ok" | "partial" | "failed";

export class SitrepError extends Error {
  constructor(
    public code:
      | "schema_invalid"
      | "payload_too_large"
      | "unknown_record"
      | "run_id_conflict"
      | "run_closed"
      | "writes_paused",
    public detail: string,
  ) {
    super(code);
  }
}

const dot = (path: PropertyKey[]) =>
  path.map((p) => (typeof p === "number" ? `[${p}]` : String(p))).join(".").replaceAll(".[", "[") || "(root)";

// Parse and validate the agent's payload_json. Nothing is stripped or coerced.
export function parsePayload(json: unknown): SitrepPayload {
  if (typeof json !== "string") throw new SitrepError("schema_invalid", "payload_json must be a JSON string");
  if (new TextEncoder().encode(json).length > maxPayloadBytes)
    throw new SitrepError("payload_too_large", "payload exceeds 32 KB");
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new SitrepError("schema_invalid", "payload_json is not valid JSON");
  }
  const result = sitrepSchema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0]!;
    const extra =
      issue.code === "unrecognized_keys" ? ` (${issue.keys.join(", ")})` : "";
    throw new SitrepError("schema_invalid", `${dot(issue.path)}: ${issue.message}${extra}`);
  }
  return result.data;
}
export function recordRefs(payload: SitrepPayload) {
  const found: { path: string; id: string }[] = [];
  for (const [key] of sections.slice(1)) {
    (payload[key as keyof SitrepPayload] as SitrepItem[]).forEach((item, i) =>
      item.refs?.forEach((ref, j) => {
        if (ref.kind === "record") found.push({ path: `${key}[${i}].refs[${j}]`, id: ref.id });
      }),
    );
  }
  return found;
}
