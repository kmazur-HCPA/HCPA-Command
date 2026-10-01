import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "../../../../src/data/database.types";
import { sanitizeSummary } from "../../../../src/features/helix/model";
import { digest, nonce, seal, unseal } from "../microsoft/crypto";
import {
  authorizeUrl,
  helixResource,
  tokenUrl,
  type HelixConfig,
} from "./config";

export type HelixServerConfig = {
  url: string;
  key: string;
  secret: string;
  helix?: HelixConfig;
};
const headers = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};
const cookieName = (origin: string) =>
  origin.startsWith("https:") ? "__Host-command-helix" : "command-helix-dev";
const cookie = (origin: string, value: string, age: number) =>
  `${cookieName(origin)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${origin.startsWith("https:") ? "; Secure" : ""}`;
const paths = {
  status: "GET",
  summary: "GET",
  callback: "GET",
  connect: "POST",
  disconnect: "POST",
} as const;
// Command waits at most four seconds for Helix, then falls back to the cached summary.
const helixTimeoutMs = 4000;

type Tokens = { a: string; r: string; e: number };
type Store = ReturnType<typeof createClient<Database>>;

async function tokenRequest(
  config: HelixConfig,
  params: Record<string, string>,
  signal: AbortSignal,
) {
  const response = await fetch(tokenUrl(config), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      ...params,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
    redirect: "error",
    signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
  });
  const body = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (
    !response.ok ||
    typeof body.access_token !== "string" ||
    typeof body.refresh_token !== "string"
  )
    throw Object.assign(new Error("helix_token"), {
      // 400/401 from the token endpoint means the grant is no longer valid.
      invalid: response.status === 400 || response.status === 401,
    });
  const lifetime = Number(body.expires_in);
  return {
    a: body.access_token,
    r: body.refresh_token,
    e: Date.now() + (Number.isFinite(lifetime) ? lifetime : 3600) * 1000,
  } satisfies Tokens;
}

