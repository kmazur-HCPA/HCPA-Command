import { useCallback, useEffect, useRef, useState } from "react";
import type { AppClient } from "../../platform/supabase";
import { helixSummary } from "../../services/helix";
import {
  helixSections,
  helixSectionTitles,
  type HelixSummaryResponse,
} from "./model";

const refreshMs = 5 * 60 * 1000;
const zone = "America/New_York";
const dueLabel = (date: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(new Date(date + "T00:00:00Z"));
const asOf = (iso: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));

/** Helix work that needs the user. Renders nothing until Helix is connected. */
export function HelixWork({ client }: { client: AppClient }) {
  const [data, setData] = useState<HelixSummaryResponse | null>(null),
    [error, setError] = useState(""),
    [hidden, setHidden] = useState(false);
  const last = useRef(0),
    inFlight = useRef(false);
  const load = useCallback(
    (force = false) => {
      if (inFlight.current || (!force && Date.now() - last.current < refreshMs))
        return;
      inFlight.current = true;
      helixSummary(client)
        .then((result) => {
          last.current = Date.now();
          setData(result);
          setError("");
        })
        .catch((caught: Error & { status?: number }) => {
          // 409 means "not connected" or "reconnect in Settings": say so only for the latter.
          if (caught.status === 409 && /Connect Helix/.test(caught.message))
            setHidden(true);
          else setError(caught.message);
        })
        .finally(() => {
          inFlight.current = false;
        });
    },
    [client],
  );
  useEffect(() => {
    load(true);
    const visible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("focus", visible);
    return () => {
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("focus", visible);
    };
  }, [load]);
  if (hidden) return null;
  if (!data && !error) return null;
  const total = data
    ? helixSections.reduce((sum, name) => sum + data.sections[name].total, 0)
    : 0;
  return (
    <section className="settings-panel" aria-labelledby="helix-work-title">
      <div className="panel-heading">
        <h2 id="helix-work-title">Helix work</h2>
        {data && (
          <span className="eyebrow">
            {data.stale ? "Saved copy · " : ""}
            {asOf(data.retrievedAt)}
          </span>
        )}
      </div>
      {error && (
        <div role="alert" className="error-message">
          <p>{error}</p>
          <button onClick={() => load(true)}>Retry</button>
        </div>
      )}
      {data && data.stale && (
        <p className="muted small" role="status">
          Helix did not respond in time, so this is the last saved copy.
        </p>
      )}
      {data && total === 0 && (
        <p className="muted">Nothing in Helix needs you right now.</p>
      )}
      {data &&
        helixSections
          .filter((name) => data.sections[name].total > 0)
          .map((name) => {
            const section = data.sections[name];
            return (
              <div key={name}>
                <h3 className="eyebrow">
                  {helixSectionTitles[name]} · {section.total}
                </h3>
                <ul>
                  {section.records.map((item) => (
                    <li key={item.id}>
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {item.number ? `${item.number} · ` : ""}
                        {item.title ?? "Untitled"}
                      </a>
                      <span className="muted small">
                        {[
                          item.status,
                          item.priority,
                          item.due_date && `due ${dueLabel(item.due_date)}`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </li>
                  ))}
                </ul>
                {section.total > section.records.length && (
                  <p className="muted small">
                    Showing {section.records.length} of {section.total}.
                  </p>
                )}
              </div>
            );
          })}
    </section>
  );
}
