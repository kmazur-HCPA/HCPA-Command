import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { handleOAuth } from "../../netlify/functions/_shared/mcp/oauth";
import { manageMcp } from "../../netlify/functions/_shared/mcp/manage";
import { issueAccessToken } from "../../netlify/functions/_shared/mcp/security";

const owner = "11111111-1111-4111-8111-111111111111";
const clientId = "55555555-5555-4555-8555-555555555555";
const callback = "https://claude.ai/api/mcp/auth_callback";
const cfg = {
  url: "https://fixture.supabase.co",
  key: "public-fixture",
  secret: "secret-fixture",
  origin: "https://cmd.hillspafl.gov",
};
const verifier = "v".repeat(43);
const challenge = createHash("sha256").update(verifier).digest("base64url");
let rpc: { name: string; args: Record<string, unknown> }[],
  rpcResult: unknown,
  rpcStatus: number,
  codes: Record<string, unknown>[],
  clients: Record<string, unknown>[],
  member: boolean;
beforeEach(() => {
  rpc = [];
  codes = [];
  rpcResult = { ok: true };
  rpcStatus = 200;
  member = true;
  clients = [{ id: clientId, name: "Claude", redirect_uris: [callback] }];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const r = new Request(input, init),
        u = new URL(r.url);
      if (u.pathname === "/auth/v1/user")
        return r.headers.get("authorization") === "Bearer session-jwt"
          ? Response.json({ id: owner, email: "kevin@example.test", aud: "authenticated" })
          : Response.json({ message: "invalid" }, { status: 401 });
      if (u.pathname.endsWith("/app_memberships"))
        return Response.json({ active: member });
      if (u.pathname.includes("/rpc/")) {
        rpc.push({ name: u.pathname.split("/").pop()!, args: await r.json() });
        return Response.json(rpcResult, { status: rpcStatus });
      }
      if (u.pathname.endsWith("/cora_oauth_clients"))
        return Response.json(
          clients.find((c) => u.searchParams.get("id") === "eq." + c.id) ?? null,
        );
      if (u.pathname.endsWith("/cora_oauth_codes")) {
        codes.push(await r.json());
        return new Response(null, { status: 201 });
      }
      throw new Error("Unexpected network access " + u.pathname);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());
const json = (path: string, body: unknown, extra: Record<string, string> = {}) =>
  handleOAuth(
    new Request(cfg.origin + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...extra },
      body: JSON.stringify(body),
    }),
    cfg,
  );
const consent = (decision: string, more: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  json(
    "/api/oauth/authorize",
    {
      client_id: clientId,
      redirect_uri: callback,
      response_type: "code",
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "abc",
      resource: cfg.origin + "/api/mcp",
      decision,
      ...more,
    },
    { Origin: cfg.origin, Authorization: "Bearer session-jwt", ...headers },
  );

describe("Dynamic client registration", () => {
  it("registers a public client for Claude callbacks only", async () => {
    rpcResult = clientId;
    const response = await json("/api/oauth/register", { client_name: "Claude", redirect_uris: [callback] });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      client_id: clientId,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
    });
    expect(rpc[0]).toEqual({ name: "cora_oauth_register", args: { p_name: "Claude", p_uris: [callback] } });
  });
  it("refuses untrusted or malformed redirect addresses without touching the database", async () => {
    for (const redirect_uris of [["https://evil.test/cb"], [], "x", [callback, "http://evil.test/"], Array(6).fill(callback)]) {
      const response = await json("/api/oauth/register", { redirect_uris });
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe("invalid_redirect_uri");
    }
    expect(rpc).toHaveLength(0);
  });
});

describe("Consent endpoint", () => {
  it("shows the client and returns to Claude with a single-use code and the original state", async () => {
    const details = await (await consent("details")).json();
    expect(details).toEqual({ client_name: "Claude", redirect_host: "claude.ai", email: "kevin@example.test" });
    const approved = await (await consent("approve")).json();
    const url = new URL(approved.redirect_url);
    expect(url.origin + url.pathname).toBe(callback);
    expect(url.searchParams.get("state")).toBe("abc");
    const code = url.searchParams.get("code")!;
    expect(codes).toHaveLength(1);
    // Only a digest of the code is stored.
    expect(JSON.stringify(codes[0])).not.toContain(code);
    expect(codes[0]).toMatchObject({ user_id: owner, client_id: clientId, redirect_uri: callback, code_challenge: challenge });
    const denied = new URL((await (await consent("deny")).json()).redirect_url);
    expect(denied.searchParams.get("error")).toBe("access_denied");
    expect(denied.searchParams.has("code")).toBe(false);
  });
  it("requires Command's own origin and a signed-in active member, never an MCP token", async () => {
    expect((await consent("approve", {}, { Origin: "https://evil.test" })).status).toBe(403);
    expect((await consent("approve", {}, { Authorization: "Bearer other" })).status).toBe(401);
    expect((await consent("approve", {}, { Authorization: "Bearer " + issueAccessToken() })).status).toBe(401);
    member = false;
    expect((await consent("approve")).status).toBe(403);
    expect(codes).toHaveLength(0);
  });
  it("rejects unknown clients, unregistered redirects, weak PKCE and other resources", async () => {
    for (const bad of [
      { client_id: "66666666-6666-4666-8666-666666666666" },
      { redirect_uri: "https://claude.ai/api/mcp/other" },
      { code_challenge_method: "plain" },
      { code_challenge: "short" },
      { response_type: "token" },
      { resource: "https://other.test/api/mcp" },
      { decision: "delete" },
    ])
      expect((await consent("approve", bad)).status).toBe(400);
    expect(codes).toHaveLength(0);
  });
});

