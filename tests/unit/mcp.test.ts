import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  handleMcp,
  mcpDefinitions,
  protectedResource,
} from "../../netlify/functions/_shared/mcp/handler";
import { trustedRedirect } from "../../src/features/oauth/redirect";
import { manageMcp } from "../../netlify/functions/_shared/mcp/manage";
import {
  issueAccessToken,
  issueToken,
  tokenHash,
  referenceCodec,
} from "../../netlify/functions/_shared/mcp/security";
import { authorizationServer } from "../../netlify/functions/_shared/mcp/oauth";
const owner = "11111111-1111-4111-8111-111111111111";
const token = issueToken();
const cfg = {
  url: "https://fixture.supabase.co",
  key: "public-fixture",
  secret: "secret-fixture",
  origin: "https://cmd.hillspafl.gov",
};
let active: boolean,
  revoked: boolean,
  requests: Request[],
  queries: URL[],
  prepared: Record<string, unknown> | null,
  closeCalls: Record<string, unknown>[];
const req = (body: unknown, credential = token) =>
  new Request(cfg.origin + "/api/mcp", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + credential,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
  });
async function result(response: Response) {
  const text = await response.text();
  return JSON.parse(
    text.startsWith("event:")
      ? text
          .split("\n")
          .find((l) => l.startsWith("data:"))!
          .slice(5)
      : text,
  );
}
beforeEach(() => {
  active = true;
  revoked = false;
  requests = [];
  queries = [];
  prepared = null;
  closeCalls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const r = new Request(input, init),
        u = new URL(r.url);
      requests.push(r.clone());
      queries.push(u);
      if (u.pathname.endsWith("/cora_mcp_connections"))
        return Response.json(
          !revoked &&
            u.searchParams.get("token_hash") === "eq." + tokenHash(token)
            ? {
                user_id: owner,
                id: owner,
                token_hash: tokenHash(token),
                expires_at: "2099-01-01T00:00:00Z",
              }
            : null,
        );
      if (u.pathname.endsWith("/app_memberships"))
        return Response.json({ active });
      if(u.pathname.endsWith('/cora_create_record')) { const body=await r.json();return Response.json({id:body.p_record.id,saved:true,created:true}); }
      if (u.pathname.endsWith("/cora_begin")) {
        const input = await r.json();
        return Response.json({
          started: !prepared,
          turn: {
            id: input.p_request,
            proposal: prepared,
            action_status: prepared ? "proposed" : "none",
          },
        });
      }
      if (u.pathname.endsWith("/cora_turns") && r.method === "PATCH") {
        prepared = (await r.json()).proposal;
        return new Response(null, { status: 204 });
      }
      if (u.pathname.endsWith("/cora_mcp_reserve")) return Response.json(owner);
      if (u.pathname.endsWith("/cora_mcp_activity"))
        return new Response(null, { status: 204 });
      if (u.pathname.endsWith("/work_items")) {
        expect(u.searchParams.get("user_id")).toBe("eq." + owner);
        return Response.json([], { headers: { "Content-Range": "0-0/0" } });
      }
      if (u.pathname.endsWith("/day_closes"))
        return Response.json({ for_date: "2026-10-16", completed_at: "2026-10-16T19:30:00Z", counts: { done: 2, rolled: 1, dropped: 0, converted: 0 }, first_item_id: null });
      if (u.pathname.endsWith("/rpc/apply_day_close")) {
        closeCalls.push(await r.json());
        return Response.json({ applied: { done: 1, rolled: 0, dropped: 0, converted: 0 }, counts: { done: 1, rolled: 0, dropped: 0, converted: 0 }, receipt_id: closeCalls.at(-1)!.p_finish ? owner : null });
      }
      throw new Error("Unexpected network access");
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());
describe("Private connected-app MCP boundary", () => {
  it("requires a dedicated token; rejects Supabase sessions and cross-origin calls before database access", async () => {
    expect((await handleMcp(req({}, "supabase-jwt"), cfg, "test")).status).toBe(
      401,
    );
    const cross = req({});
    cross.headers.set("Origin", "https://attacker.test");
    expect((await handleMcp(cross, cfg, "test")).status).toBe(403);
    expect(requests).toHaveLength(0);
  });
  it("rejects revoked and inactive owner connections", async () => {
    revoked = true;
    expect((await handleMcp(req({}), cfg, "test")).status).toBe(401);
    revoked = false;
    active = false;
    expect((await handleMcp(req({}), cfg, "test")).status).toBe(401);
  });
  it("negotiates MCP and lists only bounded tools", async () => {
    const initialized = await result(
      await handleMcp(
        req({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "test", version: "1" },
          },
        }),
        cfg,
        "test",
      ),
    );
    expect(initialized.result.serverInfo.name).toBe("Command CMD");
    const list = await result(
      await handleMcp(
        req({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
        cfg,
        "test",
      ),
    );
    expect(list.result.tools).toHaveLength(31);
    expect(list.result.tools.map((t: { name: string }) => t.name)).toContain("get_reminders_due");
    expect(
      list.result.tools
        .filter(
          (t: { annotations: { readOnlyHint: boolean } }) =>
            !t.annotations.readOnlyHint,
        )
        .map((t: { name: string }) => t.name),
    ).toEqual(["prepare_record", "save_sitrep", "add_standup_item", "update_standup_item", "remove_standup_item", "create_record", "quick_update", "create_reminder", "apply_day_close"]);
    expect(mcpDefinitions.map((t) => t.name)).not.toContain("create_task");
    // Retired: one path per write, and no second briefing.
    for (const retired of ["prepare_task", "get_workday_reviews", "record_workday_review"])
      expect(mcpDefinitions.map((t) => t.name)).not.toContain(retired);
    // The record-kind enums no longer offer retired kinds.
    const kindEnum = (name: string) =>
      (mcpDefinitions.find((t) => t.name === name)!.parameters.properties as { kind: { enum: (string | null)[] } }).kind.enum;
    expect(kindEnum("create_record")).toEqual(["task", "person", "project", "waiting"]);
    expect(kindEnum("prepare_record")).toEqual(["task", "reminder", "project", "person", "waiting"]);
    expect(kindEnum("get_records")).toEqual(["task", "reminder", "project", "person", "waiting", null]);
    // Searchable by name: every mail/Teams/SITREP tool is listed with a description and schema.
    for (const name of ["get_flagged_mail", "get_direct_mail", "list_teams_chats", "save_sitrep", "get_sitrep_runs"]) {
      const tool = list.result.tools.find((t: { name: string }) => t.name === name);
      expect(tool?.description?.length, name).toBeGreaterThan(40);
      expect(tool?.inputSchema?.type, name).toBe("object");
    }
  });
  it("reads the whole attention picture in one audited call", async () => {
    const value = await result(
      await handleMcp(
        req({ jsonrpc: "2.0", id: 20, method: "tools/call", params: { name: "get_day_snapshot", arguments: {} } }),
        cfg,
        "test",
      ),
    );
    expect(value.result.isError).not.toBe(true);
    const data = value.result.structuredContent.data;
    for (const key of ["tasks_due_today", "reminders_due", "priority_tasks", "waiting_on", "active_projects"])
      expect(data[key]).toEqual({ total: 0, has_more: false, records: [] });
    expect(data.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(data.last_day_close).toMatchObject({ for_date: "2026-10-16", counts: { done: 2 }, first_item: null });
    expect(queries.filter((q) => q.pathname.endsWith("/cora_mcp_reserve"))).toHaveLength(1);
    const bad = await result(
      await handleMcp(
        req({ jsonrpc: "2.0", id: 21, method: "tools/call", params: { name: "get_day_snapshot", arguments: { offset: 0 } } }),
        cfg,
        "test",
      ),
    );
    expect(bad.error || bad.result?.isError).toBeTruthy();
  });
  it("offers close-the-day, meeting prep, weekly review and capture routines as prompts", async () => {
    const list = await result(
      await handleMcp(req({ jsonrpc: "2.0", id: 22, method: "prompts/list", params: {} }), cfg, "test"),
    );
    expect(list.result.prompts.map((p: { name: string }) => p.name)).toEqual([
      "close_day",
      "meeting_prep",
      "weekly_review",
      "capture",
    ]);
    const prep = await result(
      await handleMcp(
        req({ jsonrpc: "2.0", id: 23, method: "prompts/get", params: { name: "meeting_prep", arguments: { meeting: "Budget review" } } }),
        cfg,
        "test",
      ),
    );
    expect(prep.result.messages[0].content.text).toContain('"Budget review"');
    expect(requests.some((r) => new URL(r.url).pathname.endsWith("/work_items"))).toBe(false);
  });
  it("reads Close the Day without changing anything, and never lets a mail problem hide it", async () => {
    const value = await result(
      await handleMcp(
        req({ jsonrpc: "2.0", id: 30, method: "tools/call", params: { name: "get_day_close", arguments: {} } }),
        cfg,
        "test",
      ),
    );
    expect(value.result.isError).not.toBe(true);
    const data = value.result.structuredContent.data;
    expect(data).toMatchObject({ done_today: [], still_open: [], stale: [], first_item_candidates: [] });
    expect(data.flagged_mail).toMatchObject({ available: false });
    expect(requests.every((r) => r.method === "GET" || new URL(r.url).pathname.includes("/rpc/cora_mcp") || new URL(r.url).pathname.endsWith("/cora_mcp_activity"))).toBe(true);
    expect(closeCalls).toHaveLength(0);
  });
  it("applies only validated, confirmed Close the Day choices in one atomic call", async () => {
    const call = async (args: object) =>
      result(
        await handleMcp(
          req({ jsonrpc: "2.0", id: 31, method: "tools/call", params: { name: "apply_day_close", arguments: args } }),
          cfg,
          "test",
        ),
      );
    const id = "66666666-6666-4666-8666-666666666666";
    const ok = await call({ actions_json: JSON.stringify([{ id, version: 3, op: "done" }]), mail_json: "[]", first_item_id: null, finish: true });
    expect(ok.result.isError).not.toBe(true);
    expect(ok.result.structuredContent.data).toMatchObject({ saved: true, finished: true, receipt_id: owner });
    expect(closeCalls).toHaveLength(1);
    expect(closeCalls[0]).toMatchObject({ p_user: owner, p_finish: true, p_source: "chat", p_actions: [{ id, version: 3, op: "done" }] });
    for (const bad of [
      { actions_json: JSON.stringify([{ id, version: 3, op: "delete" }]) },
      { actions_json: JSON.stringify([{ id, op: "done" }]) },
      { actions_json: JSON.stringify([{ id, version: 1, op: "date", date: "tomorrow" }]) },
      { actions_json: "[]", mail_json: JSON.stringify([{ message_id: "m", action: "reminder", title: "No date" }]) },
      { actions_json: "[]", mail_json: JSON.stringify([{ message_id: "m", action: "task", title: "Bad link", url: "https://evil.test/x" }]) },
      { actions_json: "[]", first_item_id: "not-a-uuid" },
      { actions_json: "[]", finish: false },
    ]) {
      const value = await call(Object.assign({ actions_json: "[]", mail_json: "[]", first_item_id: null, finish: true }, bad));
      expect(value.error || value.result?.isError, JSON.stringify(bad)).toBeTruthy();
    }
    expect(closeCalls).toHaveLength(1);
  });
  it("reads only the token owner and audits the tool call without writing work", async () => {
    const value = await result(
      await handleMcp(
        req({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "get_my_tasks", arguments: { offset: 0 } },
        }),
        cfg,
        "test",
      ),
    );
    expect(value.result.isError).not.toBe(true);
    expect(value.result.structuredContent.data.records).toEqual([]);
    expect(queries.some((q) => q.pathname.endsWith("/cora_mcp_reserve"))).toBe(
      true,
    );
    expect(
      requests
        .filter((r) => new URL(r.url).pathname.endsWith("/work_items"))
        .every((r) => r.method === "GET"),
    ).toBe(true);
  });
  it("rejects forged tools and invalid arguments without record access", async () => {
    for (const params of [
      { name: "create_task", arguments: { title: "Bypass" } },
      { name: "get_my_tasks", arguments: { offset: 0, user_id: owner } },
    ]) {
      const value = await result(
        await handleMcp(
          req({ jsonrpc: "2.0", id: 4, method: "tools/call", params }),
          cfg,
          "test",
        ),
      );
      expect(value.error || value.result?.isError).toBeTruthy();
    }
    expect(
      queries.filter((q) => q.pathname.endsWith("/work_items")),
    ).toHaveLength(0);
  });
  it("prepares an idempotent review link without saving work or accepting confirmation arguments", async () => {
    const args = {
      operation: "create",
      kind: "task",
      record_id: null,
      expected_version: null,
      fields_json: JSON.stringify({ title: "Review synthetic proposal" }),
      request_id: owner,
    };
    const call = () =>
      handleMcp(
        req({
          jsonrpc: "2.0",
          id: 5,
          method: "tools/call",
          params: { name: "prepare_record", arguments: args },
        }),
        cfg,
        "test",
      );
    const first = await result(await call());
    expect(first.result.structuredContent.data.saved).toBe(false);
    expect(first.result.structuredContent.data.review_url).toBe(
      cfg.origin + "/?coraConversation=" + owner,
    );
    // Simulate JSONB key ordering on a retry.
    prepared = Object.fromEntries(
      Object.entries(prepared!).sort(([a], [b]) => a.localeCompare(b)),
    );
    expect(
      (await result(await call())).result.structuredContent.data.review_url,
    ).toBe(first.result.structuredContent.data.review_url);
    const bad = await result(
      await handleMcp(
        req({
          jsonrpc: "2.0",
          id: 6,
          method: "tools/call",
          params: {
            name: "prepare_record",
            arguments: { ...args, confirmed: true },
          },
        }),
        cfg,
        "test",
      ),
    );
    expect(bad.error || bad.result?.isError).toBeTruthy();
    expect(
      requests.filter((r) => new URL(r.url).pathname.endsWith("/work_items")),
    ).toHaveLength(0);
  });
  it("cannot manage credentials with an MCP token", async () => {
    const r = new Request(cfg.origin + "/api/cora/connection/create", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
    });
    expect((await manageMcp(r, cfg)).status).toBe(401);
    expect(requests).toHaveLength(0);
  });
  it("binds discovery references to owner, credential generation, purpose and expiry", () => {
    let now = 1000;
    const key = "ad".repeat(32),
      codec = referenceCodec<string>(key, "owner:grant:ms:outlook", () => now),
      ref = codec.issue("message-id");
    expect(codec.resolve(ref)).toBe("message-id");
    for (const context of [
      "other:grant:ms:outlook",
      "owner:new:ms:outlook",
      "owner:grant:new:outlook",
      "owner:grant:ms:teams",
    ])
      expect(() =>
        referenceCodec(key, context, () => now).resolve(ref),
      ).toThrow();
    expect(() => codec.resolve(ref.slice(0, -5) + "wrong")).toThrow();
    now += 20 * 60000;
    expect(() => codec.resolve(ref)).toThrow(/expired/);
  });
});

