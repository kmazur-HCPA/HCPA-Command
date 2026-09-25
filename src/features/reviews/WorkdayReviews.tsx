import { useEffect, useState } from "react";
import type { AppClient } from "../../platform/supabase";
// Kevin's standing consent for connected apps (CMD in Claude) to save the
// reminders he asks for without a confirmation card. Enforced in the database.
export function WorkdayReviews({
  client,
  settings = false,
}: {
  client: AppClient;
  settings?: boolean;
}) {
  const [enabled, setEnabled] = useState<boolean | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void client
      .from("cora_review_preferences")
      .select("automatic_reminders")
      .maybeSingle()
      .then((p) => {
        if (!active) return;
        if (p.error) setError("Automatic reminder status is unavailable.");
        else setEnabled(p.data?.automatic_reminders ?? false);
      });
    return () => {
      active = false;
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
    <section className="settings-panel" aria-label="Automatic reminders">
      <h2>Automatic reminders</h2>
      <p>
        {enabled === null
          ? "Checking status…"
          : enabled
            ? "Enabled. CMD can save reminders you ask for without a confirmation step."
            : "Paused. Connected apps cannot save reminders automatically."}
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
            Applies to every connected app. Edits to existing records always
            open here for confirmation.
          </p>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
