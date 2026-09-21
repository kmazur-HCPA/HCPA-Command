import { useEffect, useRef, useState } from "react";
import type { AppClient } from "../platform/supabase";
import { searchWorkspace, defaultSearchFilters } from "../services/search";
import type { SearchResult, SearchFilters } from "../services/search";
import { labels, statuses } from "../features/work/model";
import type { Kind } from "../features/work/model";
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
  onOpen: (item: { id: string }) => void;
  onCapture: () => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    [query, setQuery] = useState(""),
    [filters, setFilters] = useState<SearchFilters>(defaultSearchFilters),
    [rows, setRows] = useState<SearchResult[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [offset, setOffset] = useState(0),
    [more, setMore] = useState(false),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    if (query.trim().length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void searchWorkspace(client, query, filters, offset, controller.signal)
        .then((result) => {
          if (!controller.signal.aborted) {
            setRows(result.rows);
            setMore(result.more);
            setError("");
          }
        })
        .catch((caught) => {
          if (!controller.signal.aborted) setError((caught as Error).message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 180);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [client, query, filters, offset, retry]);
  function reset(nextQuery = query) {
    setRows([]);
    setMore(false);
    setError("");
    setLoading(nextQuery.trim().length >= 2);
    setOffset(0);
  }
  function filter(patch: Partial<SearchFilters>) {
    setFilters((old) => ({ ...old, ...patch }));
    reset();
  }
  const choose = (action: () => void) => {
    onClose();
    action();
  };
  const kinds = Object.keys(labels) as Kind[];
  const choices = filters.module
    ? statuses(filters.module)
    : [...new Set(kinds.flatMap((kind) => [...statuses(kind)]))].sort();
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
          type="search"
          maxLength={200}
          aria-label="Search Command"
          placeholder="Search your entire workspace…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            reset(e.target.value);
          }}
        />
        <button aria-label="Close search" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <details className="search-filters">
        <summary>
          Filter results
          {Object.entries(filters).some(([key, value]) =>
            key === "archive" ? value !== "current" : !!value,
          )
            ? " · active"
            : ""}
        </summary>
        <div className="form-grid">
          <label>
            Module
            <select
              value={filters.module}
              onChange={(e) =>
                filter({ module: e.target.value as Kind | "", status: "" })
              }
            >
              <option value="">All modules</option>
              {kinds.map((kind) => (
                <option key={kind} value={kind}>
                  {labels[kind]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select
              value={filters.status}
              onChange={(e) => filter({ status: e.target.value })}
            >
              <option value="">All statuses</option>
              {choices.map((status) => (
                <option key={status}>{status}</option>
              ))}
            </select>
          </label>
          <label>
            Archive
            <select
              value={filters.archive}
              onChange={(e) =>
                filter({ archive: e.target.value as SearchFilters["archive"] })
              }
            >
              <option value="current">Current records</option>
              <option value="all">Current and archived</option>
              <option value="archived">Archived only</option>
            </select>
          </label>
          <label>
            Exact tag
            <input
              maxLength={100}
              value={filters.tag}
              onChange={(e) => filter({ tag: e.target.value })}
            />
          </label>
        </div>
      </details>
      <div className="palette-results" aria-busy={loading}>
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
          .filter((n) =>
            n.label.toLowerCase().includes(query.trim().toLowerCase()),
          )
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
        <p className="eyebrow">Your records · most relevant first</p>
        {query.trim().length < 2 ? (
          <p className="muted small">
            Enter at least two characters. Use quotes for a phrase, OR for
            alternatives, or -word to exclude a term. Plain words also match
            word beginnings.
          </p>
        ) : (
          <>
            {loading && <p role="status">Searching…</p>}
            {error && (
              <p role="alert">
                {error}{" "}
                <button
                  onClick={() => {
                    setLoading(true);
                    setError("");
                    setRetry((v) => v + 1);
                  }}
                >
                  Retry search
                </button>
              </p>
            )}
            {!loading && !error && !rows.length && (
              <p role="status" className="muted">
                No matching records. Try fewer words or include archived
                records.
              </p>
            )}
            {rows.map((row) => (
              <a
                className="palette-row search-result"
                href={`/?record=${row.id}`}
                key={row.id}
                onClick={(event) => {
                  if (
                    !event.metaKey &&
                    !event.ctrlKey &&
                    !event.shiftKey &&
                    !event.altKey
                  ) {
                    event.preventDefault();
                    choose(() => onOpen(row));
                  }
                }}
              >
                <Icon name={row.kind} />
                <span>
                  <strong>{row.title}</strong>
                  <small>
                    {labels[row.kind]} · {row.status}
                    {row.archived ? " · Archived" : ""}
                    {row.tags.length ? ` · ${row.tags.join(", ")}` : ""}
                  </small>
                  <span className="search-excerpt">{row.excerpt}</span>
                </span>
                <Icon name="arrow" />
              </a>
            ))}
            {!loading && !error && (offset > 0 || rows.length > 0) && (
              <div className="search-pagination">
                <button
                  disabled={!offset}
                  onClick={() => {
                    setOffset((v) => Math.max(0, v - 25));
                    setLoading(true);
                    setRows([]);
                  }}
                >
                  Previous results
                </button>
                <span role="status">
                  {rows.length
                    ? `${offset + 1}–${offset + rows.length}`
                    : "No more results"}
                </span>
                <button
                  disabled={!more || offset >= 10000}
                  onClick={() => {
                    setOffset((v) => v + 25);
                    setLoading(true);
                    setRows([]);
                  }}
                >
                  Next results
                </button>
              </div>
            )}
            {offset >= 10000 && (
              <p className="small muted">
                Narrow your query to explore further matches.
              </p>
            )}
          </>
        )}
      </div>
      <footer className="palette-footer">
        Titles, text, tags, metadata and filenames. File contents await
        extraction.
        <br />
        Tab to move · Enter to open · Esc to close
      </footer>
    </dialog>
  );
}