it('prepares a date-only reminder through MCP without writing work records', async () => {
 const value = await result(await handleMcp(req({jsonrpc:'2.0',id:9,method:'tools/call',params:{name:'prepare_record',arguments:{operation:'create',kind:'reminder',record_id:null,expected_version:null,fields_json:JSON.stringify({title:'Email Al and Nereia about website feedback',due_date:'2026-09-22'}),request_id:owner}}}),cfg,'test'));
 expect(value.result.isError).not.toBe(true);
 expect(prepared).toMatchObject({type:'record',kind:'reminder',fields:{due_date:'2026-09-22'}});
 expect(requests.some(r=>new URL(r.url).pathname.endsWith('/work_items')&&r.method!=='GET')).toBe(false);
});

it('direct creation uses the verified MCP owner and returns a saved receipt without a proposal',async()=>{
 const value=await result(await handleMcp(req({jsonrpc:'2.0',id:11,method:'tools/call',params:{name:'create_record',arguments:{kind:'person',request_id:owner,fields_json:JSON.stringify({title:'Example Person',organization:'HCPA'})}}}),cfg,'test'));
 const receipt=JSON.parse(value.result.content[0].text).data;
 expect(receipt).toMatchObject({saved:true,created:true,kind:'person'});
 expect(receipt).not.toHaveProperty('review_url');expect(prepared).toBeNull();
 const write=requests.find(r=>r.url.endsWith('/rpc/cora_create_record'))!;
 expect(await write.clone().json()).toMatchObject({p_user:owner,p_record:{user_id:owner,kind:'person'}});
});

