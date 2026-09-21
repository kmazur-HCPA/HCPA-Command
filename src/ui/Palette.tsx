import { useEffect, useRef, useState } from "react";
import type { AppClient } from "../platform/supabase";
import { listWork } from "../services/work";
import type { WorkSummary } from "../features/work/model";
import { labels } from "../features/work/model";
import { Icon } from "./Icon";
import { navigation } from "./navigation";
import type { PageName } from "./navigation";
export function Palette({
  client,
  onNavigate,
  onOpen,
  onCapture,
  onClose,
}: {
  client: AppClient;
  onNavigate: (page: PageName) => void;
  onOpen: (item: WorkSummary) => void;
  onCapture: () => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    [query, setQuery] = useState(""),
    [rows, setRows] = useState<WorkSummary[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    if (!query.trim()) return;
    let alive = true;
    const timer = setTimeout(() => {
      setLoading(true);
      listWork(client, { search: query.trim() })
        .then((data) => {
          if (alive) {
            setRows(data);
            setError("");
          }
        })
        .catch(() => {
          if (alive) setError("Search unavailable. Reconnect and try again.");
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [client, query]);
  const choose = (action: () => void) => {
    onClose();
    action();
  };
  return (
    <dialog
      className="palette"
      ref={dialog}
      aria-label="Command search"
      onCancel={onClose}
    >
      <div className="palette-input">
        <Icon name="search" />
        <input
          autoFocus
          aria-label="Search Command"
          placeholder="Search records or jump to a workspace…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLoading(Boolean(e.target.value.trim()));
            setRows([]);
            setError("");
          }}
        />
        <button aria-label="Close search" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <div className="palette-results">
        {!query && (
          <button className="palette-row" onClick={() => choose(onCapture)}>
            <Icon name="plus" />
            <span>
              Quick Capture
              <small>Save a thought without breaking your flow</small>
            </span>
            <kbd>⇧ ⌘ K</kbd>
          </button>
        )}
        <p className="eyebrow">Go to</p>
        {navigation
          .filter((n) => n.label.toLowerCase().includes(query.toLowerCase()))
          .map((n) => (
            <button
              className="palette-row"
              key={n.page}
              onClick={() => choose(() => onNavigate(n.page))}
            >
              <Icon name={n.icon} />
              <span>{n.label}</span>
              <Icon name="arrow" />
            </button>
          ))}
        {query.trim() && (
          <>
            <p className="eyebrow">Your records</p>
            {loading && <p role="status">Searching…</p>}
            {error && <p role="alert">{error}</p>}
            {!loading && !error && !rows.length && (
              <p className="muted">No matching records. Try another word.</p>
            )}
            {rows.map((row) => (
              <button
                className="palette-row"
                key={row.id}
                onClick={() => choose(() => onOpen(row))}
              >
                <Icon name={row.kind} />
                <span>
                  {row.title}
                  <small>
                    {labels[row.kind]} · {row.status}
                  </small>
                </span>
                <Icon name="arrow" />
              </button>
            ))}
            {rows.length === 50 && (
              <p className="muted small">
                First 50 matches. Add words to narrow your search.
              </p>
            )}
          </>
        )}
      </div>
      <footer className="palette-footer">
        Titles and notes · Tab to move · Enter to open · Esc to close
      </footer>
    </dialog>
  );
}
