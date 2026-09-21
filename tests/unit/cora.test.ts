import { describe, it, expect } from "vitest";
import {
  validateProposal,
  today,
  uuid,
} from "../../netlify/functions/_shared/cora/tools";
import {
  boundedJson,
  handleCora,
} from "../../netlify/functions/_shared/cora/handler";
const config = {
  url: "https://example.supabase.co",
  key: "sb_publishable_test",
  secret: "sb_secret_test",
  apiKey: "test",
};
describe("Cora request and action boundaries", () => {
  it("rejects anonymous calls and unsupported methods before provider access", async () => {
    expect(
      (
        await handleCora(
          new Request("https://cmd.test/api/cora/chat", { method: "POST" }),
          config,
          "test",
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await handleCora(
          new Request("https://cmd.test/api/cora/chat"),
          config,
          "test",
        )
      ).status,
    ).toBe(405);
  });
  it("bounds chunked input without trusting Content-Length", async () => {
    const request = new Request("https://cmd.test", {
      method: "POST",
      body: JSON.stringify({ message: "x".repeat(25000) }),
    });
    await expect(boundedJson(request)).rejects.toThrow("too large");
  });
  it("accepts only the declared task fields and valid calendar dates", () => {
    const task = {
      title: "Review firewall proposal",
      due_date: "2026-09-22",
      priority: "Normal",
      project_id: null,
    };
    expect(validateProposal(task)).toEqual(task);
    for (const patch of [
      { due_date: "2026-02-30" },
      { project_id: "https://evil.test" },
      { title: "" },
      { priority: "Urgent" },
      { user_id: "attacker" },
      { status: "Complete" },
    ])
      expect(() => validateProposal({ ...task, ...patch })).toThrow();
  });
  it("uses the business timezone across UTC day changes and daylight savings", () => {
    expect(today(new Date("2026-09-22T01:00:00Z"))).toBe("2026-09-21");
    expect(today(new Date("2026-03-08T06:59:00Z"))).toBe("2026-03-08");
    expect(uuid.test("11111111-1111-4111-8111-111111111111")).toBe(true);
  });
});