describe("Claude connector sign-in (OAuth)", () => {
  const grant = "44444444-4444-4444-8444-444444444444";
  const oauth = issueAccessToken();
  const session = "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ4In0.sig";
  let reserved: Record<string, unknown>[];
  beforeEach(() => {
    reserved = [];
    const base = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const r = new Request(input, init),
          u = new URL(r.url);
        if (u.pathname.endsWith("/rpc/cora_oauth_verify")) {
          const { p_hash } = await r.json();
          return Response.json(
            p_hash === tokenHash(oauth) && !revoked && active
              ? { user_id: owner, grant_id: grant, client_id: owner }
              : null,
          );
        }
        if (u.pathname.endsWith("/cora_mcp_reserve_oauth")) {
          reserved.push(await r.json());
          return Response.json(owner);
        }
        if (u.pathname.startsWith("/auth/v1/"))
          throw new Error("OAuth must not call Supabase Auth");
        if (u.pathname.endsWith("/cora_mcp_connections"))
          throw new Error("OAuth must not touch personal tokens");
        return base(input, init);
      }),
    );
  });
  const list = { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} };
  const call = {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "get_my_tasks", arguments: { offset: 0 } },
  };
  it("points unauthenticated clients to Command as the authorization server", async () => {
    const response = await handleMcp(req(list, ""), cfg, "test");
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      'resource_metadata="https://cmd.hillspafl.gov/.well-known/oauth-protected-resource"',
    );
    expect(await protectedResource(cfg.origin).json()).toMatchObject({
      resource: "https://cmd.hillspafl.gov/api/mcp",
      authorization_servers: ["https://cmd.hillspafl.gov"],
    });
    expect(await authorizationServer(cfg.origin).json()).toMatchObject({
      issuer: "https://cmd.hillspafl.gov",
      authorization_endpoint: "https://cmd.hillspafl.gov/oauth/authorize",
      token_endpoint: "https://cmd.hillspafl.gov/api/oauth/token",
      registration_endpoint: "https://cmd.hillspafl.gov/api/oauth/register",
      code_challenge_methods_supported: ["S256"],
    });
  });
  it("accepts an OAuth access token and audits under its grant ID", async () => {
    const value = await result(await handleMcp(req(call, oauth), cfg, "test"));
    expect(value.result.isError).toBeFalsy();
    expect(reserved).toEqual([{ p_user: owner, p_client: grant, p_tool: "get_my_tasks" }]);
  });
  it("rejects browser sessions, unknown tokens, revoked grants and inactive members", async () => {
    expect((await handleMcp(req(list, session), cfg, "test")).status).toBe(401);
    expect((await handleMcp(req(list, issueAccessToken()), cfg, "test")).status).toBe(401);
    revoked = true;
    expect((await handleMcp(req(list, oauth), cfg, "test")).status).toBe(401);
    revoked = false;
    active = false;
    expect((await handleMcp(req(list, oauth), cfg, "test")).status).toBe(401);
  });
  it("reports a verification outage as retryable, not as a revoked connection", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ message: "down" }, { status: 503 })));
    expect((await handleMcp(req(list, oauth), cfg, "test")).status).toBe(503);
  });
});

describe("Consent redirect allowlist", () => {
  it("allows only Claude callbacks and loopback addresses", () => {
    for (const ok of [
      "https://claude.ai/api/mcp/auth_callback",
      "https://claude.com/api/mcp/auth_callback",
      "http://localhost:53682/callback",
      "http://127.0.0.1:4000/",
    ])
      expect(trustedRedirect(ok)).toBe(true);
    for (const bad of [
      "https://evil.test/api/mcp/auth_callback",
      "https://claude.ai.evil.test/api/mcp/auth_callback",
      "https://claude.ai/elsewhere",
      "https://user@claude.ai/api/mcp/auth_callback",
      "http://claude.ai/api/mcp/auth_callback",
      "javascript:alert(1)",
      "not a url",
    ])
      expect(trustedRedirect(bad)).toBe(false);
  });
});
