import {WorkdayReviews} from "../reviews/WorkdayReviews";
import { useEffect, useState } from "react";
import type { AppClient } from "../../platform/supabase";
import { workDay, patchWork } from "../../services/work";
import { effectiveStatus } from "./model";
import type { Kind, WorkItem, WorkSummary } from "./model";
import { displayDate, today } from "./dates";
import { Icon, Mark } from "../../ui/Icon";
export function WorkDay({
  client,
  revision,
  onOpen,
  onNavigate,
}: {
  client: AppClient;
  revision: number;
  onOpen: (item: Pick<WorkItem, "id">) => void;
  onNavigate: (kind: Kind) => void;
}) {
  const [data, setData] = useState<Awaited<ReturnType<typeof workDay>> | null>(
      null,
    ),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0),
    [now, setNow] = useState(() => Date.now()),
    [busy, setBusy] = useState<string | null>(null),
    [notice, setNotice] = useState("");
  const refreshMinute = Math.floor(now/60000);
  const date = today(new Date(now)),
    hour = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        hourCycle: "h23",
      }).format(now),
    );
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
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
  const ready =
      data?.reminders.filter((r) => effectiveStatus(r, now) === "Active") ?? [],
    snoozed =
      data?.reminders.filter((r) => effectiveStatus(r, now) === "Snoozed") ??
      [];
  const tasks = data
    ? [
        ...new Map(
          [...data.focus, ...data.due].map((row) => [row.id, row]),
        ).values(),
      ].slice(0, 8)
    : [];
  async function complete(item: WorkSummary) {
    if (busy) return;
    setBusy(item.id);
    setError("");
    try {
      await patchWork(client, item, {
        status: "Complete",
        snoozed_until: null,
      });
      setNotice(`Completed: ${item.title}`);
      setRetry((v) => v + 1);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(null);
    }
  }
  const heading = (icon: string, title: string, action: string, kind: Kind) => (
    <div className="panel-heading">
      <h2>
        <Icon name={icon} />
        {title}
      </h2>
      <button className="panel-link" onClick={() => onNavigate(kind)}>
        {action}
        <Icon name="arrow" />
      </button>
    </div>
  );
  const empty = (icon: string, title: string, body: string) => (
    <div className="day-empty">
      <Icon name={icon} />
      <div>
        <strong>{title}</strong>
        <p>{body}</p>
      </div>
    </div>
  );
  const rows = (items: WorkSummary[]) => (
    <ul className="day-list">
      {items.map((item) => (
        <li key={item.id}>
          {item.kind === "reminder" ? (
            <button
              className="completion-control"
              disabled={!!busy}
              aria-label={`Complete ${item.title}`}
              title="Complete reminder"
              onClick={() => void complete(item)}
            >
              {busy === item.id ? (
                <span className="loading-dot" />
              ) : (
                <Icon name="check" />
              )}
            </button>
          ) : (
            <span className="timeline-dot" />
          )}
          <div>
            <button className="row-title" onClick={() => onOpen(item)}>
              {item.title}
            </button>
            <p className="record-meta">
              {item.organization && `${item.organization} · `}
              {displayDate(item.due_date, item.remind_at)}
              {item.status === "Snoozed" &&
                ` · Snoozed until ${displayDate(null, item.snoozed_until)}`}
            </p>
          </div>
          <button
            className="icon-button row-open"
            aria-label={`Open ${item.title}`}
            onClick={() => onOpen(item)}
          >
            <Icon name="chevron" />
          </button>
        </li>
      ))}
    </ul>
  );
  return (
    <section className="work-day">
      <div className="day-heading">
        <div>
          <p className="eyebrow">
            WORK DAY <span>/</span>{" "}
            {new Intl.DateTimeFormat("en-US", {
              timeZone: "America/New_York",
              weekday: "long",
              month: "long",
              day: "numeric",
            }).format(now)}
          </p>
          <h1 tabIndex={-1} aria-label="Work Day">
            {greeting}, Kevin.
          </h1>
          <p className="intro">Here’s what matters today.</p>
        </div>
        <div className="day-signature" aria-hidden="true">
          <span />
          <span />
          <span />
          <i>FOCUS / FORWARD</i>
        </div>
      </div>
      {error && (
        <p role="alert" className="error-message">
          {error}{" "}
          <button onClick={() => setRetry((v) => v + 1)}>Retry Work Day</button>
        </p>
      )}
      {notice && (
        <p className="success-toast" role="status">
          <Icon name="check" />
          {notice}
          <button
            aria-label="Dismiss confirmation"
            onClick={() => setNotice("")}
          >
            <Icon name="close" />
          </button>
        </p>
      )}
      {!data && !error && (
        <div className="day-loading" role="status">
          <span className="loading-orbit" /> Bringing your day into focus…
        </div>
      )}
      {data && (
        <>
          <div className="day-stats">
            {(
              [
                [
                  "task",
                  "Tasks due",
                  data.counts[1],
                  "Today & overdue",
                  "task",
                ],
                [
                  "bell",
                  "Open reminders",
                  data.counts[2],
                  snoozed.length
                    ? `${snoozed.length} snoozed in view`
                    : "Kept here until resolved",
                  "reminder",
                ],
                [
                  "focus",
                  "Chosen priorities",
                  `${data.focus.length} / 3`,
                  "A little focus goes a long way",
                  "task",
                ],
                [
                  "learning",
                  "Learning in progress",
                  data.counts[5],
                  "Keep your curiosity moving",
                  "learning",
                ],
              ] as const
            ).map(([icon, label, value, context, kind]) => (
              <button
                className="stat-card"
                key={label}
                onClick={() => onNavigate(kind)}
              >
                <Icon name={icon} />
                <span>
                  <span className="stat-label">{label}</span>
                  <strong>{value}</strong>
                  <small>{context}</small>
                </span>
                <Icon name="arrow" className="stat-arrow" />
              </button>
            ))}
          </div>
          <div className="day-grid">
            <div className="day-main">
              {" "}
              <section className="day-panel priority-panel">
                {heading("task", "Priority tasks", "All tasks", "task")}
                {tasks.length ? (
                  <ul className="priority-list">
                    {tasks.map((item) => (
                      <li key={item.id}>
                        <button
                          className="completion-control"
                          disabled={!!busy}
                          aria-label={`Complete ${item.title}`}
                          onClick={() => void complete(item)}
                        >
                          {busy === item.id ? (
                            <span className="loading-dot" />
                          ) : (
                            <Icon name="check" />
                          )}
                        </button>
                        <div>
                          <button
                            className="row-title"
                            onClick={() => onOpen(item)}
                          >
                            {item.title}
                          </button>
                          <p className="record-meta">
                            {item.focus_slot
                              ? `Priority ${item.focus_slot} · `
                              : ""}
                            {item.status} · {displayDate(item.due_date)}
                          </p>
                        </div>
                        <span
                          className={`priority-pill priority-${item.priority.toLowerCase()}`}
                        >
                          {item.priority === "Critical" ||
                          item.priority === "High" ? (
                            <Icon name="flag" />
                          ) : null}
                          {item.priority}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  empty(
                    "task",
                    "A clear starting point.",
                    "Choose your next task and give it a priority slot. Your focus starts here.",
                  )
                )}
                <div className="panel-footer">
                  <span>
                    {data.counts[1] ?? 0} tasks due · up to 8 shown with chosen
                    priorities first
                  </span>
                  <button onClick={() => onNavigate("task")}>
                    Choose tasks
                    <Icon name="plus" />
                  </button>
                </div>
              </section>
              <section className="day-panel reminders-panel">
                {heading("bell", "On your radar", "All reminders", "reminder")}
                {ready.length
                  ? rows(ready.slice(0, 5))
                  : empty(
                      "bell",
                      "Nothing needs a nudge.",
                      "Reminders stay here until you complete, dismiss, or snooze them.",
                    )}
                {snoozed.length > 0 && (
                  <details>
                    <summary>Snoozed ({snoozed.length})</summary>
                    {rows(snoozed.slice(0, 5))}
                  </details>
                )}
                {ready.length > 5 && (
                  <p className="small muted">
                    {ready.length - 5} more active reminders in this view. Open
                    All reminders.
                  </p>
                )}
                {data.counts[2]! > 100 && (
                  <p className="small muted">
                    Oldest 100 open reminders loaded. Open All reminders for the
                    rest.
                  </p>
                )}
              </section>
              <section className="day-panel brief-panel">
                {heading("flag", "Command brief", "Open Journal", "journal")}
                <p className="brief-source">
                  FROM YOUR SAVED WORK <span>·</span>{" "}
                  {new Intl.DateTimeFormat("en-US", {
                    timeZone: "America/New_York",
                    hour: "numeric",
                    minute: "2-digit",
                  }).format(now)}
                </p>
                <ul className="brief-list">
                  <li>
                    {data.focus.length
                      ? `${data.focus.length} priorities selected. Start with “${data.focus[0]!.title}”.`
                      : "Your focus is open. Choose one priority to give today a direction."}
                  </li>
                  <li>
                    {data.counts[1]
                      ? `${data.counts[1]} tasks are due today or earlier. Review what needs your attention.`
                      : "No tasks are due today or overdue."}
                  </li>
                  <li>
                    {data.counts[3]
                      ? `${data.counts[3]} dependencies are waiting on someone else. Check the next follow-up.`
                      : "No active dependencies are recorded."}
                  </li>
                </ul>
                <p className="brief-disclosure">
                  A live summary of your records.
                </p>
              </section>
              <button className="panel-link" onClick={()=>window.dispatchEvent(new CustomEvent("command:cora",{detail:"Give me a concise Command Brief. What needs my attention today, what is waiting on others, and which project needs a closer look?"}))}>Ask Cora for perspective <Icon name="arrow"/></button>
              <section className="day-panel waiting-panel">
                {heading("clock", "Waiting on", "Manage waiting", "waiting")}
                {data.waiting.length
                  ? rows(data.waiting.slice(0, 4))
                  : empty(
                      "clock",
                      "No loose ends here.",
                      "Track a dependency and a follow-up date when work is in someone else’s hands.",
                    )}
                {data.counts[3]! > 4 && (
                  <p className="small muted">
                    Showing up to four. Open Manage waiting for all
                    dependencies.
                  </p>
                )}
              </section>
            </div>
            <div className="day-context">
              {" "}
              <section className="day-panel focus-panel">
                {heading("focus", "Focus today", "Set focus", "task")}
                <div className="focus-composition">
                  <div className="focus-orbit" aria-hidden="true">
                    <svg viewBox="0 0 120 120">
                      <circle className="orbit-track" cx="60" cy="60" r="49" />
                      <circle
                        className="orbit-value"
                        cx="60"
                        cy="60"
                        r="49"
                        strokeDasharray={`${(data.focus.length / 3) * 308} 308`}
                      />
                    </svg>
                    <div>
                      <strong>
                        {data.focus.length}
                        <span>/3</span>
                      </strong>
                      <small>PRIORITIES</small>
                    </div>
                  </div>
                  <div className="focus-copy">
                    {data.focus[0] ? (
                      <>
                        <button
                          className="row-title"
                          onClick={() => onOpen(data.focus[0]!)}
                        >
                          {data.focus[0].title}
                        </button>
                        <p>
                          {data.focus[0].status} · {data.focus[0].priority}{" "}
                          priority
                        </p>
                      </>
                    ) : (
                      <>
                        <h3>
                          Make space for
                          <br />
                          what matters.
                        </h3>
                        <p>Choose up to three priorities. Start with one.</p>
                      </>
                    )}
                  </div>
                </div>
                {data.focus.slice(1).map((item) => (
                  <button
                    className="focus-secondary"
                    key={item.id}
                    onClick={() => onOpen(item)}
                  >
                    <span>0{item.focus_slot}</span>
                    {item.title}
                    <Icon name="arrow" />
                  </button>
                ))}
                <p className="focus-footnote">
                  <span>—</span> One intentional step at a time.
                </p>
              </section>
              <section className="day-panel projects-panel">
                {heading(
                  "project",
                  "Projects at a glance",
                  "View all",
                  "project",
                )}
                {data.projects.length ? (
                  <ul className="project-glance">
                    {data.projects.map((item) => (
                      <li key={item.id}>
                        <span
                          className={`status-dot ${item.status === "On Hold" ? "on-hold" : ""}`}
                        />
                        <button
                          className="row-title"
                          onClick={() => onOpen(item)}
                        >
                          {item.title}
                          <small>
                            Updated {displayDate(null, item.updated_at)}
                          </small>
                        </button>
                        <span className="status-pill">{item.status}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  empty(
                    "project",
                    "Good work needs a home.",
                    "Add a project to connect your tasks, decisions, and next steps.",
                  )
                )}
              </section>
              <section className="day-panel learning-panel">
                {heading(
                  "learning",
                  "Keep learning",
                  "View learning",
                  "learning",
                )}
                {data.learning.length
                  ? rows(data.learning)
                  : empty(
                      "learning",
                      "Follow your curiosity.",
                      "Pick up a course, article, or idea. Track the learning that moves your work forward.",
                    )}
              </section>
              <section className="capture-prompt">
                <Mark />
                <p className="eyebrow">THOUGHT → ACTION</p>
                <h2>Don’t lose the thought.</h2>
                <p>Capture now. Make sense of it later.</p>
                <button
                  onClick={() =>
                    window.dispatchEvent(new Event("command:capture"))
                  }
                >
                  Capture a thought
                  <Icon name="arrow" />
                </button>
                <div className="capture-orbits" aria-hidden="true" />
              </section>
            </div>{" "}
          </div>
          <WorkdayReviews client={client}/>
          <footer className="day-footer">
            <span>COMMAND / YOUR DAY, WITH INTENTION</span>
            <span>FOCUS · ORGANIZE · EXPLORE · DO</span>
          </footer>
        </>
      )}
    </section>
  );
}
