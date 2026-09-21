import { useEffect, useState } from "react";
import type { AppClient } from "../../platform/supabase";
import type { Database } from "../../data/database.types";
type Review = Database["public"]["Tables"]["cora_workday_reviews"]["Row"];
export function WorkdayReviews({
  client,
  settings = false,
}: {
  client: AppClient;
  settings?: boolean;
}) {
  const [reviews, setReviews] = useState<Review[]>([]),
    [enabled, setEnabled] = useState<boolean | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let active = true;
    async function load() {
      const [r, p] = await Promise.all([
        client
          .from("cora_workday_reviews")
          .select("*")
          .order("started_at", { ascending: false })
          .limit(5),
        client
          .from("cora_review_preferences")
          .select("automatic_reminders")
          .maybeSingle(),
      ]);
      if (!active) return;
      setNow(Date.now());
      if (r.error || p.error) {
        setError("Cora review status is unavailable.");
        return;
      }
      setReviews(r.data);
      setEnabled(p.data?.automatic_reminders ?? false);
      setError("");
    }
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 60000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [client]);
  async function toggle() {
    setBusy(true);
    setError("");
    try {
      const { data } = await client.auth.getUser();
      if (!data.user) throw new Error();
      const r = await client
        .from("cora_review_preferences")
        .update({ automatic_reminders: !enabled })
        .eq("user_id", data.user.id)
        .select("user_id")
        .maybeSingle();
      if (r.error || !r.data) throw new Error();
      setEnabled(!enabled);
    } catch {
      setError("The setting was not saved. Retry.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings-panel" aria-label="Cora workday reviews">
      <h2>Cora workday reviews</h2>
      <p>Monday–Friday · 6:45 AM, 9 AM, 11 AM, 1 PM and 3 PM · Eastern</p>
      <p>
        {enabled === null
          ? "Checking status…"
          : enabled
            ? "Automatic reminders enabled. Priorities and Waiting On changes remain suggestions."
            : "Automatic reviews and reminders paused."}
      </p>
      {settings && (
        <>
          <button
            disabled={busy || enabled === null}
            onClick={() => void toggle()}
          >
            {enabled
              ? "Pause automatic reminders"
              : "Enable automatic reminders"}
          </button>
          <p className="muted">
            Schedules are managed in the private ChatGPT Cora agent →
            Automations. Pausing here blocks new automatic writes; pause the
            agent automations to also stop Microsoft reads.
          </p>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {!reviews.length && !error && <p>No scheduled review recorded yet.</p>}
      {reviews.map((r, i) => (
        <details key={r.id} open={i === 0}>
          <summary>
            {new Date(r.started_at).toLocaleString("en-US", {
              timeZone: "America/New_York",
              timeZoneName: "short",
            })}{" "}
            ·{" "}
            {r.status === "running" && now - Date.parse(r.started_at) > 1800000
              ? "Interrupted or still running"
              : r.status}
          </summary>
          <p style={{ whiteSpace: "pre-wrap" }}>
            {r.summary || "Cora is reviewing available sources."}
          </p>
        </details>
      ))}
    </section>
  );
}
