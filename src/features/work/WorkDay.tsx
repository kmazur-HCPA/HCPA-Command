import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { AppClient } from "../../platform/supabase";
import { getWork, listWork, patchWork, projectDirectory, workDay } from "../../services/work";
import { flaggedMail, type FlaggedMail as Flagged } from "../../services/mail";
import { helixSummary } from "../../services/helix";
import type { HelixItem } from "../helix/model";
import { effectiveStatus } from "./model";
import type { Kind, WorkItem, WorkSummary } from "./model";
import { displayDate, today } from "./dates";
import {
  clock,
  dueMeta,
  etParts,
  headline,
  linePct,
  meetingMarks,
  overdueTag,
  partOfDay,
  scheduleLine,
  taskMeta,
  weekStrip,
  DAY_LIMIT,
  daysBetween,
} from "./dayModel";
import { useAgenda } from "../microsoft/useAgenda";
import { outlookLink } from "../microsoft/model";
import { FlaggedMail } from "../mail/FlaggedMail";
import { SitrepPanel } from "../sitrep/SitrepPanel";
import { useSitrep } from "../sitrep/useSitrep";
import { boldParts } from "../sitrep/support";
import { reconcileSection } from "../sitrep/reconcile";
import { Icon } from "../../ui/Icon";
import { Standup } from "../standup/Standup";

type NowItem = {
  key: string;
  recordId: string | null;
  tag: string;
  tone: "accent" | "overdue" | "plain";
  title: ReactNode;
  why: string;
  source: string;
  struck: boolean;
};

// Per-device, per-day conveniences (snoozed Now items, hidden Tidy up prompts).
function useDaily(name: string, date: string) {
  const key = `command.workday.${name}.${date}`;
  const [ids, setIds] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? "[]") as string[];
    } catch {
      return [];
    }
  });
  const add = (id: string) =>
    setIds((old) => {
      const next = [...old, id];
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* Storage can be blocked; the choice still holds for this visit. */
      }
      return next;
    });
  return [ids, add] as const;
}

const priorityTab = "Priority";
const ignoreCount = () => undefined; // Stable, so FlaggedMail does not refetch on every render.

const label = (children: ReactNode, id: string, accent = false) => (
  <h2 id={id} className={accent ? "label label--accent" : "label"}>
    {children}
  </h2>
);

