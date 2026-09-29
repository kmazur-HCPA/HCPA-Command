import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../../../src/data/database.types";
import type { AppClient } from "../../../../src/platform/supabase";
import type { MicrosoftConfig } from "../microsoft/config";
import { digest, nonce, seal, unseal } from "../microsoft/crypto";
export type McpConfig = {
  url: string;
  key: string;
  secret: string;
  origin: string;
  microsoft?: MicrosoftConfig;
};
export const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
export const tokenPattern = /^cmd_mcp_[A-Za-z0-9_-]{43}$/;
export const issueToken = () => "cmd_mcp_" + nonce();
export const tokenHash = digest;
export function storeClient(config: McpConfig, authorization?: string) {
  return createClient<Database>(
    config.url,
    authorization ? config.key : config.secret,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        ...(authorization ? { headers: { Authorization: authorization } } : {}),
        fetch: (input, init) =>
          fetch(input, {
            ...init,
            signal: AbortSignal.any([
              AbortSignal.timeout(8000),
              ...(init?.signal ? [init.signal] : []),
            ]),
          }),
      },
    },
  );
}
// A grant is whoever the MCP request authenticates as, however it signed in.
// For OAuth, id is the grant ID (the audit connection_id and reference context).
export type McpGrant = {
  user_id: string;
  id: string;
  kind: "token" | "oauth";
};
export const accessPattern = /^cmd_at_[A-Za-z0-9_-]{43}$/;
export const issueAccessToken = () => "cmd_at_" + nonce();
export const issueRefreshToken = () => "cmd_rt_" + nonce();
export const uuidPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
// Accepts only access tokens issued by Command's own OAuth server. One database
// call confirms the token, its grant and the owner's active membership at once.
export async function authorizeOAuth(
  store: AppClient,
  token: string,
): Promise<McpGrant | null> {
  if (!accessPattern.test(token)) return null;
  const { data, error } = await store.rpc("cora_oauth_verify", {
    p_hash: tokenHash(token),
  });
  if (error) throw new Error("Connection verification unavailable.");
  return data ? { user_id: data.user_id, id: data.grant_id, kind: "oauth" } : null;
}
// Command browser session (never an MCP credential) for the management and
// consent endpoints. Returns the active member's Supabase user or a response.
export async function sessionUser(request: Request, config: McpConfig) {
  const respond = (status: number, message: string) =>
    Response.json({ message }, { status, headers });
  const auth = request.headers.get("authorization") ?? "";
  if (!/^Bearer [^\s]+$/i.test(auth) || auth.length > 8192)
    return respond(401, "Sign in to Command.");
  const bearer = auth.slice(7);
  if (bearer.startsWith("cmd_mcp_") || bearer.startsWith("cmd_at_"))
    return respond(401, "Sign in to Command.");
  try {
    const client = storeClient(config, auth);
    const result = await client.auth.getUser(bearer);
    const user = result.data.user;
    if (result.error || !user || user.is_anonymous)
      return respond(401, "Sign in to Command.");
    const member = await client
      .from("app_memberships")
      .select("active")
      .eq("user_id", user.id)
      .maybeSingle();
    if (member.error) return respond(503, "Access verification unavailable.");
    if (!member.data?.active)
      return respond(403, "Command access unavailable.");
    return user;
  } catch {
    return respond(503, "Access verification unavailable.");
  }
}
export async function authorize(store: AppClient, hash: string) {
  const { data, error } = await store
    .from("cora_mcp_connections")
    .select("*")
    .eq("token_hash", hash)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) throw new Error("Connection verification unavailable.");
  if (!data) return null;
  const member = await store
    .from("app_memberships")
    .select("active")
    .eq("user_id", data.user_id)
    .maybeSingle();
  if (member.error) throw new Error("Connection verification unavailable.");
  return member.data?.active ? data : null;
}
// Opaque discovery references are bound to owner, MCP credential, Microsoft
// connection generation and purpose. They expire without storing message text.
export function referenceCodec<T>(
  key: string,
  context: string,
  now = () => Date.now(),
) {
  return {
    issue: (value: T) =>
      seal(
        JSON.stringify({ value, expires: now() + 20 * 60000 }),
        key,
        `mcp-reference:${context}`,
      ),
    resolve: (reference: string): T => {
      if (reference.length > 12000)
        throw new Error("Reference unavailable. Search again.");
      try {
        const parsed = JSON.parse(
          unseal(reference, key, `mcp-reference:${context}`),
        );
        if (
          typeof parsed.expires !== "number" ||
          parsed.expires <= now() ||
          parsed.expires > now() + 20 * 60000
        )
          throw new Error();
        return parsed.value as T;
      } catch {
        throw new Error("Reference expired or unavailable. Search again.");
      }
    },
  };
}
