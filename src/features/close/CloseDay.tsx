import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppClient } from "../../platform/supabase";
import { applyDayClose, loadDayClose } from "../../services/close";
import { FlaggedMail } from "../mail/FlaggedMail";
import { displayDate } from "../work/dates";
import {
  addDays,
  emptyCounts,
  etDate,
  rollDate,
  rollLabel,
  type CloseAction,
  type CloseCounts,
  type CloseItem,
  type DayClose,
  type Proposal,
} from "./rules";

type Row = CloseItem & { overdue_days?: number; proposal?: Proposal };
const dueText = (item: Row) =>
  item.snoozed_until && item.status === "Snoozed"
    ? `Snoozed until ${displayDate(null, item.snoozed_until)}`
    : item.remind_at
      ? displayDate(null, item.remind_at)
      : displayDate(item.due_date);
const kindLabel = { task: "Task", reminder: "Reminder", waiting: "Waiting On" } as const;
const noop = () => undefined;

export function CloseDay({
  client,
  userId,
  onChanged,
  onNavigate,
}: {
  client: AppClient;
  userId: string;
  onChanged: () => void;
  onNavigate: (page: "workspace") => void;
}) {
  const [date] = useState(() => etDate(new Date()));
  const [data, setData] = useState<DayClose | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(""),
    [counts, setCounts] = useState<CloseCounts>(emptyCounts),
    [first, setFirst] = useState<string | null>(null),
    [picking, setPicking] = useState<string | null>(null),
    [pickDate, setPickDate] = useState(""),
    [receipt, setReceipt] = useState<{ counts: CloseCounts; first: string | null } | null>(null),
    [revision, setRevision] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    let alive = true;
    loadDayClose(client, userId, date)
      .then((result) => {
        if (!alive) return;
        setData(result);
        setError("");
      })
      .catch((caught: Error) => alive && setError(caught.message));
    return () => {
      alive = false;
    };
  }, [client, userId, date, revision]);
  const reload = useCallback(() => setRevision((v) => v + 1), []);
  const bump = (key: keyof CloseCounts, by = 1) => setCounts((c) => ({ ...c, [key]: c[key] + by }));

  async function act(item: Row, op: CloseAction["op"], target?: string) {
    if (busy) return;
    setBusy(item.id);
    setError("");
    setNotice("");
    try {
      const action: CloseAction = { id: item.id, version: item.version, op, ...(target ? { date: target } : {}) };
      await applyDayClose(client, userId, date, { actions: [action] });
      bump(op === "done" ? "done" : op === "date" ? "rolled" : "dropped");
      setNotice(
        op === "done"
          ? `Done: ${item.title}`
          : op === "drop"
            ? `Dropped (archived): ${item.title}`
            : `Moved to ${displayDate(target ?? null)}: ${item.title}`,
      );
      setData((d) =>
        d
          ? {
              ...d,
              open: d.open.filter((i) => i.id !== item.id),
              stale: d.stale.filter((i) => i.id !== item.id),
              first_candidates: d.first_candidates.filter((i) => i.id !== item.id),
              done: op === "done" ? [{ ...item, completed_at: new Date().toISOString() } as CloseItem, ...d.done] : d.done,
            }
          : d,
      );
      if (first === item.id) setFirst(null);
      setPicking(null);
      onChanged();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function finish() {
    if (busy || !data) return;
    setBusy("finish");
    setError("");
    try {
      await applyDayClose(client, userId, date, { first, finish: true, counts });
      setReceipt({ counts, first: first ? (data.first_candidates.find((c) => c.id === first)?.title ?? null) : null });
      onChanged();
      requestAnimationFrame(() => heading.current?.focus());
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy("");
    }
  }
  const tomorrow = useMemo(() => rollDate(date), [date]);
  const rowActions = (item: Row) => (
    <div className="close-actions" role="group" aria-label={`Actions for ${item.title}`}>
      <button disabled={!!busy} onClick={() => void act(item, "done")}>Done</button>
      <button disabled={!!busy} onClick={() => void act(item, "date", tomorrow)}>{rollLabel(date)}</button>
      <button disabled={!!busy} aria-expanded={picking === item.id} onClick={() => { setPicking(picking === item.id ? null : item.id); setPickDate(addDays(date, 7)); }}>Pick date</button>
      <button disabled={!!busy} onClick={() => void act(item, "drop")}>Drop</button>
    </div>
  );
  const datePicker = (item: Row) =>
    picking === item.id && (
      <form className="close-date" onSubmit={(event) => { event.preventDefault(); if (pickDate) void act(item, "date", pickDate); }}>
        <label>New date for {item.title}<input type="date" required min={date} value={pickDate} onChange={(e) => setPickDate(e.target.value)} /></label>
        <button className="btn btn--primary" disabled={!!busy || !pickDate}>Move</button>
      </form>
    );
  const meta = (item: Row) => (
    <p className="record-meta">
      {kindLabel[item.kind]} · {item.priority !== "Normal" ? `${item.priority} · ` : ""}
      {dueText(item)}
      {item.overdue_days ? ` · ${item.overdue_days} day${item.overdue_days === 1 ? "" : "s"} overdue` : ""}
    </p>
  );

  if (receipt)
    return (
      <section className="close-day" aria-labelledby="close-title">
        <h1 id="close-title" tabIndex={-1} ref={heading}>Day closed</h1>
        <p className="close-receipt" role="status">
          {receipt.counts.done} done · {receipt.counts.rolled} moved · {receipt.counts.dropped} dropped · {receipt.counts.converted} converted.
          {receipt.first ? ` First thing tomorrow: ${receipt.first}.` : " No first item chosen."}
        </p>
        <p className="muted">Tomorrow morning’s SITREP starts from this.</p>
        <button className="btn btn--primary" onClick={() => onNavigate("workspace")}>Back to Work Day</button>
      </section>
    );

  return (
    <section className="close-day" aria-labelledby="close-title" aria-busy={!data && !error}>
      <div className="section-heading">
        <div>
          <p className="eyebrow">{displayDate(date)}</p>
          <h1 id="close-title" tabIndex={-1} ref={heading}>Close the Day</h1>
        </div>
        <button className="btn" disabled={!!busy} onClick={reload}>Reload</button>
      </div>
      <p className="muted">Nothing changes until you tap. Drop archives a record; it never deletes it.</p>
      {error && (
        <p role="alert" className="error-message">
          {error} <button onClick={reload}>Reload Close the Day</button>
        </p>
      )}
      {notice && <p role="status" className="list-notice">{notice}</p>}
      {!data && !error && <p role="status" className="small muted">Loading…</p>}
      {data && (
        <>
          <section className="close-section" aria-labelledby="close-done">
            <h2 id="close-done" className="label">Done today · {data.done.length}</h2>
            {data.done.length ? (
              <ul className="link-rows">{data.done.map((i) => <li key={i.id}>{i.title} <span className="muted">· {kindLabel[i.kind]}</span></li>)}</ul>
            ) : (
              <p className="muted small">Nothing completed yet today.</p>
            )}
          </section>

          <section className="close-section" aria-labelledby="close-open">
            <h2 id="close-open" className="label label--accent">Still open · {data.open.length}</h2>
            {data.open.length ? (
              <ul className="close-list">
                {data.open.map((item) => (
                  <li key={item.id}>
                    <div><strong>{item.title}</strong>{meta(item)}</div>
                    {rowActions(item)}
                    {datePicker(item)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small">Nothing due today or overdue. Nice.</p>
            )}
          </section>

          <section className="close-section" aria-labelledby="close-stale">
            <h2 id="close-stale" className="label">Stale · {data.stale.length}</h2>
            <p className="muted small">More than {7} days overdue, or reminders past due and untouched. Suggestions are fixed rules, not guesses.</p>
            {data.stale.length ? (
              <ul className="close-list">
                {data.stale.map((item) => (
                  <li key={item.id}>
                    <div>
                      <strong>{item.title}</strong>
                      {meta(item)}
                      <p className="close-proposal">Suggested: {item.proposal.reason}.</p>
                    </div>
                    <div className="close-actions" role="group" aria-label={`Suggested action for ${item.title}`}>
                      {item.proposal.op === "drop" && <button className="btn btn--primary" disabled={!!busy} onClick={() => void act(item, "drop")}>Drop it</button>}
                      {item.proposal.op === "date" && <button className="btn btn--primary" disabled={!!busy} onClick={() => void act(item, "date", item.proposal.date!)}>Move to {displayDate(item.proposal.date!)}</button>}
                    </div>
                    {rowActions(item)}
                    {datePicker(item)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small">Nothing stale.</p>
            )}
          </section>

          <section className="close-section" aria-label="Flagged mail">
            <FlaggedMail
              client={client}
              revision={revision}
              onCount={noop}
              onChanged={onChanged}
              onCaptured={(action) => bump(action === "dismissed" ? "dropped" : "converted")}
            />
          </section>

          <section className="close-section" aria-labelledby="close-first">
            <h2 id="close-first" className="label">Tomorrow’s first item</h2>
            {data.first_candidates.length ? (
              <fieldset className="close-first">
                <legend className="visually-hidden">Choose the task to start with on {displayDate(tomorrow)}</legend>
                {data.first_candidates.slice(0, 8).map((task) => (
                  <label key={task.id}>
                    <input type="radio" name="first" checked={first === task.id} onChange={() => setFirst(task.id)} />
                    <span>{task.title}<small>{task.priority !== "Normal" ? `${task.priority} · ` : ""}{displayDate(task.due_date)}</small></span>
                  </label>
                ))}
                {first && <button type="button" className="btn btn--ghost" onClick={() => setFirst(null)}>Clear choice</button>}
              </fieldset>
            ) : (
              <p className="muted small">No open tasks to choose from.</p>
            )}
          </section>

          <div className="actions close-finish">
            <button className="btn btn--primary" disabled={!!busy} onClick={() => void finish()}>
              {busy === "finish" ? "Saving…" : "Finish the day"}
            </button>
            <p className="muted small" role="status">
              {counts.done} done · {counts.rolled} moved · {counts.dropped} dropped · {counts.converted} converted so far
            </p>
          </div>
        </>
      )}
    </section>
  );
}
