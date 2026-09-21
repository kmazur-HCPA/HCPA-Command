import { useEffect, useState } from "react";
import type { AppClient } from "../../platform/supabase";
import type { MicrosoftStatus } from "./model";
import { Icon } from "../../ui/Icon";
async function request(client: AppClient, action: string) {
  const session = await client.auth.getSession();
  if (session.error || !session.data.session)
    throw new Error("Sign in to manage Microsoft 365.");
  const response = await fetch(`/api/microsoft/${action}`, {
    method: action === "status" ? "GET" : "POST",
    headers: { Authorization: `Bearer ${session.data.session.access_token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      typeof data.message === "string"
        ? data.message
        : "Microsoft 365 is unavailable. Please retry.",
    );
  return data;
}
const callbackMessages: Record<string, string> = {
  connected:
    "Microsoft 365 connected. Cora can now read your calendar and relevant email.",
  cancelled:
    "Microsoft connection was cancelled. You can try again when ready.",
  wrong_account:
    "That Microsoft account does not match your Command sign-in. Connect using your HCPA Command email.",
  failed:
    "Microsoft connection was not completed. Retry Connect; check the HCPA app permissions if it continues.",
};
export function ConnectionPanel({ client }: { client: AppClient }) {
  const [connectionError] = useState(() => {
    const value = new URLSearchParams(location.search).get("connection_error") ?? "";
    return /^(state|claim|membership|token_exchange|token_validation|profile|save)\.[a-z_]{1,40}$/.test(value) ? value : "";
  });
  const [status, setStatus] = useState<MicrosoftStatus | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  const [notice, setNotice] = useState(
    () =>
      callbackMessages[
        new URLSearchParams(location.search).get("microsoft") ?? ""
      ] ?? "",
  );
  useEffect(() => {
    const url = new URL(location.href);
    if (url.searchParams.has("microsoft")) {
      url.searchParams.delete("microsoft");
      url.searchParams.delete("connection_error");
      history.replaceState(null, "", url.pathname + url.search);
    }
    let active = true;
    request(client, "status")
      .then((data) => {
        if (active) {
          setStatus(data);
          setError("");
        }
      })
      .catch(() => {
        if (active)
          setError("Microsoft connection status is unavailable. Please retry.");
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
      const result = await request(client, action);
      if (action === "connect") {
        const target = new URL(result.url);
        if (
          target.origin !== "https://login.microsoftonline.com" ||
          target.username ||
          target.password
        )
          throw new Error("Microsoft sign-in URL is invalid.");
        location.assign(target.href);
      } else {
        setStatus((value) => ({
          configured: value?.configured ?? false,
          connected: false,
        }));
        setNotice(
          "Disconnected. Command’s stored Microsoft credentials have been removed. Existing Cora conversations remain.",
        );
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Microsoft connection failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="settings-panel microsoft-panel"
      aria-labelledby="microsoft-title"
    >
      <div className="panel-heading">
        <h2 id="microsoft-title">
          <Icon name="calendar" /> Microsoft 365
        </h2>
        <span className="eyebrow">
          {status?.connected ? "Connected · Read only" : "Calendar + Outlook"}
        </span>
      </div>
      <p className="muted">
        Give Cora the context behind your day: meetings, relevant conversations,
        and follow-ups to review.
      </p>
      {!status && !error && <p role="status">Checking connection…</p>}
      {status && (
        <>
          <p>
            {status.connected
              ? `Connected as ${status.email}`
              : status.configured
                ? "Connect your HCPA account to get started."
                : "Waiting for the HCPA Microsoft app registration to be configured."}
          </p>
          <div className="microsoft-capabilities">
            <span>
              <Icon name="calendar" /> Calendar and meeting context
            </span>
            <span>
              <Icon name="search" /> Relevant Outlook email
            </span>
            <span>
              <Icon name="person" /> Teams comes later
            </span>
          </div>
          <p className="muted small">
            Cora can read your default calendar and mailbox. She cannot send
            messages or change meetings. Relevant excerpts may appear in your
            saved Cora conversations.
          </p>
          <div className="microsoft-actions">
            <button
              disabled={busy || !status.configured}
              onClick={() => void change("connect")}
            >
              {busy
                ? "Working…"
                : status.connected
                  ? "Reconnect Microsoft 365"
                  : "Connect Microsoft 365"}
            </button>
            {status.connected && (
              <button disabled={busy} onClick={() => void change("disconnect")}>
                Disconnect
              </button>
            )}
            {!status.configured && (
              <button
                disabled={busy}
                onClick={() => setRetry((value) => value + 1)}
              >
                Check configuration
              </button>
            )}
          </div>
          {status.connected && (
            <div className="microsoft-prompts">
              <p className="eyebrow">Try with Cora</p>
              {[
                "Help me prepare for my next meeting.",
                "Find recent emails that need a follow-up.",
              ].map((prompt) => (
                <button
                  key={prompt}
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent("command:cora", { detail: prompt }),
                    )
                  }
                >
                  {prompt}
                  <Icon name="arrow" />
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {connectionError && <p className="muted small">Connection reference: {connectionError}</p>}
      {error && (
        <div role="alert" className="error-message">
          <p>{error}</p>
          <button
            disabled={busy}
            onClick={() => setRetry((value) => value + 1)}
          >
            Retry connection status
          </button>
        </div>
      )}
    </section>
  );
}
