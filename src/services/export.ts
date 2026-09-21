import type { AppClient } from "../platform/supabase";
import type { WorkItem } from "../features/work/model";
import type { LibraryVersion } from "./library";
import { measured } from "../platform/telemetry";
import { Zip, ZipPassThrough, strToU8 } from "fflate";
export type ExportSnapshot = {
  format: "command-workspace";
  format_version: 1;
  exported_at: string;
  user_id: string;
  work_items: WorkItem[];
  journal_revisions: {
    id: string;
    item_id: string;
    user_id: string;
    version: number;
    snapshot: WorkItem;
    created_at: string;
  }[];
  library_versions: LibraryVersion[];
  user_preferences: Record<string, unknown>[];
  activity_log: Record<string, unknown>[];
  app_memberships: Record<string, unknown>[];
  counts: Record<string, number>;
};
export const relationshipFields = [
  "converted_task_id",
  "project_id",
  "initiative_id",
  "person_id",
  "task_id",
  "source_entry_id",
  "learning_id",
  "program_id",
  "use_case_id",
  "experiment_id",
  "decision_id",
] as const;
export function validateSnapshot(snapshot: ExportSnapshot) {
  if (snapshot.format !== "command-workspace" || snapshot.format_version !== 1)
    throw new Error("Unsupported export format.");
  for (const table of [
    "work_items",
    "journal_revisions",
    "library_versions",
    "user_preferences",
    "activity_log",
    "app_memberships",
  ] as const) {
    if (
      !Array.isArray(snapshot[table]) ||
      snapshot.counts[table] !== snapshot[table].length
    )
      throw new Error(`Export count mismatch: ${table}`);
    if (snapshot[table].some((row) => row.user_id !== snapshot.user_id))
      throw new Error("Export ownership mismatch.");
  }
  const ids = new Set(snapshot.work_items.map((row) => row.id));
  if (ids.size !== snapshot.work_items.length)
    throw new Error("Duplicate record IDs.");
  for (const row of snapshot.work_items)
    for (const key of relationshipFields)
      if (row[key] && !ids.has(row[key]!))
        throw new Error("Export contains an unresolved relationship.");
  for (const row of snapshot.journal_revisions)
    if (
      !ids.has(row.item_id) ||
      row.snapshot.id !== row.item_id ||
      row.snapshot.user_id !== snapshot.user_id
    )
      throw new Error("Export contains an unresolved revision.");
  for (const version of snapshot.library_versions) {
    if (
      !ids.has(version.document_id) ||
      !snapshot.work_items.some(
        (row) => row.id === version.document_id && row.kind === "library",
      )
    )
      throw new Error("Export contains an unresolved original.");
    if (
      !/^[a-f0-9-]{36}$/.test(version.id) ||
      /[\\/]/.test(version.filename) ||
      Array.from(version.filename).some((char) => char.charCodeAt(0) < 32) ||
      version.filename === "." ||
      version.filename === ".."
    )
      throw new Error("Invalid original filename.");
  }
}
export function csvCell(value: unknown) {
  let text =
    value === null || value === undefined
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  // Spreadsheet formula injection: JSON retains untouched source values.
  if (/^[\s]*[=+\-@\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function recordsCsv(rows: WorkItem[]) {
  const columns = [
    "id",
    "kind",
    "title",
    "body",
    "original_body",
    "status",
    "priority",
    "tags",
    "details",
    "archived",
    "created_at",
    "updated_at",
    ...relationshipFields,
  ] as const;
  return (
    columns.join(",") +
    "\r\n" +
    rows
      .map((row) => columns.map((key) => csvCell(row[key])).join(","))
      .join("\r\n")
  );
}
export async function createWorkspaceExport(
  client: AppClient,
  signal: AbortSignal,
  onProgress: (message: string) => void,
): Promise<{
  blob: Blob;
  filename: string;
  records: number;
  originals: number;
  pending: number;
}> {
  return measured("work.export", async () => {
    onProgress("Taking a consistent snapshot…");
    const { data, error } = await client
      .rpc("export_workspace", {})
      .abortSignal(signal);
    if (error)
      throw new Error(
        "Export could not start. Reconnect and retry; large workspaces may need the administrator backup procedure.",
      );
    const snapshot = data as ExportSnapshot;
    validateSnapshot(snapshot);
    const ready = snapshot.library_versions.filter((v) => v.state === "ready");
    const json = JSON.stringify(snapshot, null, 2),
      csv = recordsCsv(snapshot.work_items);
    const estimate =
      ready.reduce((sum, v) => sum + v.size_bytes, 0) +
      new Blob([json, csv]).size;
    if (estimate > 250 * 1024 * 1024)
      throw new Error(
        "This workspace exceeds the 250 MB browser export limit. Use the administrator backup procedure; no partial export was saved.",
      );
    signal.throwIfAborted();
    const chunks: BlobPart[] = [];
    let zipError: Error | null = null;
    const zip = new Zip((error, chunk) => {
      if (error) zipError = error;
      else chunks.push(new Uint8Array(chunk).buffer);
    });
    const add = (name: string, bytes: Uint8Array) => {
      signal.throwIfAborted();
      const file = new ZipPassThrough(name);
      zip.add(file);
      file.push(bytes, true);
      if (zipError) throw zipError;
    };
    const manifest: {
      path: string;
      sha256: string;
      size_bytes: number;
      version_id: string;
      document_id: string;
    }[] = [];
    try {
      add("workspace.json", strToU8(json));
      add("records.csv", strToU8(csv));
      for (const [index, version] of ready.entries()) {
        signal.throwIfAborted();
        onProgress(`Verifying original ${index + 1} of ${ready.length}…`);
        const { data: original, error: downloadError } =
          await client.functions.invoke("library", {
            body: { action: "download", id: version.id },
            signal,
          });
        if (downloadError || !(original instanceof Blob))
          throw new Error(
            "An original could not be downloaded. No partial export was saved; reconnect and retry.",
          );
        const bytes = new Uint8Array(await original.arrayBuffer());
        const digest = Array.from(
          new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
          (b) => b.toString(16).padStart(2, "0"),
        ).join("");
        if (bytes.length !== version.size_bytes || digest !== version.sha256)
          throw new Error(
            "An original failed integrity verification. No export was saved; contact the recovery owner.",
          );
        const path = `originals/${version.id}/${version.filename}`;
        add(path, bytes);
        manifest.push({
          path,
          sha256: digest,
          size_bytes: bytes.length,
          version_id: version.id,
          document_id: version.document_id,
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      add(
        "originals-manifest.json",
        strToU8(JSON.stringify(manifest, null, 2)),
      );
      add(
        "README.txt",
        strToU8(
          `COMMAND WORKSPACE EXPORT\nFormat version 1. Exported ${snapshot.exported_at}.\nworkspace.json preserves all record fields, stable IDs, relationships, journal history, preferences, membership and activity.\nrecords.csv is a convenient spreadsheet view; formula-like values are prefixed with an apostrophe for safety. JSON preserves original values.\noriginals-manifest.json maps each immutable original to its document ID, byte count and SHA-256. Every ready version is included and verified.\n${snapshot.library_versions.length - ready.length} pending versions are metadata only; unfinished uploads have no verified original.\nThis archive contains organizational information. Keep it in approved protected storage. It contains no Auth passwords or sessions. Administrator backups separately protect Auth and database configuration.\n`,
        ),
      );
      signal.throwIfAborted();
      zip.end();
      if (zipError) throw zipError;
      return {
        blob: new Blob(chunks, { type: "application/zip" }),
        filename: `command-workspace-${snapshot.exported_at.slice(0, 10)}.zip`,
        records: snapshot.work_items.length,
        originals: ready.length,
        pending: snapshot.library_versions.length - ready.length,
      };
    } catch (error) {
      zip.terminate();
      throw error;
    }
  });
}
