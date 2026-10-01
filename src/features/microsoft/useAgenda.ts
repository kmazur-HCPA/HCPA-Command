import { useEffect, useState } from "react";
import type { AppClient } from "../../platform/supabase";
import type { CalendarAgenda } from "./calendar";

// Today through Friday from Outlook (read-only), refreshed every five minutes while visible.
export function useAgenda(client: AppClient, date: string) {
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
  return { data, error, loading, refresh: () => setRetry((v) => v + 1) };
}
