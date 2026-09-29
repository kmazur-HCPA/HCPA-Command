import { trustedRedirect } from "../../../../src/features/oauth/redirect";
import { digest, nonce } from "../microsoft/crypto";
import {
  headers,
  issueAccessToken,
  issueRefreshToken,
  sessionUser,
  storeClient,
  uuidPattern,
  type McpConfig,
} from "./security";

// Command is its own OAuth 2.1 authorization server for the Claude connector:
// dynamic client registration, authorization code + PKCE (S256), rotating refresh
// tokens. Kevin approves with his normal Command sign-in on /oauth/authorize.
const ACCESS_SECONDS = 3600;
const CODE_MINUTES = 5;
const challengePattern = /^[A-Za-z0-9_-]{43}$/;
const verifierPattern = /^[A-Za-z0-9._~-]{43,128}$/;
const oauthHeaders = { ...headers, Pragma: "no-cache" };

export function protectedResource(origin: string) {
  return Response.json(
    {
      resource: `${origin}/api/mcp`,
      authorization_servers: [origin],
      bearer_methods_supported: ["header"],
      resource_name: "Command Cora",
    },
    {
      headers: {
        "Cache-Control": "public, max-age=300",
        "Access-Control-Allow-Origin": "*",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
export function authorizationServer(origin: string) {
  return Response.json(
    {
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/api/oauth/token`,
      registration_endpoint: `${origin}/api/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    },
    {
      headers: {
        "Cache-Control": "public, max-age=300",
        "Access-Control-Allow-Origin": "*",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

async function readBody(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > 20000)
    throw new Error("Request too large.");
  const text = await request.text();
  if (text.length > 20000) throw new Error("Request too large.");
  const type = request.headers.get("content-type") ?? "";
  if (type.startsWith("application/x-www-form-urlencoded"))
    return Object.fromEntries(new URLSearchParams(text)) as Record<string, unknown>;
  if (type.startsWith("application/json")) {
    const value = JSON.parse(text);
    if (value && typeof value === "object" && !Array.isArray(value))
      return value as Record<string, unknown>;
  }
  throw new Error("Unsupported request.");
}
const text = (value: unknown, max: number) =>
  typeof value === "string" && value.length <= max ? value : "";

export async function handleOAuth(request: Request, config: McpConfig) {
  const path = new URL(request.url).pathname;
  if (request.method !== "POST")
    return Response.json(
      { error: "invalid_request", message: "POST required." },
      { status: 405, headers: oauthHeaders },
    );
  if (path === "/api/oauth/register") return register(request, config);
  if (path === "/api/oauth/token") return token(request, config);
  if (path === "/api/oauth/authorize") return authorize(request, config);
  return Response.json({ message: "Not found." }, { status: 404, headers });
}

// RFC 7591: public clients only, and only return addresses Claude may use.
async function register(request: Request, config: McpConfig) {
  const fail = (error: string, description: string, status = 400) =>
    Response.json(
      { error, error_description: description },
      { status, headers: oauthHeaders },
    );
  let body: Record<string, unknown>;
  try {
    body = await readBody(request);
  } catch {
    return fail("invalid_client_metadata", "A JSON body is required.");
  }
  const uris = body.redirect_uris;
  if (
    !Array.isArray(uris) ||
    uris.length < 1 ||
    uris.length > 5 ||
    !uris.every(
      (u) => typeof u === "string" && u.length <= 2048 && trustedRedirect(u),
    )
  )
    return fail(
      "invalid_redirect_uri",
      "Only Claude callback addresses are accepted.",
    );
  const name = text(body.client_name, 100).trim() || "Claude";
  try {
    const { data, error } = await storeClient(config).rpc(
      "cora_oauth_register",
      { p_name: name, p_uris: uris as string[] },
    );
    if (error || !data) return fail("server_error", "Registration unavailable.", 503);
    return Response.json(
      {
        client_id: data,
        client_name: name,
        redirect_uris: uris,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        client_id_issued_at: Math.floor(Date.now() / 1000),
      },
      { status: 201, headers: oauthHeaders },
    );
  } catch {
    return fail("server_error", "Registration unavailable.", 503);
  }
}

// Called by Command's own consent page with the signed-in browser session.
async function authorize(request: Request, config: McpConfig) {
  const respond = (status: number, message: string) =>
    Response.json({ message }, { status, headers });
  if (request.headers.get("origin") !== config.origin)
    return respond(403, "Origin not allowed.");
  const user = await sessionUser(request, config);
  if (user instanceof Response) return user;
  let body: Record<string, unknown>;
  try {
    body = await readBody(request);
  } catch {
    return respond(400, "Invalid request.");
  }
  const clientId = text(body.client_id, 64),
    redirect = text(body.redirect_uri, 2048),
    challenge = text(body.code_challenge, 128),
    state = text(body.state, 2048),
    decision = body.decision;
  if (
    !uuidPattern.test(clientId) ||
    !["details", "approve", "deny"].includes(String(decision)) ||
    (body.response_type ?? "code") !== "code" ||
    body.code_challenge_method !== "S256" ||
    !challengePattern.test(challenge)
  )
    return respond(400, "This connection request is invalid.");
  if (body.resource) {
    try {
      if (new URL(text(body.resource, 2048)).origin !== config.origin)
        return respond(400, "This connection request is for another service.");
    } catch {
      return respond(400, "This connection request is invalid.");
    }
  }
  try {
    const store = storeClient(config);
    const client = await store
      .from("cora_oauth_clients")
      .select("id,name,redirect_uris")
      .eq("id", clientId)
      .maybeSingle();
    if (client.error) return respond(503, "Connection request unavailable.");
    if (
      !client.data ||
      !client.data.redirect_uris.includes(redirect) ||
      !trustedRedirect(redirect)
    )
      return respond(400, "This connection request is invalid or has expired.");
    if (decision === "details")
      return Response.json(
        {
          client_name: client.data.name,
          redirect_host: new URL(redirect).host,
          email: user.email ?? "",
        },
        { headers },
      );
    const target = new URL(redirect);
    if (decision === "deny") target.searchParams.set("error", "access_denied");
    else {
      const code = nonce();
      const saved = await store.from("cora_oauth_codes").insert({
        code_hash: digest(code),
        client_id: clientId,
        user_id: user.id,
        redirect_uri: redirect,
        code_challenge: challenge,
        expires_at: new Date(Date.now() + CODE_MINUTES * 60000).toISOString(),
      });
      if (saved.error) return respond(503, "Connection request unavailable.");
      target.searchParams.set("code", code);
    }
    if (state) target.searchParams.set("state", state);
    return Response.json({ redirect_url: target.toString() }, { headers });
  } catch {
    return respond(503, "Connection request unavailable.");
  }
}

async function token(request: Request, config: McpConfig) {
  const fail = (error: string, description: string, status = 400) =>
    Response.json(
      { error, error_description: description },
      { status, headers: oauthHeaders },
    );
  let body: Record<string, unknown>;
  try {
    body = await readBody(request);
  } catch {
    return fail("invalid_request", "A form or JSON body is required.");
  }
  const clientId = text(body.client_id, 64);
  if (!uuidPattern.test(clientId))
    return fail("invalid_client", "Unknown client.", 401);
  const access = issueAccessToken(),
    refresh = issueRefreshToken();
  try {
    const store = storeClient(config);
    let result;
    if (body.grant_type === "authorization_code") {
      const code = text(body.code, 200),
        verifier = text(body.code_verifier, 128),
        redirect = text(body.redirect_uri, 2048);
      if (!code || !redirect || !verifierPattern.test(verifier))
        return fail("invalid_request", "Missing or malformed parameters.");
      result = await store.rpc("cora_oauth_redeem", {
        p_code_hash: digest(code),
        p_client: clientId,
        p_redirect: redirect,
        p_challenge: digest(verifier),
        p_access_hash: digest(access),
        p_refresh_hash: digest(refresh),
        p_access_seconds: ACCESS_SECONDS,
      });
    } else if (body.grant_type === "refresh_token") {
      const old = text(body.refresh_token, 200);
      if (!old) return fail("invalid_request", "A refresh token is required.");
      result = await store.rpc("cora_oauth_refresh", {
        p_refresh_hash: digest(old),
        p_client: clientId,
        p_new_refresh: digest(refresh),
        p_access_hash: digest(access),
        p_access_seconds: ACCESS_SECONDS,
      });
    } else return fail("unsupported_grant_type", "Unsupported grant type.");
    // Only a definite refusal is invalid_grant; anything else is retryable.
    if (result.error)
      return fail("temporarily_unavailable", "Try again shortly.", 503);
    if (!result.data?.ok)
      return fail("invalid_grant", "The code or refresh token is not valid.");
    return Response.json(
      {
        access_token: access,
        token_type: "Bearer",
        expires_in: ACCESS_SECONDS,
        refresh_token: refresh,
      },
      { headers: oauthHeaders },
    );
  } catch {
    return fail("temporarily_unavailable", "Try again shortly.", 503);
  }
}
