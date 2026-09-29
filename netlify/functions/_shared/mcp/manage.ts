import { randomUUID } from "node:crypto";
import {
  headers,
  issueToken,
  sessionUser,
  tokenHash,
  storeClient,
  uuidPattern,
  type McpConfig,
} from "./security";
import { boundedJson } from "../cora/handler";
const actions = ["status", "create", "revoke", "grants", "revoke-grant"];
export async function manageMcp(request: Request, config: McpConfig) {
  const respond = (status: number, body: object) =>
    Response.json(body, { status, headers });
  const action = new URL(request.url).pathname.split("/").pop() ?? "";
  if (!actions.includes(action)) return respond(404, { message: "Not found." });
  if (request.method !== (["status", "grants"].includes(action) ? "GET" : "POST"))
    return respond(405, { message: "Method not allowed." });
  if (
    request.headers.get("origin") &&
    request.headers.get("origin") !== config.origin
  )
    return respond(403, { message: "Origin not allowed." });
  // A Command session is required. An MCP credential cannot manage credentials.
  const user = await sessionUser(request, config);
  if (user instanceof Response) return user;
  try {
    const store = storeClient(config);
    if (action === "grants") {
      const r = await store
        .from("cora_oauth_grants")
        .select(
          "id,created_at,refreshed_at,last_used_at,refresh_expires_at,client:cora_oauth_clients(name)",
        )
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      if (r.error) throw new Error();
      return respond(200, {
        grants: r.data.map(({ client, ...grant }) => ({
          ...grant,
          name: client?.name ?? "",
        })),
        serverUrl: `${config.origin}/api/mcp`,
      });
    }
    if (action === "revoke-grant") {
      const body = await boundedJson(request).catch(() => null);
      if (!body || typeof body.id !== "string" || !uuidPattern.test(body.id))
        return respond(400, { message: "Choose a connected app to revoke." });
      const r = await store
        .from("cora_oauth_grants")
        .delete()
        .eq("id", body.id)
        .eq("user_id", user.id);
      if (r.error) throw new Error();
      return respond(200, { revoked: true });
    }
    if (action === "status") {
      const r = await store
        .from("cora_mcp_connections")
        .select("created_at,expires_at,last_used_at")
        .eq("user_id", user.id)
        .maybeSingle();
      if (r.error) throw new Error();
      return respond(200, {
        connection: r.data,
        serverUrl: `${config.origin}/api/mcp`,
      });
    }
    if (action === "revoke") {
      const r = await store
        .from("cora_mcp_connections")
        .delete()
        .eq("user_id", user.id);
      if (r.error) throw new Error();
      return respond(200, { revoked: true });
    }
    const token = issueToken(),
      now = new Date(),
      expires = new Date(now.getTime() + 90 * 86400000).toISOString();
    const r = await store
      .from("cora_mcp_connections")
      .upsert(
        {
          user_id: user.id,
          id: randomUUID(),
          token_hash: tokenHash(token),
          created_at: now.toISOString(),
          expires_at: expires,
          last_used_at: null,
        },
        { onConflict: "user_id" },
      );
    if (r.error) throw new Error();
    return respond(200, { token, expires_at: expires });
  } catch {
    return respond(503, {
      message: "The connection could not be updated. Please retry.",
    });
  }
}
