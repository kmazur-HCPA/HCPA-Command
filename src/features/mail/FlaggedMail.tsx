import { useCallback, useEffect, useRef, useState } from "react";
import type { AppClient } from "../../platform/supabase";
import {
  captureFlagged,
  flaggedMail,
  taskTitle,
  undoDismiss,
  type FlaggedMail as Flagged,
  type FlaggedMessage,
} from "../../services/mail";
import { priorities } from "../work/model";
import { Icon } from "../../ui/Icon";

const zone = "America/New_York";
const when = (iso: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
const dueLabel = (date: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(new Date(date + "T00:00:00Z"));
const refreshMs = 30000;

export function FlaggedMail({
  client,
  revision,
  onCount,
  onChanged,
}: {
  client: AppClient;
  revision: number;
  onCount: (count: number | null) => void;
  onChanged: () => void;
}) {
  const [data, setData] = useState<Flagged | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [notice, setNotice] = useState(""),
    [converting, setConverting] = useState<{
      message: FlaggedMessage;
      kind: "task" | "reminder";
    } | null>(null),
    [showDismissed, setShowDismissed] = useState(false),
    [undo, setUndo] = useState<FlaggedMessage | null>(null),
    [busy, setBusy] = useState("");
  const last = useRef(0),
    inFlight = useRef(false),
    undoTimer = useRef<number>(undefined);
  const load = useCallback(
    (force = false) => {
      if (inFlight.current || (!force && Date.now() - last.current < refreshMs))
        return Promise.resolve();
      inFlight.current = true;
      return flaggedMail(client)
        .then((result) => {
          last.current = Date.now();
          setData(result);
          setError("");
          onCount(result.messages.filter((m) => !m.capture).length);
        })
        .catch((caught: Error) => {
          setError(caught.message);
          onCount(null);
        })
        .finally(() => {
          inFlight.current = false;
          setLoading(false);
        });
    },
    [client, onCount],
  );
  useEffect(() => {
    void load(true);
  }, [load, revision]);
  useEffect(() => {
    const visible = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("focus", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [load]);
  useEffect(() => () => window.clearTimeout(undoTimer.current), []);

  async function dismiss(message: FlaggedMessage) {
    if (busy) return;
    setBusy(message.id);
    setError("");
    try {
      await captureFlagged(client, message, "dismissed");
      setUndo(message);
      window.clearTimeout(undoTimer.current);
      undoTimer.current = window.setTimeout(() => setUndo(null), 10000);
      await load(true);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function restore(message: FlaggedMessage) {
    setBusy(message.id);
    setError("");
    try {
      await undoDismiss(client, message.id);
      setUndo(null);
      await load(true);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy("");
    }
  }
  const open = data?.messages.filter((m) => !m.capture) ?? [],
    dismissed = data?.messages.filter((m) => m.capture === "dismissed") ?? [];
  const row = (m: FlaggedMessage, isDismissed = false) => (
    <li key={m.id}>
      <Icon name="mail" className="flag-icon" />
      <div>
        {m.url ? (
          <a
            className="row-title"
            href={m.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {m.subject || "(no subject)"}
            <span className="visually-hidden"> (opens Outlook)</span>
          </a>
        ) : (
          <strong>{m.subject || "(no subject)"}</strong>
        )}
        <p className="record-meta">
          {m.sender || "Unknown sender"} · Received {when(m.received_at)}
          {m.flag_due && ` · Flag due ${dueLabel(m.flag_due)}`}
          {m.importance === "high" && (
            <>
              {" · "}
              <strong className="flag-high">High</strong>
            </>
          )}
        </p>
      </div>
      <div className="flag-actions">
        {isDismissed ? (
          <button disabled={!!busy} onClick={() => void restore(m)}>
            Restore
          </button>
        ) : (
          <>
            <button
              aria-label={`Make a task from ${m.subject}`}
              disabled={!!busy}
              onClick={() => setConverting({ message: m, kind: "task" })}
            >
              Task
            </button>
            <button
              aria-label={`Make a reminder from ${m.subject}`}
              disabled={!!busy}
              onClick={() => setConverting({ message: m, kind: "reminder" })}
            >
              Reminder
            </button>
            <button
              aria-label={`Dismiss ${m.subject}`}
              disabled={!!busy}
              onClick={() => void dismiss(m)}
            >
              Dismiss
            </button>
          </>
        )}
      </div>
    </li>
  );
  return (
    <section className="day-panel flagged-panel" aria-labelledby="flagged-heading">
      <div className="panel-heading">
        <h2 id="flagged-heading">
          <Icon name="flag" />
          Flagged email{data ? ` (${open.length})` : ""}
        </h2>
        <button
          className="panel-link"
          disabled={loading}
          onClick={() => {
            setLoading(true);
            void load(true);
          }}
        >
          Refresh
        </button>
      </div>
      {loading && !data && (
        <p role="status" className="small muted">
          Checking flagged email…
        </p>
      )}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {notice && (
        <p className="success-toast" role="status">
          <Icon name="check" />
          {notice}
          <button aria-label="Dismiss confirmation" onClick={() => setNotice("")}>
            <Icon name="close" />
          </button>
        </p>
      )}
      {undo && (
        <p className="success-toast" role="status">
          Dismissed “{undo.subject || "(no subject)"}”.
          <button onClick={() => void restore(undo)}>Undo</button>
        </p>
      )}
      {data && !open.length && (
        <p className="small muted">
          Nothing flagged that needs capturing.
        </p>
      )}
      {open.length > 0 && <ul className="day-list flag-list">{open.map((m) => row(m))}</ul>}
      {data?.truncated && (
        <p className="small muted">
          More flagged messages are in Outlook’s Flagged view. This list shows
          the newest 50 from the last {data.window_days} days.
        </p>
      )}
      {dismissed.length > 0 && (
        <>
          <button
            className="panel-link"
            aria-expanded={showDismissed}
            onClick={() => setShowDismissed((v) => !v)}
          >
            Dismissed ({dismissed.length})
          </button>
          {showDismissed && (
            <ul className="day-list flag-list">
              {dismissed.map((m) => row(m, true))}
            </ul>
          )}
        </>
      )}
      {data && (
        <p className="small muted">
          Read live from Outlook. Command stores only the message ID of what you
          capture, never its contents.
        </p>
      )}
      {converting && (
        <ConvertDialog
          key={converting.message.id + converting.kind}
          client={client}
          {...converting}
          onClose={() => setConverting(null)}
          onSaved={(kind) => {
            setConverting(null);
            setNotice(`Saved ${kind}. It’s no longer on this list.`);
            onChanged();
            void load(true);
          }}
        />
      )}
    </section>
  );
}

function ConvertDialog({
  client,
  message,
  kind,
  onClose,
  onSaved,
}: {
  client: AppClient;
  message: FlaggedMessage;
  kind: "task" | "reminder";
  onClose: () => void;
  onSaved: (kind: string) => void;
}) {
  const [title, setTitle] = useState(taskTitle(message.subject)),
    [due, setDue] = useState(message.flag_due ?? ""),
    [priority, setPriority] = useState(
      message.importance === "high" ? "High" : "Normal",
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null),
    saving = useRef(false);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving.current) return;
    if (!title.trim()) return setError("Add a title before saving.");
    if (kind === "reminder" && !due)
      return setError("Choose a date for the reminder.");
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      await captureFlagged(client, message, kind, {
        title: title.trim(),
        due: due || null,
        priority,
      });
      onSaved(kind);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="record-dialog"
      aria-labelledby="convert-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form onSubmit={(e) => void save(e)}>
        <div className="dialog-heading">
          <h2 id="convert-title">
            {kind === "task" ? "Make a task" : "Make a reminder"}
          </h2>
          <button type="button" aria-label="Close" disabled={busy} onClick={onClose}>
            ×
          </button>
        </div>
        <label>
          Title
          <input
            autoFocus
            required
            maxLength={200}
            value={title}
            disabled={busy}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label>
          {kind === "task" ? "Due date (optional)" : "Remind me on"}
          <input
            type="date"
            required={kind === "reminder"}
            value={due}
            disabled={busy}
            onChange={(e) => setDue(e.target.value)}
          />
        </label>
        <label>
          Priority
          <select
            value={priority}
            disabled={busy}
            onChange={(e) => setPriority(e.target.value)}
          >
            {priorities.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <p className="small muted">
          Links back to the Outlook message. The message text is never copied.
        </p>
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        <div className="actions">
          <button className="save-button" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </dialog>
  );
}
