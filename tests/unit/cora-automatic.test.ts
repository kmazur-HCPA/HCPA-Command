import { describe, it, expect, vi, afterEach } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/data/database.types";
import {
  reminderArgs,
  automaticTool,
} from "../../netlify/functions/_shared/cora/automatic";
const owner = "11111111-1111-4111-8111-111111111111";
const fields = {
  title: "Follow up on website feedback",
  body: "An explicit request needs a response.",
  due_date: "2026-09-22",
  remind_at: null,
  source_key: "message-id",
  source_url: "https://outlook.office.com/mail/id/message",
};
afterEach(() => vi.unstubAllGlobals());
describe("automatic reminder boundary", () => {
  it("uses durable source links rather than changing model/run keys", () => {
    expect(reminderArgs(fields).hash).toBe(
      reminderArgs({ ...fields, source_key: "different-run" }).hash,
    );
    expect(reminderArgs(fields).body).toContain(fields.source_url);
  });
  it("rejects unknown fields, untrusted URLs and incompatible dates", () => {
    for (const patch of [
      { source_url: "https://evil.test" },
      { user_id: owner },
      { remind_at: "2026-09-22T09:00:00-04:00" },
      { due_date: "2026-02-30" },
      { source_url: null },
      { source_url: "https://outlook.office.com@evil.test" },
    ])
      expect(() => reminderArgs({ ...fields, ...patch })).toThrow();
    expect(
      reminderArgs({ ...fields, source_url: null, source_key: owner }).hash,
    ).toHaveLength(64);
  });
  it("cannot write when owner consent is paused", async () => {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const u = new URL(String(input));
      if (u.pathname.endsWith("app_memberships"))
        return Response.json({ active: true });
      if (u.pathname.endsWith("cora_review_preferences"))
        return Response.json({ automatic_reminders: false });
      throw new Error("Unexpected write");
    });
    const client = createClient<Database>(
      "https://fixture.supabase.co",
      "fixture",
    );
    await expect(
      automaticTool(client, owner, "create_reminder", fields),
    ).rejects.toThrow("paused");
  });
});
