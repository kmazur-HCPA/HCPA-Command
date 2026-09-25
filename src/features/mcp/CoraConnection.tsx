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
    throw new Error("Sign in to manage connected apps.");
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
type Grant = { client: { id: string; name: string }; granted_at: string };
// Claude connectors that signed in with Command (Supabase OAuth grants).
function SignedInApps({ client }: { client: AppClient }) {
  const [grants, setGrants] = useState<Grant[] | null>(null),
    [unavailable, setUnavailable] = useState(false),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    void client.auth.oauth.listGrants().then(({ data, error }) => {
      if (!active) return;
      if (error) setUnavailable(true);
      else setGrants(data ?? []);
    });
    return () => {
      active = false;
    };
  }, [client, reload]);
  async function revoke(id: string) {
    setBusy(id);
    setError("");
    const { error } = await client.auth.oauth.revokeGrant({ clientId: id });
    setBusy("");
    if (error) setError("Access was not revoked. Retry.");
    setReload((r) => r + 1);
  }
  if (unavailable)
    return (
      <p className="muted small">
        Sign-in connections are not enabled for Command yet.
      </p>
    );
  if (!grants) return <p role="status">Checking signed-in apps…</p>;
  return (
    <div>
      <h3>Signed-in apps</h3>
      {!grants.length && (
        <p className="muted small">No apps have signed in with Command.</p>
      )}
      {grants.map((grant) => (
        <div className="actions" key={grant.client.id}>
          <span>
            {grant.client.name || "Unnamed app"} · since{" "}
            {new Date(grant.granted_at).toLocaleDateString()}
          </span>
          <button
            disabled={!!busy}
            onClick={() => void revoke(grant.client.id)}
          >
            {busy === grant.client.id ? "Revoking…" : "Revoke"}
          </button>
        </div>
      ))}
      {error && <p role="alert" className="error-message">{error}</p>}
    </div>
  );
}
export function CoraConnection({ client }: { client: AppClient }) {
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
        if (active) setError("Connected app status is unavailable.");
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
          "Copy this token into your MCP client’s authorization header. It is shown only once.",
        );
      } else
        setNotice("Connected app access revoked. Existing conversations remain.");
      setRetry((r) => r + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const active = connection && Date.parse(connection.expires_at) > checkedAt;
  return (
    <section className="settings-panel" aria-labelledby="connector-title">
      <h2 id="connector-title">Cora in connected apps</h2>
      <p className="muted">
        Use Cora in Claude on the web, Desktop or Claude Code. Add a custom
        connector with the address below and sign in with your Command
        account. Requested tasks, reminders, people, projects, initiatives,
        journal and AI Lab records save directly. Edits to existing records
        open here for confirmation. Messages and meetings cannot be changed.
      </p>
      <p className="muted small">
        Connector address: <code>https://cmd.hillspafl.gov/api/mcp</code>
      </p>
      <SignedInApps client={client} />
      <h3>Personal token (optional)</h3>
      <p className="muted small">
        For MCP clients that cannot sign in, such as a scripted Claude Code
        setup. Header: <code>Authorization: Bearer</code> + token.
      </p>
      {!loaded && !error && <p role="status">Checking connection…</p>}
      {loaded && (
        <>
          <p>
            {active
              ? `Access enabled until ${new Date(connection.expires_at).toLocaleDateString()}.`
              : connection
                ? "Your connection token has expired."
                : "Connected app access is not enabled."}
          </p>
          {connection?.last_used_at && (
            <p className="muted small">
              Last used {new Date(connection.last_used_at).toLocaleString()}
            </p>
          )}
          <div className="actions">
            <button disabled={busy} onClick={() => void change("create")}>
              {busy
                ? "Working…"
                : active
                  ? "Replace connection token"
                  : "Create connection token"}
            </button>
            {connection && (
              <button disabled={busy} onClick={() => void change("revoke")}>
                Revoke connected app access
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
            Connection token
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
                      "Token copied. Paste it only into your own MCP client configuration.",
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
            Retry connection status
          </button>
        </div>
      )}
    </section>
  );
}
