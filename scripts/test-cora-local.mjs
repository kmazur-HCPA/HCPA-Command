import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fakeClaude, hasToolResult } from "./fake-claude.mjs";
import { createServer as viteServer } from "vite";
// Real local Auth/PostgREST + handler + deterministic provider fixture; never hosted.
export async function testCora({
  admin,
  owner,
  outsider,
  users,
  url,
  anonKey,
  secret,
}) {
  assert(["localhost", "127.0.0.1"].includes(new URL(url).hostname));
  const provider = await fakeClaude((request) =>
    hasToolResult(request)
      ? { text: "Ready to add." }
      : {
          tool: {
            name: "prepare_task",
            input: {
              title: "Cora synthetic follow-up",
              due_date: "2026-09-22",
              priority: "Normal",
              project_id: null,
            },
          },
        },
  );
  const inputs = provider.inputs;
  const vite = await viteServer({
    configFile: false,
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
  });
  try {
    const { handleCora } = await vite.ssrLoadModule(
      "/netlify/functions/_shared/cora/handler.ts",
    );
    const token = (await owner.auth.getSession()).data.session.access_token,
      otherToken = (await outsider.auth.getSession()).data.session.access_token;
    const config = {
      url,
      key: anonKey,
      secret,
      apiKey: "synthetic-provider-key",
      baseURL: provider.baseURL,
    };
    const payload = {
      requestId: randomUUID(),
      conversationId: randomUUID(),
      message: "Add a task for tomorrow to follow up.",
      context: { page: "workspace", recordId: null },
    };
    const request = (path, body, auth = token) =>
      new Request("http://localhost/api/cora/" + path, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${auth}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    const first = await handleCora(request("chat", payload), config, "test");
    assert.equal(first.status, 200);
    const events = (await first.text()).trim().split("\n").map(JSON.parse),
      complete = events.find((e) => e.type === "complete");
    assert(complete, JSON.stringify(events));
    assert.equal(complete.turn.action_status, "proposed");
    assert.equal(
      (
        await owner
          .from("work_items")
          .select("id")
          .eq("id", complete.turn.task_id)
      ).data.length,
      0,
    );
    const replay = await handleCora(request("chat", payload), config, "retry");
    assert.equal(replay.status, 200);
    assert((await replay.text()).includes("complete"));
    assert.equal(inputs.length, 2);
    assert(
      inputs.every(
        (r) => r.messages.length < 25 && r.system[0].cache_control?.type === "ephemeral",
      ),
    );
    const stolen = await handleCora(
      request("action", { turnId: complete.turn.id }, otherToken),
      config,
      "other",
    );
    assert.equal(stolen.status, 404);
    const [a, b] = await Promise.all([
      handleCora(
        request("action", { turnId: complete.turn.id }),
        config,
        "create",
      ),
      handleCora(
        request("action", { turnId: complete.turn.id }),
        config,
        "retry-create",
      ),
    ]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(
      (
        await owner
          .from("work_items")
          .select("id")
          .eq("id", complete.turn.task_id)
      ).data.length,
      1,
    );
    const receipt = (
      await owner
        .from("cora_turns")
        .select("*")
        .eq("id", complete.turn.id)
        .single()
    ).data;
    assert.equal(receipt.action_status, "created");
    assert.deepEqual((await outsider.from("cora_turns").select("*")).data, []);
    const forge = await owner
      .from("cora_turns")
      .update({ response: "Forged receipt" })
      .eq("id", complete.turn.id);
    assert(forge.error);
    const revoked = await admin
      .from("app_memberships")
      .update({ active: false })
      .eq("user_id", users[0]);
    assert.equal(revoked.error, null);
    assert.equal(
      (
        await handleCora(
          request("action", { turnId: complete.turn.id }),
          config,
          "revoked",
        )
      ).status,
      403,
    );
    await admin
      .from("app_memberships")
      .update({ active: true })
      .eq("user_id", users[0]);
    console.log(
      JSON.stringify({
        event: "cora_integration",
        result: "pass",
        provider_calls: inputs.length,
        checks:
          "live context, streaming, history, proposal-only model, idempotent task creation, RLS, forged receipt denial, revocation",
      }),
    );
  } finally {
    await vite.close();
    await provider.close();
  }
}