async function row(store: Store, userId: string) {
  const [member, result] = await Promise.all([
    store
      .from("app_memberships")
      .select("active")
      .eq("user_id", userId)
      .maybeSingle(),
    store
      .from("helix_connections")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  if (member.error || !member.data?.active || result.error)
    throw new Error("Helix connection is unavailable.");
  return result.data;
}

/** Returns a usable access token, refreshing and rotating the stored refresh token if needed. */
async function accessToken(
  store: Store,
  userId: string,
  config: HelixConfig,
  signal: AbortSignal,
  force = false,
) {
  const current = await row(store, userId);
  if (!current?.tokens)
    throw Object.assign(new Error("not_connected"), { code: 409 });
  const context = `${userId}:${current.generation}:helix`;
  const tokens = JSON.parse(
    unseal(current.tokens, config.encryptionKey, context),
  ) as Tokens;
  if (!force && tokens.e - Date.now() > 60000)
    return { token: tokens.a, generation: current.generation };
  let next: Tokens;
  try {
    next = await tokenRequest(
      config,
      { grant_type: "refresh_token", refresh_token: tokens.r },
      signal,
    );
  } catch (error) {
    if ((error as { invalid?: boolean }).invalid) {
      // Revoked or expired in Helix: drop the credentials so the user reconnects.
      await store
        .from("helix_connections")
        .delete()
        .eq("user_id", userId)
        .eq("generation", current.generation)
        .eq("revision", current.revision);
      throw Object.assign(new Error("reconnect"), { code: 409 });
    }
    throw error;
  }
  // Compare-and-swap so a concurrent refresh or disconnect is never overwritten.
  const saved = await store
    .from("helix_connections")
    .update({
      tokens: seal(JSON.stringify(next), config.encryptionKey, context),
      revision: current.revision + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("generation", current.generation)
    .eq("revision", current.revision)
    .select("user_id")
    .maybeSingle();
  if (saved.error || !saved.data) throw new Error("connection_changed");
  return { token: next.a, generation: current.generation };
}

export async function handleHelix(
  request: Request,
  settings: HelixServerConfig,
) {
  const name = new URL(request.url).pathname.replace("/api/helix/", ""),
    config = settings.helix;
  const respond = (status: number, message: string) =>
    Response.json({ message }, { status, headers });
  if (!Object.hasOwn(paths, name)) return respond(404, "Not found.");
  if (request.method !== paths[name as keyof typeof paths])
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
  const finish = (result: string) =>
    new Response(null, {
      status: 303,
      headers: {
        ...headers,
        Location: `${config!.origin}/?page=settings&helix=${result}`,
        "Set-Cookie": cookie(config!.origin, "", 0),
      },
    });
  try {
    if (name === "callback") {
      if (!config) return respond(503, "Helix is not configured.");
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
        .from("helix_connections")
        .select("*")
        .eq("auth_state", digest(state))
        .eq("browser_hash", digest(browser))
        .gt("auth_expires_at", new Date().toISOString())
        .maybeSingle();
      const found = pending.data;
      if (pending.error || !found?.verifier) return finish("failed");
      // Single use: claim the attempt before spending the authorization code.
      const consumed = await store
        .from("helix_connections")
        .update({
          auth_state: null,
          browser_hash: null,
          verifier: null,
          auth_expires_at: null,
        })
        .eq("user_id", found.user_id)
        .eq("generation", found.generation)
        .eq("auth_state", digest(state))
        .select("user_id")
        .maybeSingle();
      if (consumed.error || !consumed.data) return finish("failed");
      if (params.has("error") || !code || code.length > 10000)
        return finish("cancelled");
      const active = await row(store, found.user_id);
      if (!active || active.generation !== found.generation)
        return finish("failed");
      const tokens = await tokenRequest(
        config,
        {
          grant_type: "authorization_code",
          code,
          redirect_uri: config.origin + "/api/helix/callback",
          code_verifier: unseal(
            found.verifier,
            config.encryptionKey,
            `${found.user_id}:${found.generation}:verifier`,
          ),
        },
        signal,
      );
      const saved = await store
        .from("helix_connections")
        .update({
          tokens: seal(
            JSON.stringify(tokens),
            config.encryptionKey,
            `${found.user_id}:${found.generation}:helix`,
          ),
          connected_at: new Date().toISOString(),
          summary: null,
          summary_at: null,
          revision: 1,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", found.user_id)
        .eq("generation", found.generation)
        .select("user_id")
        .maybeSingle();
      return finish(saved.error || !saved.data ? "failed" : "connected");
    }

    const auth = request.headers.get("authorization") ?? "";
    if (auth.length > 8192 || !/^Bearer [^\s]+$/i.test(auth))
      return respond(401, "Sign in to use Helix.");
    const client = createClient<Database>(settings.url, settings.key, {
      auth: authOptions,
      global: { headers: { Authorization: auth }, fetch: timedFetch },
    });
    const identity = await client.auth.getUser(auth.slice(7)),
      user = identity.data.user;
    if (identity.error || !user?.email || user.is_anonymous)
      return respond(401, "Sign in to use Helix.");
    const member = await client
      .from("app_memberships")
      .select("active")
      .eq("user_id", user.id)
      .maybeSingle();
    if (member.error || !member.data?.active)
      return respond(403, "Command access is unavailable.");

    if (name === "status") {
      if (!config)
        return Response.json(
          { configured: false, connected: false },
          { headers },
        );
      const current = await row(store, user.id);
      return Response.json(
        {
          configured: true,
          connected: !!current?.tokens,
          ...(current?.tokens ? { connectedAt: current.connected_at } : {}),
        },
        { headers },
      );
    }

    if (name === "disconnect") {
      const result = await store
        .from("helix_connections")
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

    if (!config) return respond(503, "Helix is not configured yet.");

    if (name === "summary") {
      const current = await row(store, user.id);
      if (!current?.tokens)
        return respond(409, "Connect Helix in Settings to see Helix work.");
      const cached = sanitizeSummary(current.summary);
      const fallback = (message: string) =>
        cached
          ? Response.json(
              {
                ...cached,
                stale: true,
                retrievedAt: current.summary_at ?? cached.as_of,
              },
              { headers },
            )
          : respond(503, message);
      const call = async (force: boolean) => {
        const { token, generation } = await accessToken(
          store,
          user.id,
          config,
          signal,
          force,
        );
        const response = await fetch(helixResource, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
          redirect: "error",
          signal: AbortSignal.any([
            signal,
            AbortSignal.timeout(helixTimeoutMs),
          ]),
        });
        return { response, generation };
      };
      try {
        let result = await call(false);
        if (result.response.status === 401) result = await call(true);
        if (result.response.status === 403)
          return fallback("Helix access is unavailable for this connection.");
        if (!result.response.ok)
          return fallback("Helix is temporarily unavailable.");
        const text = await result.response.text();
        if (text.length > 200000)
          return fallback("Helix response was too large.");
        const summary = sanitizeSummary(JSON.parse(text));
        if (!summary) return fallback("Helix returned an unexpected response.");
        const retrievedAt = new Date().toISOString();
        await store
          .from("helix_connections")
          .update({ summary, summary_at: retrievedAt })
          .eq("user_id", user.id)
          .eq("generation", result.generation);
        // Re-check so nothing is returned after a disconnect mid-request.
        if ((await row(store, user.id))?.generation !== result.generation)
          return respond(409, "Helix connection changed. Retry.");
        return Response.json(
          { ...summary, stale: false, retrievedAt },
          { headers },
        );
      } catch (error) {
        if ((error as { code?: number }).code === 409)
          return respond(409, "Helix needs to be reconnected in Settings.");
        return fallback("Helix is temporarily unavailable.");
      }
    }

    // connect
    if (request.headers.get("origin") !== config.origin)
      return respond(
        403,
        "Open Command on its configured site to connect Helix.",
      );
    const state = nonce(),
      browser = nonce(),
      verifier = nonce(),
      generation = randomUUID();
    const saved = await store.from("helix_connections").upsert({
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
      tokens: null,
      connected_at: null,
      revision: 1,
      summary: null,
      summary_at: null,
      updated_at: new Date().toISOString(),
    });
    if (saved.error)
      return respond(503, "Helix connection could not be started.");
    const url = new URL(authorizeUrl(config));
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: config.clientId,
      redirect_uri: config.origin + "/api/helix/callback",
      scope: "email",
      state,
      code_challenge: digest(verifier),
      code_challenge_method: "S256",
      resource: helixResource,
    }).toString();
    return Response.json(
      { url: url.href },
      {
        headers: {
          ...headers,
          "Set-Cookie": cookie(config.origin, browser, 600),
        },
      },
    );
  } catch (error) {
    // Never log raw errors: they can contain tokens or work item titles.
    console.warn(
      JSON.stringify({
        event: "helix_connection_failed",
        endpoint: name,
        code: (error as { invalid?: boolean }).invalid
          ? "invalid_grant"
          : "unavailable",
      }),
    );
    return name === "callback" && config
      ? finish("failed")
      : respond(
          503,
          "Helix is temporarily unavailable. Your Command workspace is still available.",
        );
  }
}
