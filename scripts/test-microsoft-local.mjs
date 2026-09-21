import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "vite";
// Real local Auth/PostgREST authorization and persistence. No Microsoft network
// access, external mailbox content, or hosted database writes in this harness.
export async function testMicrosoft({
  admin,
  owner,
  outsider,
  users,
  url,
  anonKey,
  secret,
}) {
  assert(["localhost", "127.0.0.1"].includes(new URL(url).hostname));
  const vite = await createServer({
    configFile: false,
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
  });
  try {
    const { handleMicrosoft } = await vite.ssrLoadModule(
      "/netlify/functions/_shared/microsoft/handler.ts",
    );
    const { seal } = await vite.ssrLoadModule(
      "/netlify/functions/_shared/microsoft/crypto.ts",
    );
    const microsoft = {
      tenantId: randomUUID(),
      clientId: randomUUID(),
      clientSecret: "synthetic-secret",
      encryptionKey: "ab".repeat(32),
      origin: "https://cmd.hillspafl.gov",
    };
    const config = { url, key: anonKey, secret, microsoft };
    const token = (await owner.auth.getSession()).data.session.access_token;
    const otherToken = (await outsider.auth.getSession()).data.session
      .access_token;
    const request = (path, method = "GET", auth = token) =>
      new Request(microsoft.origin + "/api/microsoft/" + path, {
        method,
        headers: auth
          ? { Authorization: `Bearer ${auth}`, Origin: microsoft.origin }
          : {},
      });
    assert.equal(
      (await handleMicrosoft(request("status", "GET", ""), config)).status,
      401,
    );
    const generation = randomUUID(),
      insert = await admin.from("microsoft_connections").insert({
        user_id: users[0],
        generation,
        token_cache: seal(
          "synthetic-cache-marker",
          microsoft.encryptionKey,
          `${users[0]}:${generation}:cache`,
        ),
        account_id: "synthetic-account",
        account_email: "synthetic@example.test",
        connected_at: new Date().toISOString(),
      });
    assert.equal(insert.error, null);
    for (const client of [owner, outsider])
      assert(
        (await client.from("microsoft_connections").select("*")).error,
        "Browser roles must not read encrypted credentials",
      );
    const status = await handleMicrosoft(request("status"), config),
      body = await status.json();
    assert.equal(status.status, 200);
    assert.equal(body.connected, true);
    assert.equal(body.teamsConnected, false);
    assert.equal((await admin.from("microsoft_connections").update({granted_scopes:["Chat.Read","ChannelMessage.Read.All"]}).eq("user_id",users[0])).error,null);
    assert.equal((await (await handleMicrosoft(request("status"),config)).json()).teamsConnected,true);
    assert((await owner.from("microsoft_connections").update({granted_scopes:["Chat.Read"]}).eq("user_id",users[0])).error, "Browser roles must not forge Teams consent");
    assert(!JSON.stringify(body).includes("token_cache"));
    assert.equal(
      (
        await (
          await handleMicrosoft(request("status", "GET", otherToken), config)
        ).json()
      ).connected,
      false,
    );
    assert.equal(
      (await handleMicrosoft(request("disconnect", "POST", otherToken), config))
        .status,
      200,
    );
    assert.equal(
      (
        await admin
          .from("microsoft_connections")
          .select("user_id")
          .eq("user_id", users[0])
      ).data.length,
      1,
    );
    const exported = await owner.rpc("export_workspace");
    assert.equal(exported.error, null);
    assert(!Object.hasOwn(exported.data, "microsoft_connections"));
    assert(!JSON.stringify(exported.data).includes("synthetic-cache-marker"));
    assert.equal(
      (await handleMicrosoft(request("disconnect", "POST"), config)).status,
      200,
    );
    const stale = await admin
      .from("microsoft_connections")
      .update({ token_cache: "must-not-return" })
      .eq("user_id", users[0])
      .eq("generation", generation)
      .select("user_id");
    assert.equal(stale.error, null);
    assert.equal(stale.data.length, 0);
    const pending = await admin
      .from("microsoft_connections")
      .insert({ user_id: users[0], generation, auth_state: "fixture-pending" });
    assert.equal(pending.error, null);
    assert.equal(
      (
        await admin
          .from("app_memberships")
          .update({ active: false })
          .eq("user_id", users[0])
      ).error,
      null,
    );
    assert.equal(
      (
        await admin
          .from("microsoft_connections")
          .select("user_id")
          .eq("user_id", users[0])
      ).data.length,
      0,
    );
    assert(
      (
        await admin
          .from("microsoft_connections")
          .insert({ user_id: users[0], generation })
      ).error,
      "Revoked membership must block stale credential inserts",
    );
    assert.equal(
      (await handleMicrosoft(request("status"), config)).status,
      403,
    );
    assert.equal(
      (
        await admin
          .from("app_memberships")
          .update({ active: true })
          .eq("user_id", users[0])
      ).error,
      null,
    );
    console.log(
      "PASS: Microsoft connection ownership, server-only credentials, export exclusion, disconnect, stale refresh and membership revocation through native Auth/PostgREST.",
    );
  } finally {
    await admin.from("microsoft_connections").delete().in("user_id", users);
    await admin
      .from("app_memberships")
      .update({ active: true })
      .eq("user_id", users[0]);
    await vite.close();
  }
}
