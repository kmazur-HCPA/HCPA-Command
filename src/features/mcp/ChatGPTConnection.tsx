import { useEffect, useState } from "react";
import type { AppClient } from "../../platform/supabase";
type Connection = {
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
};
async function request(
  client: AppClient,
  action: "status" | "create" | "revoke",
) {
  const { data, error } = await client.auth.getSession();
  if (error || !data.session)
    throw new Error("Sign in to manage ChatGPT access.");
  const response = await fetch(`/api/cora/connection/${action}`, {
    method: action === "status" ? "GET" : "POST",
    headers: { Authorization: `Bearer ${data.session.access_token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message ?? "Connection unavailable.");
  return body;
}
export function ChatGPTConnection({ client }: { client: AppClient }) {
  const [checkedAt, setCheckedAt] = useState(() => Date.now());
  const [connection, setConnection] = useState<Connection | null>(null),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [token, setToken] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    void request(client, "status")
      .then((data) => {
        if (active) {
          setConnection(data.connection);
          setCheckedAt(Date.now());
          setLoaded(true);
          setError("");
        }
      })
      .catch(() => {
        if (active) setError("ChatGPT connection status is unavailable.");
      });
    return () => {
      active = false;
    };
  }, [client, retry]);
  async function change(action: "create" | "revoke") {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    setToken("");
    try {
      const result = await request(client, action);
      if (action === "create") {
        setToken(result.token);
        setNotice(
          "Copy this token into your private Command app in ChatGPT. It is shown only once.",
        );
      } else
        setNotice("ChatGPT access revoked. Existing conversations remain.");
      setRetry((r) => r + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const active = connection && Date.parse(connection.expires_at) > checkedAt;
  return (
    <section className="settings-panel" aria-labelledby="chatgpt-title">
      <h2 id="chatgpt-title">Cora in ChatGPT</h2>
      <p className="muted">
        Connect your private Cora agent to live Command, Outlook, Calendar and
        Teams context. Task proposals open here for your confirmation. Messages
        and meetings cannot be changed.
      </p>
      {!loaded && !error && <p role="status">Checking connection…</p>}
      {loaded && (
        <>
          <p>
            {active
              ? `Access enabled until ${new Date(connection.expires_at).toLocaleDateString()}.`
              : connection
                ? "Your ChatGPT token has expired."
                : "ChatGPT access is not enabled."}
          </p>
          {connection?.last_used_at && (
            <p className="muted small">
              Last used {new Date(connection.last_used_at).toLocaleString()}
            </p>
          )}
          <p className="muted small">
            MCP server: <code>https://cmd.hillspafl.gov/api/mcp</code> ·
            Authentication: Access token / API key · Bearer
          </p>
          <div className="actions">
            <button disabled={busy} onClick={() => void change("create")}>
              {busy
                ? "Working…"
                : active
                  ? "Replace ChatGPT token"
                  : "Create ChatGPT token"}
            </button>
            {connection && (
              <button disabled={busy} onClick={() => void change("revoke")}>
                Revoke ChatGPT access
              </button>
            )}
          </div>
          {active && (
            <p className="muted small">
              Replacing the token immediately disconnects its previous copy.
              Tokens expire after 90 days and cannot sign in to Command.
            </p>
          )}
        </>
      )}
      {token && (
        <div>
          <label>
            ChatGPT connection token
            <input
              autoComplete="off"
              spellCheck={false}
              readOnly
              type="password"
              value={token}
            />
          </label>
          <div className="actions">
            <button
              onClick={() =>
                void navigator.clipboard
                  .writeText(token)
                  .then(() =>
                    setNotice(
                      "Token copied. Paste it only into your private Command app in ChatGPT.",
                    ),
                  )
                  .catch(() =>
                    setError(
                      "Copy failed. Select the token field and copy manually.",
                    ),
                  )
              }
            >
              Copy token
            </button>
            <button onClick={() => setToken("")}>Hide token</button>
          </div>
        </div>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <div role="alert">
          <p className="error-message">{error}</p>
          <button onClick={() => setRetry((r) => r + 1)}>
            Retry ChatGPT status
          </button>
        </div>
      )}
    </section>
  );
}
