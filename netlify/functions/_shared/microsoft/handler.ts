import { createMicrosoftReader } from "./tools";
import {
  agendaRange,
  workWeekRange,
  calendarInstant,
  type CalendarEvent,
} from "../../../../src/features/microsoft/calendar";
import { microsoftApp } from "./msal";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "../../../../src/data/database.types";
import type { MicrosoftConfig } from "./config";
import { consentScopes, hasTeamsConsent, normalizedScope } from "./config";
import { digest, nonce, seal, unseal } from "./crypto";
import { connection, graphRead, graphUrl } from "./client";
export type MicrosoftServerConfig = {
  url: string;
  key: string;
  secret: string;
  microsoft?: MicrosoftConfig;
};
const headers = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};
const cookieName = (origin: string) =>
  origin.startsWith("https:") ? "__Host-command-ms" : "command-ms-dev";
function cookie(origin: string, value: string, age: number) {
  return `${cookieName(origin)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${origin.startsWith("https:") ? "; Secure" : ""}`;
}
export async function handleMicrosoft(
  request: Request,
  settings: MicrosoftServerConfig,
) {
  const path = new URL(request.url).pathname,
    config = settings.microsoft;
  const respond = (status: number, message: string) =>
    Response.json({ message }, { status, headers });
  const callback = path === "/api/microsoft/callback";
  const expectedMethod =
    callback ||
    path === "/api/microsoft/status" ||
    path === "/api/microsoft/calendar"
      ? "GET"
      : "POST";
  if (
    ![
      "/api/microsoft/callback",
      "/api/microsoft/status",
      "/api/microsoft/calendar",
      "/api/microsoft/connect",
      "/api/microsoft/disconnect",
    ].includes(path)
  )
    return respond(404, "Not found.");
  if (request.method !== expectedMethod)
    return respond(405, "Method not allowed.");
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(25000)]);
  const authOptions = {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  };
  const timedFetch = (input: RequestInfo | URL, init?: RequestInit) =>
    fetch(input, {
      ...init,
      signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
    });
  const store = createClient<Database>(settings.url, settings.secret, {
    auth: authOptions,
    global: { fetch: timedFetch },
  });
  let stage = "state",
    failureCode = "unavailable";
  const finish = (result: string) =>
    new Response(null, {
      status: 303,
      headers: {
        ...headers,
        Location: `${config!.origin}/?page=settings&microsoft=${result}${result === "failed" ? `&connection_error=${stage}.${failureCode}` : ""}`,
        "Set-Cookie": cookie(config!.origin, "", 0),
      },
    });
  try {
    if (callback) {
      if (!config) return respond(503, "Microsoft 365 is not configured.");
      const params = new URL(request.url).searchParams,
        state = params.get("state"),
        code = params.get("code");
      const browser = request.headers
        .get("cookie")
        ?.split(";")
        .map((v) => v.trim())
        .find((v) => v.startsWith(cookieName(config.origin) + "="))
        ?.split("=")[1];
      if (
        !state ||
        !/^[\w-]{43}$/.test(state) ||
        !browser ||
        !/^[\w-]{43}$/.test(browser)
      )
        return finish("failed");
      const pending = await store
        .from("microsoft_connections")
        .select("*")
        .eq("auth_state", digest(state))
        .eq("browser_hash", digest(browser))
        .gt("auth_expires_at", new Date().toISOString())
        .maybeSingle();
      const row = pending.data;
      if (pending.error || !row?.verifier) return finish("failed");
      stage = "claim";
      const consumed = await store
        .from("microsoft_connections")
        .update({
          auth_state: null,
          browser_hash: null,
          verifier: null,
          auth_expires_at: null,
        })
        .eq("user_id", row.user_id)
        .eq("generation", row.generation)
        .eq("auth_state", digest(state))
        .select("user_id")
        .maybeSingle();
      if (consumed.error || !consumed.data) return finish("failed");
      if (params.has("error") || !code || code.length > 10000)
        return finish("cancelled");
      stage = "membership";
      const active = await connection(store, row.user_id);
      if (!active || active.generation !== row.generation)
        return finish("failed");
      const app = microsoftApp(config, signal);
      stage = "token_exchange";
      const token = await app.acquireTokenByCode({
        code,
        scopes: consentScopes,
        redirectUri: config.origin + "/api/microsoft/callback",
        codeVerifier: unseal(
          row.verifier,
          config.encryptionKey,
          `${row.user_id}:${row.generation}:verifier`,
        ),
      });
      stage = "token_validation";
      if (
        !token?.account ||
        token.tenantId.toLowerCase() !== config.tenantId.toLowerCase() ||
        !consentScopes.every((scope) =>
          token.scopes.some(
            (grant) =>
              grant
                .toLowerCase()
                .replace(/^https:\/\/graph\.microsoft\.com\//, "") ===
              scope.toLowerCase(),
          ),
        )
      )
        return finish("failed");
      stage = "profile";
      const profile = await graphRead(
        graphUrl(
          "https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName",
          "me",
        ),
        token.accessToken,
        signal,
      );
      // Bind the Microsoft mailbox to the authenticated Command identity, not to
      // an arbitrary account selected in Microsoft's account picker.
      if (
        ![profile.mail, profile.userPrincipalName].some(
          (email) =>
            typeof email === "string" &&
            email.toLowerCase() === row.account_email?.toLowerCase(),
        )
      )
        return finish("wrong_account");
      stage = "membership";
      const stillActive = await connection(store, row.user_id);
      if (!stillActive || stillActive.generation !== row.generation)
        return finish("failed");
      stage = "save";
      const saved = await store
        .from("microsoft_connections")
        .update({
          token_cache: seal(
            app.getTokenCache().serialize(),
            config.encryptionKey,
            `${row.user_id}:${row.generation}:cache`,
          ),
          granted_scopes: token.scopes.map(normalizedScope),
          account_id: token.account.homeAccountId,
          connected_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", row.user_id)
        .eq("generation", row.generation)
        .select("user_id")
        .maybeSingle();
      return finish(saved.error || !saved.data ? "failed" : "connected");
    }
    const auth = request.headers.get("authorization") ?? "";
    if (auth.length > 8192 || !/^Bearer [^\s]+$/i.test(auth))
      return respond(401, "Sign in to manage Microsoft 365.");
    const client = createClient<Database>(settings.url, settings.key, {
      auth: authOptions,
      global: { headers: { Authorization: auth }, fetch: timedFetch },
    });
    const identity = await client.auth.getUser(auth.slice(7)),
      user = identity.data.user;
    if (identity.error || !user?.email || user.is_anonymous)
      return respond(401, "Sign in to manage Microsoft 365.");
    const member = await client
      .from("app_memberships")
      .select("active")
      .eq("user_id", user.id)
      .maybeSingle();
    if (member.error || !member.data?.active)
      return respond(403, "Command access is unavailable.");
    if (path.endsWith("calendar")) {
      const params = new URL(request.url).searchParams;
      let range: { start: string; end: string };
      try {
        range = params.get("range") === "workweek" ? workWeekRange(params.get("date") ?? "") : agendaRange(
          params.get("date") ?? "",
          Number(params.get("days") ?? "1"),
        );
      } catch {
        return respond(400, "Choose a valid calendar date and range.");
      }
      if (!config || !(await connection(store, user.id))?.token_cache)
        return respond(
          409,
          "Connect Microsoft 365 in Settings to see your calendar.",
        );
      const reader = createMicrosoftReader(
        store,
        user.id,
        config,
        signal,
        new Map(),
      );
      const result = (await reader("get_outlook_calendar", range)) as {
        records: Record<string, unknown>[];
        truncated: boolean;
        retrieved_at: string;
      };
      const events: CalendarEvent[] = result.records
        .filter((row) => !row.isCancelled && row.responseStatus !== "declined")
        .map((row) => {
          const start = calendarInstant(row.start),
            end = calendarInstant(row.end);
          const durationMinutes = Math.round(
            (Date.parse(end) - Date.parse(start)) / 60000,
          );
          if (durationMinutes < 0) throw new Error("Invalid event duration");
          return {
            id: String(row.id),
            subject: String(row.subject || "Untitled event"),
            start,
            end,
            allDay: row.isAllDay === true,
            durationMinutes,
          };
        });
      return Response.json(
        {
          events,
          truncated: result.truncated,
          retrievedAt: result.retrieved_at,
        },
        { headers },
      );
    }
    if (path.endsWith("disconnect")) {
      const result = await store
        .from("microsoft_connections")
        .delete()
        .eq("user_id", user.id);
      if (result.error)
        return respond(503, "Disconnect was not confirmed. Please retry.");
      return Response.json(
        { connected: false },
        {
          headers: {
            ...headers,
            ...(config ? { "Set-Cookie": cookie(config.origin, "", 0) } : {}),
          },
        },
      );
    }
    if (path.endsWith("status")) {
      if (!config)
        return Response.json(
          { configured: false, connected: false },
          { headers },
        );
      const row = await connection(store, user.id);
      return Response.json(
        {
          configured: true,
          connected: !!row?.token_cache,
          teamsConnected:
            !!row?.token_cache && hasTeamsConsent(row.granted_scopes),
          ...(row?.token_cache
            ? { email: row.account_email, connectedAt: row.connected_at }
            : {}),
        },
        { headers },
      );
    }
    if (!config)
      return respond(
        503,
        "Microsoft 365 needs its HCPA app registration configured first.",
      );
    if (request.headers.get("origin") !== config.origin)
      return respond(
        403,
        "Open Command on its configured site to connect Microsoft 365.",
      );
    const state = nonce(),
      browser = nonce(),
      verifier = nonce(),
      generation = randomUUID();
    const app = microsoftApp(config, signal);
    const url = await app.getAuthCodeUrl({
      scopes: [...consentScopes, "offline_access"],
      redirectUri: config.origin + "/api/microsoft/callback",
      state,
      codeChallenge: digest(verifier),
      codeChallengeMethod: "S256",
      prompt: "select_account",
      loginHint: user.email,
    });
    const saved = await store.from("microsoft_connections").upsert({
      user_id: user.id,
      generation,
      auth_state: digest(state),
      browser_hash: digest(browser),
      verifier: seal(
        verifier,
        config.encryptionKey,
        `${user.id}:${generation}:verifier`,
      ),
      auth_expires_at: new Date(Date.now() + 600000).toISOString(),
      granted_scopes: [],
      token_cache: null,
      account_id: null,
      account_email: user.email,
      connected_at: null,
      revision: 1,
      updated_at: new Date().toISOString(),
    });
    if (saved.error)
      return respond(503, "Microsoft connection could not be started.");
    return Response.json(
      { url },
      {
        headers: {
          ...headers,
          "Set-Cookie": cookie(config.origin, browser, 600),
        },
      },
    );
  } catch (error) {
    // Never log raw MSAL/Graph errors: they may contain mailbox data or tokens.
    const knownCodes = [
      "invalid_client",
      "invalid_grant",
      "invalid_scope",
      "invalid_request",
      "endpoints_resolution_error",
      "network_error",
      "client_authentication_required",
      "token_parsing_error",
    ];
    if (
      error &&
      typeof error === "object" &&
      "errorCode" in error &&
      typeof error.errorCode === "string" &&
      knownCodes.includes(error.errorCode)
    )
      failureCode = error.errorCode;
    console.warn(
      JSON.stringify({
        event: "microsoft_connection_failed",
        stage,
        code: failureCode,
      }),
    );
    return callback && config
      ? finish("failed")
      : respond(
          503,
          "Microsoft 365 is temporarily unavailable. Your Command workspace is still available.",
        );
  }
}
