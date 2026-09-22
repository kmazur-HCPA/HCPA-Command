import { useEffect, useState } from "react";
import type { AppClient } from "../../platform/supabase";
import type { WorkItem } from "../work/model";
import { directoryPeople } from "../../services/people";
import { getWork, patchWork } from "../../services/work";
import { Editor } from "../work/Editor";
import { Icon } from "../../ui/Icon";
import { ImportPeople } from "./ImportPeople";
import { telephoneLink, type DirectoryPerson } from "./model";
export function Directory({
  client,
  userId,
  onOpen,
  revision: externalRevision,
}: {
  client: AppClient;
  userId: string;
  onOpen: (item: Pick<WorkItem, "id">) => void;
  revision: number;
}) {
  const [query, setQuery] = useState(""),
    [archived, setArchived] = useState(false),
    [offset, setOffset] = useState(0),
    [rows, setRows] = useState<DirectoryPerson[]>([]),
    [more, setMore] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0),
    [creating, setCreating] = useState(false),
    [importing, setImporting] = useState(false),
    [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<WorkItem | null>(null);
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const pages = await Promise.all(
          Array.from({ length: offset / 50 + 1 }, (_, i) =>
            directoryPeople(client, query, archived, i * 50),
          ),
        );
        if (alive) {
          setRows(pages.flatMap((page) => page.rows));
          setMore(pages.at(-1)?.more ?? false);
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
  }, [client, query, archived, offset, revision, externalRevision]);
  function refresh() {
    setRevision((v) => v + 1);
  }
  async function edit(item: Pick<WorkItem, "id">) {
    if (busy) return;
    setBusy(item.id);
    setError("");
    try { setEditing(await getWork(client, item.id)); }
    catch { setError("Could not load this record for editing. Please retry."); }
    finally { setBusy(null); }
  }
  async function archive(person: DirectoryPerson) {
    if (busy) return;
    setBusy(person.id);
    setError("");
    try {
      await patchWork(client, person, { archived: !person.archived });
      refresh();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="work-list-view directory" aria-label="People directory">
      <div className="section-heading">
        <div>
          <p className="eyebrow">YOUR WORKSPACE / DIRECTORY</p>
          <h1 tabIndex={-1}>People</h1>
          <p className="muted small">The people behind your work.</p>
        </div>
        <div className="directory-actions">
          <button onClick={() => setImporting(true)}>
            <Icon name="library" /> Import CSV
          </button>
          <button onClick={() => setCreating(true)}>
            <Icon name="plus" /> New person
          </button>
        </div>
      </div>
      <div className="directory-filters">
        <label>
          Search directory
          <input
            type="search"
            maxLength={200}
            placeholder="Name, email, title, organization, phone or notes"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOffset(0);
            }}
          />
        </label>
        <label>
          View
          <select
            value={String(archived)}
            onChange={(e) => {
              setArchived(e.target.value === "true");
              setOffset(0);
            }}
          >
            <option value="false">Current contacts</option>
            <option value="true">Archived contacts</option>
          </select>
        </label>
      </div>
      {error && (
        <p role="alert" className="error-message">
          {error} <button onClick={refresh}>Reload directory</button>
        </p>
      )}
      {loading && <p role="status">Loading directory…</p>}
      {!loading && !rows.length && !error && (
        <div className="state-panel">
          <h2>
            {query ? "No matching contacts." : "Your directory starts here."}
          </h2>
          <p>
            {query
              ? "Try a different name or contact detail."
              : "Add a person or import a CSV to build your directory."}
          </p>
        </div>
      )}
      {rows.length > 0 && (
        <>
          <div className="directory-columns" aria-hidden="true">
            <span>Person / organization</span>
            <span>Email / phone</span>
            <span>Notes</span>
            <span />
          </div>
          <ul className="directory-list">
            {rows.map((person) => (
              <li key={person.id}>
                <div className="directory-identity">
                  <span className="person-avatar" aria-hidden="true">
                    {person.title
                      .trim()
                      .split(/\s+/)
                      .slice(0, 2)
                      .map((word) => word[0])
                      .join("")}
                  </span>
                  <div>
                    <button
                      className="record-title"
                      onClick={() => onOpen(person)}
                    >
                      {person.title}
                    </button>
                    <p className="record-meta">
                      {[person.person_role, person.organization]
                        .filter(Boolean)
                        .join(" · ") || "No title or organization yet"}
                    </p>
                    {(person.details.department || person.details.location) && (
                      <p className="record-meta">
                        {[person.details.department, person.details.location]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    )}
                  </div>
                </div>
                <div className="directory-contact">
                  {person.details.email && (
                    <a
                      href={`mailto:${encodeURIComponent(person.details.email)}`}
                    >
                      {person.details.email}
                    </a>
                  )}
                  {person.details.phone && (
                    <a href={telephoneLink(person.details.phone)}>
                      Phone · {person.details.phone}
                    </a>
                  )}
                  {person.details.mobile && (
                    <a href={telephoneLink(person.details.mobile)}>
                      Mobile · {person.details.mobile}
                    </a>
                  )}
                  {!person.details.email &&
                    !person.details.phone &&
                    !person.details.mobile && (
                      <span className="muted small">
                        No contact details yet
                      </span>
                    )}
                </div>
                <p className="directory-notes">{person.notes_excerpt || "—"}</p>
                <details className="row-actions-menu">
                  <summary aria-label={`Actions for ${person.title}`}>
                    •••
                  </summary>
                  <div className="record-actions">
                    <button disabled={!!busy} onClick={() => void edit(person)}>Edit</button>
                    <button onClick={() => onOpen(person)}>Open details</button>
                    <button
                      disabled={!!busy}
                      onClick={() => void archive(person)}
                    >
                      {archived ? "Restore" : "Archive"}
                    </button>
                  </div>
                </details>
              </li>
            ))}
          </ul>
          <p className="small muted">
            {rows.length} contacts {more ? "loaded" : "shown"} · A–Z
          </p>
        </>
      )}
      {more && (
        <button disabled={loading} onClick={() => setOffset((v) => v + 50)}>
          Load more people
        </button>
      )}
      {(creating || editing) && (
        <Editor
          client={client}
          userId={userId}
          kind="person"
          item={editing ?? undefined}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            refresh();
          }}
        />
      )}
      {importing && (
        <ImportPeople
          client={client}
          onClose={() => setImporting(false)}
          onImported={refresh}
        />
      )}
    </section>
  );
}
