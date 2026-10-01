import { useEffect, useState } from "react";
import type { AppClient } from "../../platform/supabase";
import {
  helixConnect,
  helixDisconnect,
  helixStatus,
} from "../../services/helix";
import type { HelixStatus } from "./model";
import { Icon } from "../../ui/Icon";

const callbackMessages: Record<string, string> = {
  connected: "Helix connected. Your Helix work now appears on Today.",
  cancelled: "Helix connection was cancelled. You can try again when ready.",
  failed:
    "Helix connection was not completed. Retry Connect; if it continues, check the Command app registration in Helix.",
};
export function HelixPanel({ client }: { client: AppClient }) {
  const [status, setStatus] = useState<HelixStatus | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  const [notice, setNotice] = useState(
    () =>
      callbackMessages[
        new URLSearchParams(location.search).get("helix") ?? ""
      ] ?? "",
  );
  useEffect(() => {
    const url = new URL(location.href);
    if (url.searchParams.has("helix")) {
      url.searchParams.delete("helix");
      history.replaceState(null, "", url.pathname + url.search);
    }
    let active = true;
    helixStatus(client)
      .then((data) => {
        if (active) {
          setStatus(data);
          setError("");
        }
      })
      .catch(() => {
        if (active)
          setError("Helix connection status is unavailable. Please retry.");
      });
    return () => {
      active = false;
    };
  }, [client, retry]);
  async function change(action: "connect" | "disconnect") {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (action === "connect") location.assign(await helixConnect(client));
      else {
        await helixDisconnect(client);
        setStatus((v) => ({
          configured: v?.configured ?? false,
          connected: false,
        }));
        setNotice(
          "Disconnected. Command’s stored Helix credentials have been removed.",
        );
      }
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Helix connection failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="settings-panel microsoft-panel"
      aria-labelledby="helix-title"
    >
      <div className="panel-heading">
        <h2 id="helix-title">
          <Icon name="task" /> Helix
        </h2>
        <span className="eyebrow">
          {status?.connected ? "Connected · Read only" : "IT work · Read only"}
        </span>
      </div>
      <p className="muted">
        Show the Helix work that needs you on Today: your OpsQueue tasks and
        tickets, unassigned urgent tickets, recent changes, and contracts and
        assets coming due.
      </p>
      {!status && !error && <p role="status">Checking connection…</p>}
      {status && (
        <>
          <p>
            {status.connected
              ? "Connected to Helix."
              : status.configured
                ? "Sign in to Helix with your HCPA account to connect."
                : "Waiting for the Helix connection to be configured."}
          </p>
          <p className="muted small">
            Command reads titles, numbers, statuses, priorities and dates only,
            under your own Helix permissions. It never changes anything in Helix
            and never reads descriptions, comments, requester details or notes.
          </p>
          <div className="microsoft-actions">
            <button
              disabled={busy || !status.configured}
              onClick={() => void change("connect")}
            >
              {busy
                ? "Working…"
                : status.connected
                  ? "Reconnect Helix"
                  : "Connect Helix"}
            </button>
            {status.connected && (
              <button disabled={busy} onClick={() => void change("disconnect")}>
                Disconnect
              </button>
            )}
          </div>
        </>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {error && (
        <div role="alert" className="error-message">
          <p>{error}</p>
          <button disabled={busy} onClick={() => setRetry((v) => v + 1)}>
            Retry connection status
          </button>
        </div>
      )}
    </section>
  );
}
