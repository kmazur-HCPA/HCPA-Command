import { useEffect, useRef, useState } from "react";
import type { AppClient } from "../../platform/supabase";
import { contactMatches, importPeople } from "../../services/people";
import { flagDuplicates, type ImportRow } from "./model";
import { csvTemplate, parseContacts } from "./csv";
import { useDraftGuard } from "../work/useDraftGuard";
export function ImportPeople({
  client,
  onClose,
  onImported,
}: {
  client: AppClient;
  onClose: () => void;
  onImported: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    lock = useRef(false);
  const [rows, setRows] = useState<ImportRow[]>([]),
    [ignored, setIgnored] = useState<string[]>([]),
    [filename, setFilename] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [receipt, setReceipt] = useState<{
      created: number;
      skipped: number;
    } | null>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useDraftGuard(busy || (rows.length > 0 && !receipt));
  const ready = rows.filter((row) => !row.issue);
  function template() {
    const url = URL.createObjectURL(
      new Blob([csvTemplate], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "command-people-template.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function preview(file: File | undefined) {
    if (!file || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setRows([]);
    setReceipt(null);
    setIgnored([]);
    setFilename(file.name);
    try {
      if (file.size > 2 * 1024 * 1024)
        throw new Error("Use a CSV smaller than 2 MB.");
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(
          await file.arrayBuffer(),
        );
      } catch {
        throw new Error("Save the file as CSV UTF-8, then try again.");
      }
      const parsed = parseContacts(text);
      const existing = await contactMatches(client);
      setRows(flagDuplicates(parsed.rows, existing));
      setIgnored(parsed.ignored);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }
  async function save() {
    if (lock.current || !ready.length || receipt) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await importPeople(
        client,
        ready.map((row) => row.contact),
      );
      setReceipt(result);
      onImported();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }
  return (
    <dialog
      ref={dialog}
      className="record-dialog people-import"
      aria-labelledby="import-people-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="dialog-heading">
        <h2 id="import-people-title">Import people</h2>
        <button onClick={onClose} disabled={busy} aria-label="Close import">
          ×
        </button>
      </div>
      <p>
        Add contacts from a UTF-8 CSV. Up to 500 rows and 2 MB per import.
        Existing contacts are never overwritten.
      </p>
      <button onClick={template}>Download CSV template</button>
      <p className="small muted">
        Supported columns: Name, Email, Job Title, Organization, Phone, Mobile,
        Department, Location, Notes. First Name / Last Name and common Outlook
        column names are also supported.
      </p>
      <label>
        Choose CSV
        <input
          type="file"
          accept=".csv,text/csv"
          disabled={busy}
          onChange={(e) => {
            void preview(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </label>
      {busy && (
        <p role="status">
          {rows.length
            ? "Saving contacts…"
            : "Checking file and existing contacts…"}
        </p>
      )}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {ignored.length > 0 && (
        <p className="small">Columns not imported: {ignored.join(", ")}.</p>
      )}
      {rows.length > 0 && (
        <>
          <p>
            <strong>{filename}</strong> · {ready.length} ready ·{" "}
            {rows.length - ready.length} skipped
          </p>
          <p className="small muted">
            Matches use email or the same name and organization, including
            archived contacts. Review skipped rows; correct the source file to
            add a different person with similar details.
          </p>
          <div
            className="import-preview"
            tabIndex={0}
            role="region"
            aria-label="Contact import preview"
          >
            <table>
              <thead>
                <tr>
                  <th>CSV row</th>
                  <th>Contact</th>
                  <th>Details</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.contact.id}>
                    <td>{row.row}</td>
                    <td>
                      <strong>{row.contact.name || "Missing name"}</strong>
                      <br />
                      {row.contact.job_title}
                      <br />
                      {row.contact.organization}
                    </td>
                    <td>
                      {row.contact.email}
                      <br />
                      {row.contact.phone}
                      {row.contact.mobile && ` · ${row.contact.mobile}`}
                      <br />
                      {[row.contact.department, row.contact.location]
                        .filter(Boolean)
                        .join(" · ")}
                      {row.contact.notes && (
                        <details>
                          <summary>Notes</summary>
                          <p>{row.contact.notes}</p>
                        </details>
                      )}
                    </td>
                    <td>{row.issue || "Ready"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {receipt ? (
        <p role="status" className="success-toast">
          Imported {receipt.created} contacts. {receipt.skipped} already present
          or saved by an earlier attempt. {rows.length - ready.length} rows
          excluded during preview.
        </p>
      ) : (
        <button disabled={busy || !ready.length} onClick={() => void save()}>
          Import {ready.length} contacts
        </button>
      )}
      <button disabled={busy} onClick={onClose}>
        {receipt ? "Done" : "Cancel"}
      </button>
    </dialog>
  );
}
