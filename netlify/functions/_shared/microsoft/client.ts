import { InteractionRequiredAuthError } from "@azure/msal-node";
import { microsoftApp, boundedResponse } from "./msal";
import type { AppClient } from "../../../../src/platform/supabase";
import type { MicrosoftConfig } from "./config";
import { scopes } from "./config";
import { seal, unseal } from "./crypto";

export function graphUrl(
  value: string,
  resource: "calendarView" | "messages" | "me",
) {
  const url = new URL(value);
  const prefix = resource === "me" ? "/v1.0/me" : `/v1.0/me/${resource}`;
  if (
    url.origin !== "https://graph.microsoft.com" ||
    url.username ||
    url.password ||
    url.hash ||
    !(
      url.pathname === prefix ||
      (resource === "messages" && url.pathname.startsWith(prefix + "/"))
    )
  )
    throw new Error("Invalid Microsoft resource.");
  return url;
}
export async function graphRead(
  url: URL,
  accessToken: string,
  signal: AbortSignal,
) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Prefer: 'outlook.body-content-type="text", outlook.timezone="UTC"',
    },
    redirect: "error",
    signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
  });
  if (!response.ok) {
    if (response.status === 401)
      throw new Error("Microsoft access expired. Reconnect in Settings.");
    if (response.status === 403)
      throw new Error(
        "Microsoft denied access. Check the connection permissions in Settings.",
      );
    if (response.status === 429)
      throw new Error(
        "Microsoft is limiting requests. Please try again later.",
      );
    throw new Error(
      "Microsoft is temporarily unavailable. No external data was changed.",
    );
  }
  return boundedResponse(response) as Promise<Record<string, unknown>>;
}
export async function connection(store: AppClient, userId: string) {
  const [member, row] = await Promise.all([
    store
      .from("app_memberships")
      .select("active")
      .eq("user_id", userId)
      .maybeSingle(),
    store
      .from("microsoft_connections")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  if (member.error || !member.data?.active || row.error)
    throw new Error("Microsoft connection is unavailable.");
  return row.data;
}
export async function microsoftToken(
  store: AppClient,
  userId: string,
  config: MicrosoftConfig,
  signal: AbortSignal,
) {
  const row = await connection(store, userId);
  if (!row?.token_cache || !row.account_id)
    throw new Error("Microsoft 365 is not connected. Connect it in Settings.");
  const app = microsoftApp(config, signal),
    context = `${userId}:${row.generation}:cache`;
  try {
    app
      .getTokenCache()
      .deserialize(unseal(row.token_cache, config.encryptionKey, context));
    const account = await app
      .getTokenCache()
      .getAccountByHomeId(row.account_id);
    if (
      !account ||
      account.tenantId.toLowerCase() !== config.tenantId.toLowerCase()
    )
      throw new Error("account_missing");
    const token = await app.acquireTokenSilent({ account, scopes });
    if (!token?.accessToken) throw new Error("token_missing");
    // Compare-and-swap: a concurrent disconnect/reconnect can never be undone by
    // a slow refresh, nor can a stale refresh overwrite a newer token cache.
    const saved = await store
      .from("microsoft_connections")
      .update({
        token_cache: seal(
          app.getTokenCache().serialize(),
          config.encryptionKey,
          context,
        ),
        revision: row.revision + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("generation", row.generation)
      .eq("revision", row.revision)
      .select("user_id")
      .maybeSingle();
    if (saved.error || !saved.data) throw new Error("connection_changed");
    return { accessToken: token.accessToken, generation: row.generation };
  } catch (error) {
    if (
      error instanceof InteractionRequiredAuthError ||
      (error &&
        typeof error === "object" &&
        "errorCode" in error &&
        error.errorCode === "invalid_grant")
    ) {
      await store
        .from("microsoft_connections")
        .delete()
        .eq("user_id", userId)
        .eq("generation", row.generation)
        .eq("revision", row.revision);
      throw new Error(
        "Microsoft requires sign-in again. Reconnect in Settings.",
        { cause: error },
      );
    }
    throw new Error(
      "Microsoft access could not be refreshed. Retry, or reconnect in Settings.",
      { cause: error },
    );
  }
}
