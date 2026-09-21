import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  handleMcp,
  mcpDefinitions,
} from "../../netlify/functions/_shared/mcp/handler";
import { manageMcp } from "../../netlify/functions/_shared/mcp/manage";
import {
  issueToken,
  tokenHash,
  referenceCodec,
} from "../../netlify/functions/_shared/mcp/security";
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
  prepared: Record<string, unknown> | null;
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
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const r = new Request(input, init),
        u = new URL(r.url);
      requests.push(r);
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
      throw new Error("Unexpected network access");
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());
describe("Private ChatGPT MCP boundary", () => {
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
    expect(initialized.result.serverInfo.name).toBe("Command Cora");
    const list = await result(
      await handleMcp(
        req({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
        cfg,
        "test",
      ),
    );
    expect(list.result.tools).toHaveLength(20);
    expect(
      list.result.tools
        .filter(
          (t: { annotations: { readOnlyHint: boolean } }) =>
            !t.annotations.readOnlyHint,
        )
        .map((t: { name: string }) => t.name),
    ).toEqual(["prepare_record", "prepare_task", "create_reminder", "record_workday_review"]);
    expect(mcpDefinitions.map((t) => t.name)).not.toContain("create_task");
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
      title: "Review synthetic proposal",
      due_date: null,
      priority: "Normal",
      project_id: null,
      request_id: owner,
    };
    const call = () =>
      handleMcp(
        req({
          jsonrpc: "2.0",
          id: 5,
          method: "tools/call",
          params: { name: "prepare_task", arguments: args },
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
            name: "prepare_task",
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
