import { useEffect, useState } from "react";
import type { AppClient } from "../../platform/supabase";
import { Icon } from "../../ui/Icon";
import { eventDuration, workWeekRange, type CalendarAgenda } from "./calendar";
const zone = "America/New_York";
const dateLabel = (iso: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
const timeLabel = (iso: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
export function CalendarPanel({
  client,
  date,
}: {
  client: AppClient;
  date: string;
}) {
  const week = workWeekRange(date);
  const [retry, setRetry] = useState(0),
    [data, setData] = useState<CalendarAgenda | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    let current: AbortController | undefined;
    let inFlight = false;
    async function load() {
      if (inFlight) return;
      inFlight = true;
      current = new AbortController();
      setLoading(true);
      try {
        const session = await client.auth.getSession();
        if (session.error || !session.data.session)
          throw new Error("Sign in again to see your calendar.");
        const response = await fetch(
          `/api/microsoft/calendar?date=${date}&range=workweek`,
          {
            headers: {
              Authorization: `Bearer ${session.data.session.access_token}`,
            },
            cache: "no-store",
            signal: AbortSignal.any([
              current.signal,
              AbortSignal.timeout(30000),
            ]),
          },
        );
        const result = await response.json();
        if (!response.ok)
          throw new Error(
            result.message ||
              "Calendar unavailable. Retry or check Microsoft 365 in Settings.",
          );
        if (alive) {
          setData(result);
          setError("");
        }
      } catch (caught) {
        if (alive) {
          setData(null);
          setError(
            caught instanceof Error
              ? caught.message
              : "Calendar unavailable. Please retry.",
          );
        }
      } finally {
        inFlight = false;
        if (alive) setLoading(false);
      }
    }
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 300000);
    const visible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      alive = false;
      current?.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [client, date, retry]);
  return (
    <section
      className="day-panel calendar-panel"
      aria-labelledby="calendar-heading"
    >
      <div className="panel-heading">
        <h2 id="calendar-heading">
          <Icon name="calendar" />
          Calendar
        </h2>
        <button
          className="panel-link"
          disabled={loading}
          onClick={() => setRetry((v) => v + 1)}
        >
          Refresh
        </button>
      </div>
      <div className="calendar-controls">
        <span className="small">{dateLabel(week.start)} – {dateLabel(new Date(Date.parse(week.end) - 1).toISOString())}</span>
        <span className="small muted">Outlook · Eastern time</span>
      </div>
      {loading && (
        <p role="status" className="small muted">
          Updating calendar…
        </p>
      )}
      {error && (
        <p role="status" className="error-message">
          {error}
        </p>
      )}
      {data && !data.events.length && (
        <p className="small muted">No events this work week.</p>
      )}
      {data && data.events.length > 0 && (
        <ul className="calendar-agenda">
          {data.events.map((event) => (
            <li key={event.id}>
              <div className="calendar-event-time">
                <span>{dateLabel(event.start)}</span>
                <strong>
                  {event.allDay ? "All day" : timeLabel(event.start)}
                </strong>
              </div>
              <div>
                <strong>{event.subject}</strong>
                <p className="record-meta">
                  {event.allDay
                    ? `${Math.max(1, Math.round(event.durationMinutes / 1440))} day${Math.round(event.durationMinutes / 1440) > 1 ? "s" : ""}`
                    : `${eventDuration(event.durationMinutes)} · Ends ${timeLabel(event.end)}`}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {data?.truncated && (
        <p className="small muted">
          More events are available in Outlook. This view shows the first 75
          calendar entries.
        </p>
      )}
      {data && (
        <p className="calendar-updated small muted">
          Updated {timeLabel(data.retrievedAt)} · Refreshes every 5 minutes
        </p>
      )}
    </section>
  );
}
