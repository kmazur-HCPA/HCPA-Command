import { useEffect, useRef } from "react";
import { boldParts, problems, useSitrepLayout } from "./support";
import type { AppClient } from "../../platform/supabase";
import { useSitrep } from "./useSitrep";
import { mostlyDone, reconcileSection, type Reconciled } from "./reconcile";
import { sections } from "./sections";
import type { SitrepRef } from "./schema";
import { Icon } from "../../ui/Icon";

const zone = "America/New_York";
const clock = (iso: string, withDay: boolean) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    ...(withDay ? { weekday: "short" } : {}),
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
const slotLabel = { am: "morning", midday: "midday", manual: "manual" } as const;
const markerLabel = { overdue: "Overdue", due_today: "Due today", conflict: "Conflict" } as const;

export function SitrepPanel({
  client,
  date,
  layout,
  trigger,
  onOpen,
}: {
  client: AppClient;
  date: string;
  layout: ReturnType<typeof useSitrepLayout>;
  trigger: React.RefObject<HTMLButtonElement | null>;
  onOpen: (item: { id: string }) => void;
}) {
  const { state, error, live, now } = useSitrep(client, date);
  const panel = useRef<HTMLElement>(null);
  const { collapsed, toggleCollapsed, drawer, setDrawer, narrow } = layout;
  const isDrawerOpen = narrow && drawer;
  const rail = !narrow && collapsed;

  // Drawer: focus moves in, Tab stays inside, Escape closes, focus returns to the trigger.
  useEffect(() => {
    if (!isDrawerOpen) return;
    const el = panel.current;
    const opener = trigger.current;
    el?.querySelector<HTMLElement>("button, a[href]")?.focus();
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape") return setDrawer(false);
      if (event.key !== "Tab" || !el) return;
      const items = [...el.querySelectorAll<HTMLElement>("button, a[href], [tabindex='0']")].filter((n) => !n.hasAttribute("disabled"));
      if (!items.length) return;
      const first = items[0]!, lastItem = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", keys);
    return () => {
      document.removeEventListener("keydown", keys);
      opener?.focus();
    };
  }, [isDrawerOpen, setDrawer, trigger]);

  const run = state?.run ?? null;
  const link = (ref: SitrepRef) =>
    ref.kind === "record" ? (
      <button key={ref.id} className="sitrep-ref" onClick={() => { setDrawer(false); onOpen({ id: ref.id }); }}>
        {ref.label || "Open record"}
      </button>
    ) : ref.label ? (
      <span key={ref.id} className="sitrep-ref-plain">{ref.label}</span>
    ) : null;
  const item = (r: Reconciled, i: number) => {
    const it = r.item;
    return (
      <li key={i} className={`sitrep-item${r.struck ? " is-struck" : ""}${r.dimmed ? " is-dimmed" : ""}`}>
        <p>
          {r.marker && <strong className={`sitrep-marker marker-${r.marker}`}>{markerLabel[r.marker]}</strong>}
          {r.marker && " "}
          {r.struck ? <s>{boldParts(it.text)}</s> : boldParts(it.text)}
          {r.when && <strong className="sitrep-when"> · {r.when}</strong>}
          {r.label && <strong className="sitrep-label"> · {r.label}</strong>}
        </p>
        {it.reason && <p className="sitrep-reason">{it.reason}</p>}
        {!!it.refs?.length && <p className="sitrep-refs">{it.refs.filter((x) => !r.removedRecords.has(x.id)).map(link)}</p>}
      </li>
    );
  };
  const ctx = { now, today: date, records: live.records, openFlagged: live.openFlagged };
  const nextItems = run?.payload ? reconcileSection(run.payload.next, ctx) : [];
  const body = () => {
    if (error && !state) return <p role="alert" className="error-message">{error}</p>;
    if (!state) return <p role="status" className="small muted">Loading SITREP…</p>;
    return (
      <>
        <div className="sitrep-status">
          {run && state.isToday && <p>Generated {clock(run.generated_at!, false)}</p>}
          {run && state.isToday && run.status === "partial" && (
            <p>Partial: {problems(run).join(", ") || "some sources incomplete"}</p>
          )}
          {!state.isToday && (
            <p>
              <strong>No SITREP today.</strong>
              {run?.generated_at && ` Last run ${clock(run.generated_at, true)}.`}
            </p>
          )}
          {state.todayFailure && (
            <p>Today’s {slotLabel[state.todayFailure.run_slot]} run failed.</p>
          )}
          {error && <p role="alert" className="error-message">{error}</p>}
        </div>
        {!run && <p className="small muted">No SITREP yet. Runs are saved by the scheduled CMD task.</p>}
        {run?.payload && (
          <div className={state.isToday ? "" : "sitrep-previous"}>
            {!state.isToday && <p className="sitrep-previous-label">Previous</p>}
            {sections.map(([key, heading]) => (
              <section key={key} aria-labelledby={`sitrep-${key}`}>
                <h3 id={`sitrep-${key}`}>{heading}</h3>
                {key === "now" ? (
                  <p className="sitrep-now">{boldParts(run.payload!.now)}</p>
                ) : run.payload![key].length ? (
                  <>
                    {key === "next" && state.isToday && mostlyDone(nextItems) && (
                      <p className="small muted">Most of this morning’s list is done.</p>
                    )}
                    <ul>{(key === "next" ? nextItems : reconcileSection(run.payload![key], ctx)).map(item)}</ul>
                  </>
                ) : (
                  <p className="small muted">Nothing</p>
                )}
              </section>
            ))}
          </div>
        )}
      </>
    );
  };
  return (
    <>
      {isDrawerOpen && <div className="sitrep-scrim" onClick={() => setDrawer(false)} aria-hidden="true" />}
      <aside
        ref={panel}
        aria-label="SITREP"
        aria-live="off"
        className="sitrep-panel"
        data-rail={rail || undefined}
        data-drawer={narrow || undefined}
        data-open={isDrawerOpen || undefined}
        {...(isDrawerOpen ? { role: "dialog", "aria-modal": true } : {})}
      >
        {rail ? (
          <button className="sitrep-rail" aria-label="Expand SITREP" aria-expanded="false" onClick={toggleCollapsed}>
            <Icon name="panel" />
            <span>SITREP</span>
          </button>
        ) : (
          <>
            <div className="sitrep-heading">
              <h2>SITREP</h2>
              <button
                aria-label={narrow ? "Close SITREP" : "Collapse SITREP"}
                aria-expanded="true"
                onClick={() => (narrow ? setDrawer(false) : toggleCollapsed())}
              >
                <Icon name={narrow ? "close" : "chevron"} />
              </button>
            </div>
            <div className="sitrep-body">{body()}</div>
          </>
        )}
      </aside>
    </>
  );
}
