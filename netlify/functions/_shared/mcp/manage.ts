import { randomUUID } from "node:crypto";
import {
  headers,
  issueToken,
  tokenHash,
  storeClient,
  type McpConfig,
} from "./security";
export async function manageMcp(request: Request, config: McpConfig) {
  const respond = (status: number, body: object) =>
    Response.json(body, { status, headers });
  const action = new URL(request.url).pathname.split("/").pop();
  if (!["status", "create", "revoke"].includes(action ?? ""))
    return respond(404, { message: "Not found." });
  if (request.method !== (action === "status" ? "GET" : "POST"))
    return respond(405, { message: "Method not allowed." });
  if (
    request.headers.get("origin") &&
    request.headers.get("origin") !== config.origin
  )
    return respond(403, { message: "Origin not allowed." });
  const auth = request.headers.get("authorization") ?? "";
  if (!/^Bearer [^\s]+$/i.test(auth) || auth.length > 8192)
    return respond(401, { message: "Sign in to manage connected apps." });
  // A Command session is required. An MCP token cannot create or rotate tokens.
  if (auth.slice(7).startsWith("cmd_mcp_"))
    return respond(401, { message: "Sign in to manage connected apps." });
  try {
    const client = storeClient(config, auth),
      store = storeClient(config);
    const result = await client.auth.getUser(auth.slice(7));
    const user = result.data.user;
    if (result.error || !user || user.is_anonymous)
      return respond(401, { message: "Sign in to manage connected apps." });
    const member = await client
      .from("app_memberships")
      .select("active")
      .eq("user_id", user.id)
      .maybeSingle();
    if (member.error)
      return respond(503, { message: "Access verification unavailable." });
    if (!member.data?.active)
      return respond(403, { message: "Command access unavailable." });
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
