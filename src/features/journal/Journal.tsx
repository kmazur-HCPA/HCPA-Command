import { useEffect, useState } from "react";
import type { AppClient } from "../../platform/supabase";
import { listJournal } from "../../services/work";
import { entryTypes } from "../work/model";
import type { WorkItem } from "../work/model";
import { Editor } from "../work/Editor";
import { Icon } from "../../ui/Icon";

type Entry = Awaited<ReturnType<typeof listJournal>>[number];
const zone = "America/New_York";
const dayKey = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(new Date(iso));
const dayLabel = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "long", month: "long", day: "numeric", year: "numeric" })
    .format(new Date(iso))
    .toUpperCase();
const excerpt = (body: string) => {
  const text = body.trim();
  return text.length > 420 ? text.slice(0, 420).replace(/\s+\S*$/, "") + "…" : text;
};

// Reading-first journal: capture field on top, entries as a dated feed with hairlines.
export function Journal({
  client,
  userId,
  onOpen,
  onCapture,
  revision = 0,
}: {
  client: AppClient;
  userId: string;
  onOpen: (item: Pick<WorkItem, "id">) => void;
  onCapture: () => void;
  revision?: number;
}) {
  const [entries, setEntries] = useState<Entry[]>([]),
    [search, setSearch] = useState(""),
    [entryType, setEntryType] = useState(""),
    [tag, setTag] = useState(""),
    [archived, setArchived] = useState(false),
    [offset, setOffset] = useState(0),
    [more, setMore] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0),
    [composing, setComposing] = useState(false);
  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const pages = await Promise.all(
          Array.from({ length: offset / 20 + 1 }, (_, i) =>
            listJournal(client, { search, entryType, tag, archived, offset: i * 20 }),
          ),
        );
        if (alive) {
          setEntries(pages.flat());
          setMore(pages.at(-1)?.length === 20);
          setError("");
        }
      } catch (caught) {
        if (alive) setError((caught as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    }, 180);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [client, search, entryType, tag, archived, offset, reload, revision]);
  const filtered = !!(search || entryType || tag || archived);
  const reset = () => setOffset(0);
  const days: { key: string; label: string; items: Entry[] }[] = [];
  for (const entry of entries) {
    const key = dayKey(entry.created_at);
    const last = days.at(-1);
    if (last?.key === key) last.items.push(entry);
    else days.push({ key, label: dayLabel(entry.created_at), items: [entry] });
  }
  return (
    <section className="journal" aria-label="Journal">
      <div className="section-heading">
        <h1 tabIndex={-1}>Journal</h1>
        <button className="btn" onClick={() => setComposing(true)}>
          <Icon name="plus" /> New journal
        </button>
      </div>
      <button className="command-field journal-composer" onClick={onCapture}>
        <span>What’s on your mind?</span>
        <kbd>⇧⌘K</kbd>
      </button>
      <div className="filters filter-row">
        <label>
          <span className="visually-hidden">Search titles and notes</span>
          <input
            type="search"
            placeholder="Search your journal"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              reset();
            }}
          />
        </label>
        <label>
          <span className="visually-hidden">Filter entry type</span>
          <select
            value={entryType}
            onChange={(e) => {
              setEntryType(e.target.value);
              reset();
            }}
          >
            <option value="">All entry types</option>
            {entryTypes.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="visually-hidden">Filter tag</span>
          <input
            placeholder="Exact tag"
            value={tag}
            onChange={(e) => {
              setTag(e.target.value);
              reset();
            }}
          />
        </label>
        <label>
          <span className="visually-hidden">View</span>
          <select
            value={String(archived)}
            onChange={(e) => {
              setArchived(e.target.value === "true");
              reset();
            }}
          >
            <option value="false">Current</option>
            <option value="true">Archived</option>
          </select>
        </label>
      </div>
      {error && (
        <p role="alert" className="error-message">
          {error} <button onClick={() => setReload((v) => v + 1)}>Reload list</button>
        </p>
      )}
      {loading && (
        <p role="status" className="small muted">
          Loading…
        </p>
      )}
      {!loading && !entries.length && !error && (
        <div className="state-panel">
          <h2>{filtered ? "No matching entries." : "Your journal starts here."}</h2>
          <p className="muted">
            {filtered ? "Adjust your search or filters." : "Capture a thought above. Your original words are always kept."}
          </p>
        </div>
      )}
      <div className="journal-feed">
        {days.map((day) => (
          <section key={day.key} className="journal-day" aria-label={day.label}>
            <h2 className="label">{day.label}</h2>
            {day.items.map((entry) => (
              <article key={entry.id} className="journal-entry">
                <h3>
                  <button className="journal-title" onClick={() => onOpen(entry)}>
                    {entry.title}
                  </button>
                </h3>
                <p className="meta">
                  {entry.entry_type}
                  {entry.tags.length ? ` · ${entry.tags.join(", ")}` : ""}
                </p>
                {entry.body.trim() && entry.body.trim() !== entry.title && (
                  <p className="journal-body">{excerpt(entry.body)}</p>
                )}
              </article>
            ))}
          </section>
        ))}
        {more && (
          <button className="load-more" disabled={loading} onClick={() => setOffset((v) => v + 20)}>
            Load more entries
          </button>
        )}
      </div>
      {composing && (
        <Editor
          client={client}
          userId={userId}
          kind="journal"
          onClose={() => setComposing(false)}
          onSaved={() => {
            setComposing(false);
            setReload((v) => v + 1);
          }}
        />
      )}
    </section>
  );
}