describe("Token endpoint", () => {
  const form = (body: Record<string, string>) =>
    handleOAuth(
      new Request(cfg.origin + "/api/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(body),
      }),
      cfg,
    );
  const exchange = { grant_type: "authorization_code", client_id: clientId, code: "c".repeat(43), redirect_uri: callback, code_verifier: verifier };
  it("issues one-hour access and refresh tokens, storing only digests, after PKCE", async () => {
    const response = await form(exchange);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({ token_type: "Bearer", expires_in: 3600 });
    expect(body.access_token).toMatch(/^cmd_at_[\w-]{43}$/);
    expect(body.refresh_token).toMatch(/^cmd_rt_[\w-]{43}$/);
    const sent = JSON.stringify(rpc[0]);
    expect(sent).not.toContain(body.access_token);
    expect(sent).not.toContain(body.refresh_token);
    expect(sent).not.toContain(verifier);
    expect(rpc[0]!.args).toMatchObject({ p_challenge: challenge, p_client: clientId, p_redirect: callback });
  });
  it("refreshes with a rotated token", async () => {
    const response = await form({ grant_type: "refresh_token", client_id: clientId, refresh_token: "cmd_rt_" + "r".repeat(43) });
    expect(response.status).toBe(200);
    expect(rpc[0]!.name).toBe("cora_oauth_refresh");
    expect((await response.json()).refresh_token).toMatch(/^cmd_rt_/);
  });
  it("tells the client to reauthorize only when the grant is definitely invalid", async () => {
    rpcResult = { ok: false };
    const refused = await form(exchange);
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toBe("invalid_grant");
    rpcResult = { message: "db down" };
    rpcStatus = 503;
    const outage = await form(exchange);
    expect(outage.status).toBe(503);
    expect((await outage.json()).error).toBe("temporarily_unavailable");
  });
  it("rejects malformed requests before the database", async () => {
    expect((await form({ ...exchange, client_id: "nope" })).status).toBe(401);
    expect((await form({ ...exchange, code_verifier: "short" })).status).toBe(400);
    expect((await form({ grant_type: "password", client_id: clientId })).status).toBe(400);
    expect((await handleOAuth(new Request(cfg.origin + "/api/oauth/token", { method: "GET" }), cfg)).status).toBe(405);
    expect(rpc).toHaveLength(0);
  });
});

describe("Connected-app management", () => {
  it("does not let an MCP access token list or revoke grants", async () => {
    for (const action of ["grants", "revoke-grant"]) {
      const r = await manageMcp(
        new Request(cfg.origin + "/api/cora/connection/" + action, {
          method: action === "grants" ? "GET" : "POST",
          headers: { Authorization: "Bearer " + issueAccessToken() },
        }),
        cfg,
      );
      expect(r.status).toBe(401);
    }
  });
});

describe("Browser-based MCP clients", () => {
  it("answers CORS preflight for registration and token requests only", async () => {
    for (const path of ["/api/oauth/register", "/api/oauth/token"]) {
      const r = await handleOAuth(new Request(cfg.origin + path, { method: "OPTIONS", headers: { Origin: "https://claude.ai" } }), cfg);
      expect(r.status).toBe(204);
      expect(r.headers.get("access-control-allow-origin")).toBe("*");
    }
    const consent = await handleOAuth(new Request(cfg.origin + "/api/oauth/authorize", { method: "OPTIONS" }), cfg);
    expect(consent.status).toBe(405);
    expect(consent.headers.get("access-control-allow-origin")).toBeNull();
    const failed = await handleOAuth(new Request(cfg.origin + "/api/oauth/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }), cfg);
    expect(failed.headers.get("access-control-allow-origin")).toBe("*");
  });
});
