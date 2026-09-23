import { useEffect, useState } from "react";
import type { AppClient } from "../../platform/supabase";
import {
  getWork,
  convertReminder,
  listWork,
  patchWork,
  projectDirectory,
  swapWorkOrder,
} from "../../services/work";
import type { Kind, WorkItem, WorkSummary } from "./model";
import {
  effectiveStatus,
  labels,
  priorities,
  statuses,
  entryTypes,
} from "./model";
import { displayDate } from "./dates";
import { Detail } from "./Detail";
import { TaskMetadata } from "./TaskMetadata";
import { Editor } from "./Editor";
import { Icon } from "../../ui/Icon";

type Project = Awaited<ReturnType<typeof projectDirectory>>[number];
export function WorkList({
  client,
  userId,
  kind,
  onOpen,
  embedded = false,
  revision: externalRevision = 0,
  onChanged,
}: {
  client: AppClient;
  userId: string;
  kind: Kind;
  onOpen: (item: Pick<WorkItem, "id">) => void;
  embedded?: boolean;
  revision?: number;
  onChanged?: () => void;
}) {
  const [rows, setRows] = useState<WorkSummary[]>([]),
    [projects, setProjects] = useState<Project[]>([]);
  const [search, setSearch] = useState(""),
    [status, setStatus] = useState(kind === "task" ? "__open" : ""),
    [priority, setPriority] = useState(""),
    [archived, setArchived] = useState(false);
  const [entryType, setEntryType] = useState(""),
    [tag, setTag] = useState("");
  const [offset, setOffset] = useState(0),
    [more, setMore] = useState(false),
    [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState<string | null>(null),
    [notice, setNotice] = useState("");
  const [editor, setEditor] = useState<WorkItem | "new" | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const [pages, directory] = await Promise.all([
          Promise.all(
            Array.from({ length: offset / 50 + 1 }, (_, i) =>
              listWork(client, {
                kind,
                search,
                status: status === "__open" ? "" : status,
                openOnly: status === "__open",
                priority,
                archived,
                offset: i * 50,
                entryType,
                tag,
              }),
            ),
          ),
          kind === "task" ? projectDirectory(client) : Promise.resolve([]),
        ]);
        if (alive) {
          setRows(pages.flat());
          setProjects(directory);
          setMore(pages.at(-1)?.length === 50);
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
  }, [
    client,
    kind,
    search,
    status,
    priority,
    archived,
    offset,
    revision,
    entryType,
    tag,
    externalRevision,
  ]);
  function refresh() {
    setRevision((v) => v + 1);
  }
  async function edit(item: Pick<WorkItem, "id">) {
    if (busy) return;
    setBusy(item.id);
    setError("");
    try { setEditor(await getWork(client, item.id)); }
    catch { setError("Could not load this record for editing. Please retry."); }
    finally { setBusy(null); }
  }
  async function act(item: WorkSummary, patch: Partial<WorkItem> | "convert") {
    if (busy) return;
    setBusy(item.id);
    setError("");
    setNotice("");
    try {
      if (patch === "convert") await convertReminder(client, item);
      else await patchWork(client, item, patch);
      setNotice(
        patch !== "convert" && patch.status === "Complete"
          ? `Completed: ${item.title}`
          : `Updated: ${item.title}`,
      );
      refresh();
      onChanged?.();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(null);
    }
  }
  async function move(
    a: Pick<WorkItem, "id" | "version" | "title">,
    b: Pick<WorkItem, "id" | "version"> | undefined,
  ) {
    if (busy || !b) return;
    setBusy(a.id);
    setError("");
    setNotice("");
    try {
      await swapWorkOrder(client, a, b);
      setNotice(`Order saved: ${a.title}`);
      refresh();
      onChanged?.();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(null);
    }
  }
  const moveControls = (
    item: Pick<WorkItem, "id" | "version" | "title">,
    items: Pick<WorkItem, "id" | "version" | "title">[],
    index: number,
  ) => (
    <span className="order-controls">
      <button
        className="icon-button"
        aria-label={`Move ${item.title} up`}
        title="Move up"
        disabled={!!busy || loading || index === 0}
        onClick={() => void move(item, items[index - 1])}
      >
        <Icon name="up" />
      </button>
      <button
        className="icon-button"
        aria-label={`Move ${item.title} down`}
        title="Move down"
        disabled={!!busy || loading || index === items.length - 1}
        onClick={() => void move(item, items[index + 1])}
      >
        <Icon name="down" />
      </button>
    </span>
  );
  const renderRows = (items: WorkSummary[]) => (
    <ul className="record-list compact-list">
      {items.map((item, index) => {
        const canComplete =
          statuses(kind).includes("Complete") &&
          !["Complete", "Cancelled", "Dismissed"].includes(item.status);
        return (
          <li
            key={item.id}
            className={`${kind === "task" ? "task-row" : ""} ${item.status === "Complete" ? "is-complete" : ""}`}
          >
            {canComplete ? (
              <button
                className="completion-control"
                disabled={!!busy || loading}
                aria-label={`Complete ${item.title}`}
                title="Mark complete"
                onClick={() =>
                  void act(item, { status: "Complete", snoozed_until: null })
                }
              >
                {busy === item.id ? (
                  <span className="loading-dot" />
                ) : (
                  <Icon name="check" />
                )}
              </button>
            ) : (
              <span className="record-kind-icon">
                <Icon name={item.status === "Complete" ? "check" : kind} />
              </span>
            )}
            <div className="record-main">
              <button className="record-title" onClick={() => kind === "task" ? setDetailId(item.id) : onOpen(item)}>
                {item.title}
              </button>
              {kind === "task" ? <TaskMetadata item={item} now={now} /> : <p className="record-meta">
                {kind === "person" ? (
                  [item.person_role, item.organization]
                    .filter(Boolean)
                    .join(" · ") || "No role or organization yet"
                ) : (
                  <>
                    {effectiveStatus(item, now)} ·{" "}
                    {displayDate(item.due_date, item.remind_at)}
                    {item.status === "Snoozed" &&
                      ` · Snoozed until ${displayDate(null, item.snoozed_until)}`}
                    {kind === "journal" && ` · ${item.entry_type}`}
                  </>
                )}
              </p>}
            </div>
            {kind !== "person" && kind !== "task" && (
              <span
                className={`priority-pill priority-${item.priority.toLowerCase()}`}
              >
                {item.priority}
              </span>
            )}
            {!archived &&
              (kind === "task" || kind === "project") &&
              moveControls(item, items, index)}
            <details className="row-actions-menu">
              <summary
                aria-label={`Actions for ${item.title}`}
                title="More actions"
              >
                •••
              </summary>
              <div className="record-actions">
                {kind !== "task" && <button disabled={!!busy} onClick={() => void edit(item)}>Edit</button>}
                {kind !== "task" && <button onClick={() => onOpen(item)}>Open details</button>}
                {kind === "reminder" &&
                  !["Complete", "Dismissed"].includes(item.status) && (
                    <>
                      <button
                        disabled={!!busy}
                        onClick={() =>
                          void act(item, {
                            status: "Snoozed",
                            snoozed_until: new Date(
                              Date.now() + 3600000,
                            ).toISOString(),
                          })
                        }
                      >
                        Snooze 1 hour
                      </button>
                      <button
                        disabled={!!busy}
                        onClick={() =>
                          void act(item, {
                            status: "Dismissed",
                            snoozed_until: null,
                          })
                        }
                      >
                        Dismiss
                      </button>
                      <button
                        disabled={!!busy}
                        onClick={() => void act(item, "convert")}
                      >
                        Convert to task
                      </button>
                    </>
                  )}
                <button
                  disabled={!!busy}
                  onClick={() => void act(item, { archived: !item.archived })}
                >
                  {item.archived ? "Restore" : "Archive"}
                </button>
              </div>
            </details>
          </li>
        );
      })}
    </ul>
  );
  const GroupHeading = embedded ? "h3" : "h2";
  const groups =
    kind === "task"
      ? [
          ...projects.map((project) => ({
            id: project.id,
            title: project.title + (project.archived ? " · Archived" : ""),
            project,
            items: rows.filter((row) => row.project_id === project.id),
          })),
          {
            id: "unassigned",
            title: "No project",
            project: null,
            items: rows.filter((row) => !row.project_id),
          },
          {
            id: "unavailable",
            title: "Other projects",
            project: null,
            items: rows.filter(
              (row) =>
                row.project_id &&
                !projects.some((project) => project.id === row.project_id),
            ),
          },
        ].filter((group) => group.items.length)
      : [];
  const movableProjects = groups.flatMap((group) =>
    group.project && !group.project.archived ? [group.project] : [],
  );
  return (
    <section
      className={`work-list-view ${embedded ? "embedded-work-list" : ""}`}
      aria-label={embedded ? "All open tasks" : labels[kind]}
    >
      {!embedded && (
        <div className="section-heading">
          <div>
            <p className="eyebrow">
              YOUR WORKSPACE / {labels[kind].toUpperCase()}
            </p>
            <h1 tabIndex={-1}>{labels[kind]}</h1>
          </div>
          <button onClick={() => setEditor("new")}>
            <Icon name="plus" /> New {kind}
          </button>
        </div>
      )}
      {!embedded && (
        <div className="filters">
          <label>
            Search titles and notes
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setOffset(0);
              }}
            />
          </label>
          <label>
            Filter status
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setOffset(0);
              }}
            >
              {kind === "task" && <option value="__open">Open tasks</option>}
              <option value="">All statuses</option>
              {statuses(kind).map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Filter priority
            <select
              value={priority}
              onChange={(e) => {
                setPriority(e.target.value);
                setOffset(0);
              }}
            >
              <option value="">All priorities</option>
              {priorities.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
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
              <option value="false">Current</option>
              <option value="true">Archived</option>
            </select>
          </label>
        </div>
      )}
      {kind === "journal" && (
        <div className="form-grid">
          <label>
            Filter entry type
            <select
              value={entryType}
              onChange={(e) => {
                setEntryType(e.target.value);
                setOffset(0);
              }}
            >
              <option value="">All entry types</option>
              {entryTypes.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label>
            Filter tag
            <input
              value={tag}
              onChange={(e) => {
                setTag(e.target.value);
                setOffset(0);
              }}
              placeholder="Exact tag"
            />
          </label>
        </div>
      )}
      {error && (
        <p role="alert" className="error-message">
          {error} <button onClick={refresh}>Reload list</button>
        </p>
      )}
      {notice && (
        <p role="status" className="list-notice">
          {notice}
        </p>
      )}
      {loading && (
        <p role="status" className="small muted">
          Loading…
        </p>
      )}
      {!loading && !rows.length && !error && (
        <div className="state-panel">
          <h2>No matching {labels[kind].toLowerCase()}.</h2>
          <p className="muted">
            {embedded ? "No open tasks." : "Create one or adjust your filters."}
          </p>
        </div>
      )}
      <div
        className={embedded ? "task-scroll-region" : "list-content"}
        tabIndex={embedded ? 0 : undefined}
        role={embedded ? "region" : undefined}
        aria-label={embedded ? "Scrollable tasks" : undefined}
      >
        {kind === "task"
          ? groups.map((group) => (
              <section
                className="task-group"
                key={group.id}
                aria-label={group.title}
              >
                <div className="task-group-heading">
                  <GroupHeading className="task-group-title">
                    <Icon name="project" />
                    {group.title}
                    <span>
                      {group.items.length}
                      {more ? " loaded" : ""}
                    </span>
                  </GroupHeading>
                  {!archived &&
                    group.project &&
                    !group.project.archived &&
                    moveControls(
                      group.project,
                      movableProjects,
                      movableProjects.findIndex((p) => p.id === group.id),
                    )}
                </div>
                {renderRows(group.items)}
              </section>
            ))
          : renderRows(rows)}
        {more && (
          <button
            className="load-more"
            disabled={loading}
            onClick={() => setOffset((v) => v + 50)}
          >
            Load more {labels[kind].toLowerCase()}
          </button>
        )}
      </div>
      {!embedded && rows.length > 0 && (
        <p className="small muted list-count">
          {rows.length} {more ? "loaded" : "shown"}
          {(kind === "task" || kind === "project") && !archived
            ? " · Use the arrows to save your preferred order."
            : ""}
        </p>
      )}
      {detailId && <Detail key={detailId} modal client={client} userId={userId} id={detailId} onClose={() => setDetailId(null)} onChanged={() => { refresh(); onChanged?.(); }} />}
      {editor && (
        <Editor
          client={client}
          userId={userId}
          kind={kind}
          item={editor === "new" ? undefined : editor}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            refresh();
            onChanged?.();
          }}
        />
      )}
    </section>
  );
}