export function WorkDay({
  client,
  userId,
  revision,
  onOpen,
  onNavigate,
}: {
  client: AppClient;
  userId: string;
  revision: number;
  onOpen: (item: Pick<WorkItem, "id">) => void;
  onNavigate: (kind: Kind) => void;
}) {
  const [expandedDays, setExpandedDays] = useState<string[]>([]);
  const [data, setData] = useState<Awaited<ReturnType<typeof workDay>> | null>(null),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0),
    [now, setNow] = useState(() => Date.now()),
    [busy, setBusy] = useState<string | null>(null),
    [notice, setNotice] = useState(""),
    [focusMode, setFocusMode] = useState(false),
    [tidyOpen, setTidyOpen] = useState(true),
    [localDone, setLocalDone] = useState<string[]>([]),
    [sitrepOpen, setSitrepOpen] = useState(false),
    [flaggedOpen, setFlaggedOpen] = useState(false),
    [flagged, setFlagged] = useState<Flagged | null>(null),
    [openTasks, setOpenTasks] = useState<{ tasks: WorkSummary[]; projects: Map<string, string> } | null>(null),
    [area, setArea] = useState(""),
    [helix, setHelix] = useState<HelixItem | null>(null);
  const date = today(new Date(now));
  const [snoozed, snooze] = useDaily("snoozed", date),
    [doneIds, markDone] = useDaily("done", date),
    [doneAtLoad] = useState(doneIds),
    [leftAlone, leaveIt] = useDaily("tidy", date);
  const sitrep = useSitrep(client, date),
    agenda = useAgenda(client, date),
    sitrepButton = useRef<HTMLButtonElement>(null);
  const refreshMinute = Math.floor(now / 60000);
  const et = etParts(now);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    let alive = true;
    workDay(client, date)
      .then((rows) => {
        if (alive) {
          setData(rows);
          setError("");
        }
      })
      .catch((caught) => {
        if (alive) setError((caught as Error).message);
      });
    return () => {
      alive = false;
    };
  }, [client, date, revision, retry, refreshMinute]);
  useEffect(() => {
    let alive = true;
    Promise.all([listWork(client, { kind: "task", openOnly: true }), projectDirectory(client)])
      .then(([tasks, projects]) => {
        if (alive) setOpenTasks({ tasks, projects: new Map(projects.map((p) => [p.id, p.title])) });
      })
      .catch(() => {
        if (alive) setOpenTasks({ tasks: [], projects: new Map() });
      });
    return () => {
      alive = false;
    };
  }, [client, revision, retry]);
  const loadFlagged = useCallback(() => {
    flaggedMail(client)
      .then(setFlagged)
      .catch(() => setFlagged(null));
  }, [client]);
  useEffect(() => {
    loadFlagged();
    const timer = setInterval(() => document.visibilityState === "visible" && loadFlagged(), 60000);
    return () => clearInterval(timer);
  }, [loadFlagged, revision]);
  useEffect(() => {
    let alive = true;
    helixSummary(client)
      .then((summary) => {
        const all = Object.values(summary.sections).flatMap((s) => s.records);
        const latest = all.filter((r) => r.updated_at).sort((a, b) => Date.parse(b.updated_at!) - Date.parse(a.updated_at!))[0];
        if (alive) setHelix(latest ?? null);
      })
      .catch(() => undefined); // Not connected or unavailable: the feed simply omits Helix.
    return () => {
      alive = false;
    };
  }, [client]);

  // Completes the record behind a task (the same change as completing it on Tasks).
  async function completeRecord(id: string) {
    const record = await getWork(client, id);
    await patchWork(client, record, { status: "Complete", snoozed_until: null });
    setNotice("Task completed");
    setRetry((v) => v + 1);
  }
  async function complete(item: NowItem) {
    if (busy) return;
    setBusy(item.key);
    setError("");
    try {
      if (item.recordId) await completeRecord(item.recordId);
      markDone(item.key);
      setLocalDone((old) => [...old, item.key]);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(null);
    }
  }
  async function completeOpen(task: WorkSummary) {
    if (busy) return;
    setBusy(task.id);
    setError("");
    try {
      await completeRecord(task.id);
      setOpenTasks((old) => (old ? { ...old, tasks: old.tasks.filter((t) => t.id !== task.id) } : old));
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(null);
    }
  }

  // ---- Now: the SITREP's Next list, or chosen priorities and due tasks when there is no SITREP today.
  const run = sitrep.state?.isToday ? sitrep.state.run : null;
  const nowItems: NowItem[] = useMemo(() => {
    if (run?.payload) {
      const ctx = { now, today: date, records: sitrep.live.records, openFlagged: sitrep.live.openFlagged };
      return reconcileSection(run.payload.next, ctx)
        .map((r): NowItem => {
          const it = r.item;
          const recordId = it.refs?.find((x) => x.kind === "record" && !r.removedRecords.has(x.id))?.id ?? null;
          let tag = "",
            tone: NowItem["tone"] = "plain";
          if (r.marker === "overdue") {
            tag = it.due_date ? overdueTag(it.due_date, date) : "Overdue";
            tone = "overdue";
          } else if (r.marker === "due_today") {
            tag = "Due today";
            tone = "accent";
          } else if (r.marker === "conflict") {
            tag = "Conflict";
            tone = "overdue";
          } else if (r.when) {
            tag = r.when[0]!.toUpperCase() + r.when.slice(1);
            tone = "accent";
          } else if (it.due_date && daysBetween(date, it.due_date) === 1) tag = "Due tomorrow";
          return {
            key: recordId ? `r:${recordId}` : `t:${it.text}`,
            recordId,
            tag,
            tone,
            title: boldParts(it.text),
            why: it.reason ?? "",
            source: it.refs?.map((x) => x.label).filter(Boolean).join(" · ") ?? "",
            struck: r.struck,
          };
        });
    }
    if (!data) return [];
    const seen = new Set<string>();
    return [...data.focus, ...data.due]
      .filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)))
      .map((t): NowItem => {
        const overdue = !!t.due_date && t.due_date < date;
        return {
          key: `r:${t.id}`,
          recordId: t.id,
          tag: overdue ? overdueTag(t.due_date!, date) : t.focus_slot ? "Chosen priority" : "Due today",
          tone: overdue ? "overdue" : "accent",
          title: t.title,
          why: `${t.priority} priority · ${t.status}`,
          source: "Task",
          struck: false,
        };
      });
  }, [run, data, now, date, sitrep.live]);
  // Done items settle for this visit, then stay gone: finished earlier, or completed elsewhere.
  const isDone = (n: NowItem) => n.struck || localDone.includes(n.key);
  const shown = nowItems
    .filter((n) => !snoozed.includes(n.key) && !doneAtLoad.includes(n.key) && !(n.struck && !localDone.includes(n.key)))
    .slice(0, 3);
  const cleared = nowItems.filter((n) => isDone(n) || doneIds.includes(n.key)).length;
  const pending = shown.filter((n) => !isDone(n)).length;

  // ---- Day line and week strip from Outlook.
  const events = agenda.data?.events ?? [];
  const pct = linePct(et.minutes);
  const inHours = et.minutes >= 8 * 60 && et.minutes <= 17 * 60;
  const todayMeetings = agenda.data
    ? events.filter((e) => !e.allDay && etParts(e.start).date === date).length
    : null;
  const lines = headline(todayMeetings, pending, partOfDay(et.minutes));

  // ---- Replies you owe.
  const owed = (flagged?.messages ?? []).filter((m) => !m.capture);
  const tiles = [...owed]
    .sort((a, b) => Number(b.importance === "high") - Number(a.importance === "high") || Date.parse(a.received_at) - Date.parse(b.received_at))
    .slice(0, 2);

  // ---- Keeping track.
  const reminders = (data?.reminders ?? []).filter((r) => effectiveStatus(r, now) === "Active");
  const waiting = data?.waiting ?? [];

  // ---- Open work by area (project).
  // The first tab is Priority (High and Critical tasks from every area); the rest are the largest areas.
  const groups = useMemo(() => {
    const tasks = openTasks?.tasks ?? [];
    const map = new Map<string, WorkSummary[]>();
    for (const t of tasks) {
      const name = (t.project_id && openTasks!.projects.get(t.project_id)) || "No project";
      map.set(name, [...(map.get(name) ?? []), t]);
    }
    const areas = [...map.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 4);
    const urgent = tasks.filter((t) => t.priority === "Critical" || t.priority === "High");
    return [[priorityTab, urgent] as [string, WorkSummary[]], ...areas];
  }, [openTasks]);
  const activeArea = groups.find(([n]) => n === area) ?? groups[0]!;
  const rank = (t: WorkSummary) => (t.priority === "Critical" ? 0 : 1);
  const areaTasks = [...activeArea[1]]
    .sort((a, b) => (activeArea[0] === priorityTab ? rank(a) - rank(b) : 0) || (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"))
    .slice(0, activeArea[0] === priorityTab ? 6 : 4);

  // ---- Tidy up: prompts that open the record for review. Nothing is edited from here.
  const tidy: { id: string; text: string; record: string }[] = [];
  for (const t of data?.due ?? []) {
    if (t.due_date && daysBetween(t.due_date, date) >= 3 && tidy.length < 2)
      tidy.push({ id: `late:${t.id}`, text: `“${t.title}” is ${daysBetween(t.due_date, date)} days overdue. Still open?`, record: t.id });
  }
  if (data && data.counts[3] === 0) {
    const stuck = (openTasks?.tasks ?? []).find((t) => t.status === "Waiting");
    if (stuck) tidy.push({ id: `wait:${stuck.id}`, text: `“${stuck.title}” is marked Waiting, yet Waiting On is empty. Track who you’re waiting on?`, record: stuck.id });
  }
  const tidyShown = tidy.filter((t) => !leftAlone.includes(t.id));

  const refreshed = run?.generated_at ? clock(run.generated_at) : null;
  const synced = agenda.data ? clock(agenda.data.retrievedAt) : null;
  const dim = focusMode ? " is-dimmed" : "";

  return (
    <div className="wd">
      <div className="wd-main">
        <div className="wd-top rise d1">
          <p className="meta wd-date">
            {new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "long", month: "long", day: "numeric" })
              .format(now)
              .toUpperCase()}{" "}
            · {partOfDay(et.minutes).toUpperCase()}
          </p>
          <button className="btn wd-focus" aria-pressed={focusMode} onClick={() => setFocusMode((v) => !v)}>
            <Icon name="focus" />
            {focusMode ? "Focus on" : "Focus"}
          </button>
        </div>

        <h1 tabIndex={-1} className="wd-headline rise d2" aria-label="Work Day">
          {lines.calendar} <span>{lines.focus}</span>
        </h1>
        <p className="wd-lead rise d3">
          {run?.payload ? (
            boldParts(run.payload.now)
          ) : sitrep.state && !sitrep.state.isToday ? (
            "No SITREP yet today. Your chosen priorities and due tasks are below."
          ) : sitrep.error ? (
            "SITREP is unavailable right now. Your chosen priorities and due tasks are below."
          ) : (
            "Bringing your day into focus…"
          )}{" "}
          <button className="wd-link" ref={sitrepButton} aria-haspopup="dialog" aria-expanded={sitrepOpen} onClick={() => setSitrepOpen(true)}>
            Open the full SITREP
          </button>
        </p>

        {error && (
          <p role="alert" className="error-message">
            {error} <button onClick={() => setRetry((v) => v + 1)}>Retry Work Day</button>
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

        <div className="wd-dayline rise d3">
          <div className="wd-dayline-top meta">
            <span>{agenda.error ? "Calendar unavailable" : agenda.data ? scheduleLine(events, now) : "Checking your calendar…"}</span>
            <span>{pending === 0 ? (data || run ? "All clear" : "") : `${pending} to clear`}{cleared > 0 && pending > 0 ? ` · ${cleared} done` : cleared > 0 ? ` · ${cleared} done today` : ""}</span>
          </div>
          <div className="wd-track" role="img" aria-label={`Day line, 8 AM to 5 PM. ${inHours ? `It is ${clock(new Date(now).toISOString())}.` : ""}`}>
            <div className="wd-track-base" />
            <div className="wd-track-fill" style={{ width: `${pct}%` }}>
              <div className="grow" />
            </div>
            {meetingMarks(events, date).map((m) => (
              <span key={m.id} className="wd-mark" style={{ left: `${m.pct}%` }} title={m.label} />
            ))}
            {inHours && (
              <div className="wd-now-dot" style={{ left: `${pct}%` }}>
                <i className="ring" />
                <i />
              </div>
            )}
          </div>
          <div className="wd-hours meta" aria-hidden="true">
            <span>8 AM</span>
            <span>11</span>
            <span>2 PM</span>
            <span>5 PM</span>
          </div>
        </div>

        <section aria-labelledby="now-h" className="wd-section">
          {label("NOW", "now-h", true)}
          {!data && !error && !run && <p role="status" className="meta">Loading…</p>}
          <div className="wd-now">
            {shown.map((n, i) => {
              const done = isDone(n);
              return (
                <div key={n.key} className={`row rise d${i + 4}`} style={{ opacity: done ? 0.45 : 1 }}>
                  <button
                    className="check"
                    aria-pressed={done}
                    disabled={done || busy === n.key}
                    aria-label={`${done ? "Done" : "Mark done"}: ${typeof n.title === "string" ? n.title : n.key.replace(/^s\d+:/, "").replaceAll("**", "")}`}
                    onClick={() => void complete(n)}
                  >
                    {done && <Icon name="check" />}
                  </button>
                  <div className="wd-now-body">
                    <div className="meta">
                      <span>{String(i + 1).padStart(2, "0")}</span>{" "}
                      {n.tag && <span className={n.tone === "overdue" ? "meta--overdue" : n.tone === "accent" ? "meta--accent" : ""}>{n.tag}</span>}
                    </div>
                    <div className="wd-title" style={{ textDecoration: done ? "line-through" : "none" }}>
                      {n.title}
                    </div>
                    {n.why && <div className="wd-why">{n.why}</div>}
                    {n.source && <div className="wd-source">{n.source}</div>}
                  </div>
                  <div className="row-actions wd-acts">
                    {n.recordId && (
                      <button className="btn btn--ghost" onClick={() => onOpen({ id: n.recordId! })}>
                        Open
                      </button>
                    )}
                    <button className="btn btn--ghost" onClick={() => snooze(n.key)}>
                      Snooze
                    </button>
                  </div>
                </div>
              );
            })}
            {data && shown.length === 0 && (
              <p className="wd-empty">
                <strong>Nothing needs you right now.</strong> Choose up to three priorities in Tasks, or capture something new from the bar above.
              </p>
            )}
          </div>
        </section>

        <div className={`wd-dim${dim}`}>
          <section aria-labelledby="owed-h" className="wd-section">
            <div className="wd-heading">
              {label("REPLIES YOU OWE", "owed-h")}
              {flagged && (
                <button className="wd-link" onClick={() => setFlaggedOpen(true)}>
                  {owed.length} flagged in Outlook
                </button>
              )}
            </div>
            {!flagged ? (
              <p className="wd-empty">Flagged email isn’t available. Check Microsoft 365 in Settings.</p>
            ) : tiles.length === 0 ? (
              <p className="wd-empty">
                <strong>No replies owed.</strong> Flag a message in Outlook and it shows up here.
              </p>
            ) : (
              <div className="wd-tiles">
                {tiles.map((m) => {
                  const href = outlookLink(m.url);
                  const body = (
                    <>
                      <div className="wd-tile-name">{m.sender}</div>
                      <div className="wd-tile-subject">{m.subject}</div>
                      <div className={`meta ${m.importance === "high" ? "meta--accent" : ""}`}>
                        {m.importance === "high" ? "High importance" : `Flagged ${displayDate(null, m.received_at).split(",")[0]}`}
                      </div>
                    </>
                  );
                  return href ? (
                    <a key={m.id} className="card row" href={href} target="_blank" rel="noreferrer">
                      {body}
                    </a>
                  ) : (
                    <div key={m.id} className="card row">
                      {body}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {tidyShown.length > 0 && (
            <section className="wd-section" aria-labelledby="tidy-h">
              <button className="btn btn--ghost wd-tidy-toggle" aria-expanded={tidyOpen} onClick={() => setTidyOpen((v) => !v)}>
                <span id="tidy-h" className="meta">TIDY UP · {tidyShown.length}</span>
                <Icon name={tidyOpen ? "up" : "down"} />
              </button>
              {tidyOpen &&
                tidyShown.map((t) => (
                  <div key={t.id} className="wd-tidy">
                    <p>{t.text}</p>
                    <div className="wd-tidy-actions">
                      <button className="btn" onClick={() => onOpen({ id: t.record })}>
                        Review
                      </button>
                      <button className="btn btn--ghost" onClick={() => leaveIt(t.id)}>
                        Leave it
                      </button>
                    </div>
                  </div>
                ))}
            </section>
          )}
        </div>
      </div>

      <aside className={`wd-ledger wd-dim${dim}`} aria-label="Ledger">
        <section aria-labelledby="wk-h">
          {label("THIS WEEK", "wk-h")}
          {agenda.data ? (
            <div className="wd-agenda">
              {weekStrip(date, events)
                .filter((d) => d.iso >= date)
                .map((d) => (
                  <div key={d.iso} className={d.today ? "wd-agenda-day is-today" : "wd-agenda-day"} aria-current={d.today ? "date" : undefined}>
                    <div className="wd-agenda-head">
                      <span className="meta">{d.today ? "TODAY" : d.label}</span>
                      <b>{d.num}</b>
                    </div>
                    {d.meetings.length ? (
                      <ul>
                        {(expandedDays.includes(d.iso) ? d.meetings : d.meetings.slice(0, DAY_LIMIT)).map((m) => {
                          const href = outlookLink(m.url);
                          const body = (
                            <>
                              <span className="meta">
                                {m.start} – {m.end}
                              </span>
                              <span className="wd-agenda-title">{m.subject}</span>
                            </>
                          );
                          return (
                            <li key={m.id} className={m.endMs < now ? "is-past" : ""}>
                              {href ? (
                                <a href={href} target="_blank" rel="noreferrer">
                                  {body}
                                </a>
                              ) : (
                                body
                              )}
                            </li>
                          );
                        })}
                        {d.meetings.length > DAY_LIMIT && (
                          <li>
                            <button
                              className="wd-agenda-more"
                              aria-expanded={expandedDays.includes(d.iso)}
                              onClick={() =>
                                setExpandedDays((old) => (old.includes(d.iso) ? old.filter((x) => x !== d.iso) : [...old, d.iso]))
                              }
                            >
                              {expandedDays.includes(d.iso) ? "Show fewer" : `+${d.meetings.length - DAY_LIMIT} more`}
                            </button>
                          </li>
                        )}
                      </ul>
                    ) : (
                      <p className="wd-agenda-none">No meetings</p>
                    )}
                  </div>
                ))}
            </div>
          ) : (
            <p className="wd-note">{agenda.error ? "Calendar unavailable" : "Calendar details appear when Outlook responds."}</p>
          )}
        </section>

        <section aria-labelledby="kt-h">
          {label("KEEPING TRACK", "kt-h")}
          {reminders.slice(0, 3).map((r) => (
            <button key={r.id} className="row wd-track-row" onClick={() => onOpen(r)}>
              <Icon name="bell" />
              <span>
                <span className="wd-track-title">{r.title}</span>
                <span className={`meta ${r.remind_at && r.remind_at.slice(0, 10) < date ? "meta--overdue" : ""}`}>
                  Reminder · {r.remind_at && r.remind_at.slice(0, 10) < date ? "past due, was " : ""}
                  {displayDate(null, r.remind_at).split(",")[0]}
                </span>
              </span>
            </button>
          ))}
          {waiting.slice(0, 3).map((w) => (
            <button key={w.id} className="row wd-track-row" onClick={() => onOpen(w)}>
              <Icon name="clock" />
              <span>
                <span className="wd-track-title">{w.title}</span>
                <span className="meta">Waiting · {dueMeta(w.due_date, date).text}</span>
              </span>
            </button>
          ))}
          {data && waiting.length === 0 && (
            <div className="wd-track-row wd-quiet">
              <Icon name="clock" />
              <span>
                <span className="wd-track-title">Nothing waiting on others</span>
                <span className="meta">Track a dependency when work is in someone else’s hands.</span>
              </span>
            </div>
          )}
          {data && reminders.length === 0 && <p className="wd-note">No reminders need a nudge.</p>}
        </section>

        <Standup client={client} userId={userId} date={date} revision={revision} />

        <section aria-labelledby="ow-h">
          <div className="wd-heading">
            {label("OPEN WORK", "ow-h")}
            <button className="wd-link" onClick={() => onNavigate("task")}>
              All tasks
            </button>
          </div>
          {openTasks && (
            <div className="segmented" role="tablist" aria-label="Areas">
              {groups.map(([name, list]) => (
                <button key={name} role="tab" aria-selected={name === activeArea[0]} onClick={() => setArea(name)}>
                  {name} <span className="meta">{list.length}</span>
                </button>
              ))}
            </div>
          )}
          <div role="tabpanel">
            {areaTasks.map((t) => {
              const m = taskMeta(t, date);
              return (
                <div key={t.id} className="row wd-open-row">
                  <button
                    className="check"
                    aria-label={`Complete task: ${t.title}`}
                    disabled={busy === t.id}
                    onClick={() => void completeOpen(t)}
                  />
                  <button className="wd-open-main" onClick={() => onOpen(t)}>
                    <span className="wd-track-title">{t.title}</span>
                    <span className={`meta ${m.overdue ? "meta--overdue" : ""}`}>{m.text}</span>
                  </button>
                </div>
              );
            })}
            {openTasks && areaTasks.length === 0 && (
              <p className="wd-note">
                {activeArea[0] === priorityTab ? "No High or Critical tasks are open." : "No open tasks here. Capture one from the bar above."}
              </p>
            )}
          </div>
        </section>

        <section aria-labelledby="amb-h">
          {label("MOVING AROUND YOU", "amb-h")}
          <ul className="wd-feed">
            {helix && (
              <li>
                <i className="breathe" />
                <span>
                  <b>{[helix.number, helix.title].filter(Boolean).join(" ")}</b> updated <span className="meta">· Helix</span>
                </span>
              </li>
            )}
            {refreshed && (
              <li>
                <i />
                <span>
                  Brief refreshed <span className="meta">· {refreshed}</span>
                </span>
              </li>
            )}
            {synced && (
              <li>
                <i />
                <span>
                  Calendar synced <span className="meta">· {synced}</span>
                </span>
              </li>
            )}
          </ul>
        </section>
      </aside>

      {sitrepOpen && (
        <SitrepPanel
          client={client}
          date={date}
          layout={{ collapsed: false, toggleCollapsed: () => undefined, drawer: true, setDrawer: (v) => setSitrepOpen(Boolean(v)), narrow: true }}
          trigger={sitrepButton}
          onOpen={(item) => {
            setSitrepOpen(false);
            onOpen(item);
          }}
        />
      )}
      {flaggedOpen && (
        <FlaggedDrawer
          client={client}
          revision={revision}
          onClose={() => setFlaggedOpen(false)}
          onChanged={() => {
            loadFlagged();
            setRetry((v) => v + 1);
          }}
        />
      )}
    </div>
  );
}

function FlaggedDrawer({
  client,
  revision,
  onClose,
  onChanged,
}: {
  client: AppClient;
  revision: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog ref={dialog} className="side-dialog" aria-label="Flagged email" onCancel={onClose}>
      <div className="dialog-heading">
        <h2>Flagged email</h2>
        <button aria-label="Close flagged email" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <FlaggedMail client={client} revision={revision} onCount={ignoreCount} onChanged={onChanged} />
    </dialog>
  );
}
