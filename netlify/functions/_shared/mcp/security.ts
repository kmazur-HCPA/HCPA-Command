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
