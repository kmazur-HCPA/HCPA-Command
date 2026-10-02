import { useCallback, useEffect, useRef, useState } from "react";
import type { AppClient } from "../../platform/supabase";
import {
  addStandupItem,
  listStandupHistory,
  listStandupWeek,
  removeStandupItem,
  setStandupDone,
  updateStandupItem,
} from "../../services/standup";
import type { StandupItem } from "../../services/standup";
import { Icon } from "../../ui/Icon";
import { mondayLabel, weekRangeLabel, weekStart } from "./model";

// Work Day ledger section: things to raise at Monday's stand-up. Blank every Tuesday.
export function Standup({ client, userId, date, revision }: { client: AppClient; userId: string; date: string; revision: number }) {
  const week = weekStart(date);
  const [items, setItems] = useState<StandupItem[] | null>(null),
    [draft, setDraft] = useState(""),
    [editing, setEditing] = useState<string | null>(null),
    [editText, setEditText] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [history, setHistory] = useState(false),
    [reload, setReload] = useState(0);
  const refresh = useCallback(() => setReload((v) => v + 1), []);
  useEffect(() => {
    let alive = true;
    listStandupWeek(client, week)
      .then((rows) => alive && (setItems(rows), setError("")))
      .catch((caught: Error) => alive && setError(caught.message));
    return () => {
      alive = false;
    };
  }, [client, week, reload, revision]);

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
      refresh();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const add = (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.trim()) return;
    void run(async () => {
      await addStandupItem(client, userId, week, draft);
      setDraft("");
    });
  };
  const save = (id: string) =>
    void run(async () => {
      await updateStandupItem(client, id, editText);
      setEditing(null);
    });

  return (
    <section aria-labelledby="standup-h" className="standup">
      <div className="wd-heading">
        <h2 id="standup-h" className="label">
          Stand-up · {mondayLabel(week)}
        </h2>
        <button className="wd-link" onClick={() => setHistory(true)}>
          Past weeks
        </button>
      </div>
      {items && items.length === 0 && (
        <p className="wd-note standup-empty">Nothing yet. Add what you want to raise on Monday. This list starts fresh every Tuesday.</p>
      )}
      <ul className="standup-list">
        {[...(items ?? [])].sort((a, b) => Number(a.done) - Number(b.done)).map((item) => (
          <li key={item.id} className="row" style={{ opacity: item.done ? 0.45 : 1 }}>
            {editing === item.id ? (
              <form
                className="standup-edit"
                onSubmit={(e) => {
                  e.preventDefault();
                  save(item.id);
                }}
              >
                <input
                  autoFocus
                  aria-label="Edit stand-up item"
                  maxLength={300}
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={(e) => e.key === "Escape" && setEditing(null)}
                />
                <button className="btn btn--primary" disabled={busy}>
                  Save
                </button>
              </form>
            ) : (
              <>
                <button
                  className="check"
                  aria-pressed={item.done}
                  aria-label={`${item.done ? "Mark not done" : "Mark done"}: ${item.body}`}
                  disabled={busy}
                  onClick={() => void run(() => setStandupDone(client, item.id, !item.done))}
                >
                  {item.done && <Icon name="check" />}
                </button>
                <button
                  className="standup-text"
                  style={{ textDecoration: item.done ? "line-through" : "none" }}
                  title="Edit"
                  onClick={() => {
                    setEditing(item.id);
                    setEditText(item.body);
                  }}
                >
                  {item.body}
                  {item.carried_from && <span className="meta"> · carried over</span>}
                </button>
                <button
                  className="row-actions standup-remove"
                  aria-label={`Remove: ${item.body}`}
                  disabled={busy}
                  onClick={() => void run(() => removeStandupItem(client, item.id))}
                >
                  <Icon name="close" />
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      <form className="standup-add" onSubmit={add}>
        <label>
          <span className="visually-hidden">Add to stand-up</span>
          <input
            placeholder="Add something to bring up…"
            maxLength={300}
            value={draft}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
          />
        </label>
      </form>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {history && <History client={client} userId={userId} week={week} onClose={() => setHistory(false)} onCarried={refresh} />}
    </section>
  );
}

function History({
  client,
  userId,
  week,
  onClose,
  onCarried,
}: {
  client: AppClient;
  userId: string;
  week: string;
  onClose: () => void;
  onCarried: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [past, setPast] = useState<StandupItem[] | null>(null),
    [current, setCurrent] = useState<StandupItem[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [reload, setReload] = useState(0);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    let alive = true;
    Promise.all([listStandupHistory(client, week), listStandupWeek(client, week)])
      .then(([old, now]) => alive && (setPast(old), setCurrent(now)))
      .catch((caught: Error) => alive && setError(caught.message));
    return () => {
      alive = false;
    };
  }, [client, week, reload]);
  const carried = new Set(current.map((c) => c.carried_from).filter(Boolean));
  const weeks = new Map<string, StandupItem[]>();
  for (const item of past ?? []) weeks.set(item.week_start, [...(weeks.get(item.week_start) ?? []), item]);

  async function carry(items: StandupItem[]) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      for (const item of items) await addStandupItem(client, userId, week, item.body, item.id);
      setReload((v) => v + 1);
      onCarried();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog ref={dialog} className="side-dialog" aria-label="Past stand-up weeks" onCancel={onClose}>
      <div className="dialog-heading">
        <h2>Past stand-up weeks</h2>
        <button aria-label="Close past weeks" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <p className="muted small">Carry an item into this week to bring it up again. The original stays where it was. Items you marked done are crossed out; Carry over all skips them.</p>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {past && weeks.size === 0 && <p className="wd-note">No earlier weeks yet.</p>}
      {[...weeks.entries()].map(([start, rows]) => {
        const left = rows.filter((r) => !carried.has(r.id) && !r.done);
        return (
          <section key={start} className="standup-week" aria-label={`Week of ${weekRangeLabel(start)}`}>
            <div className="wd-heading">
              <h3 className="label">{weekRangeLabel(start)}</h3>
              {left.length > 1 && (
                <button className="wd-link" disabled={busy} onClick={() => void carry(left)}>
                  Carry over all
                </button>
              )}
            </div>
            <ul className="standup-list">
              {rows.map((r) => (
                <li key={r.id} className="row">
                  <span className="standup-text" style={{ textDecoration: r.done ? "line-through" : "none", opacity: r.done ? 0.6 : 1 }}>{r.body}</span>
                  {carried.has(r.id) ? (
                    <span className="meta">Carried over</span>
                  ) : (
                    <button className="btn" disabled={busy} aria-label={`Carry over: ${r.body}`} onClick={() => void carry([r])}>
                      Carry over
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </dialog>
  );
}
