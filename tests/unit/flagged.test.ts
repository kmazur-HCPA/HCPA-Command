import { afterEach, describe, expect, it, vi } from "vitest";
import { flaggedMail, summarizeFlagged } from "../../netlify/functions/_shared/microsoft/flagged";
import { taskTitle } from "../../src/services/mail";
import type { AppClient } from "../../src/platform/supabase";

const owner = "11111111-1111-4111-8111-111111111111";
const row = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  conversationId: "conv-" + id,
  subject: "RE: Budget",
  from: { emailAddress: { name: "Sam Lee", address: "sam@example.org" } },
  receivedDateTime: "2026-09-30T14:00:00Z",
  importance: "high",
  flag: { flagStatus: "flagged", dueDateTime: { dateTime: "2026-10-03T04:00:00.0000000", timeZone: "UTC" } },
  webLink: "https://outlook.office.com/mail/item/" + id,
  body: { content: "SECRET BODY" },
  ...extra,
});
const store = (captures: { message_id: string; action: string; record_id: string | null }[]) =>
  ({
    from: () => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.in = () => Promise.resolve({ data: captures, error: null });
      return q;
    },
  }) as unknown as AppClient;
afterEach(() => vi.unstubAllGlobals());

describe("flagged mail", () => {
  it("asks Graph for immutable IDs, the 90-day flagged filter and no body", async () => {
    const calls: Request[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(new Request(input, init));
      return Response.json({ value: [row("a"), row("b"), row("c", { flag: { flagStatus: "complete" } })] });
    }));
    const result = await flaggedMail(
      store([{ message_id: "b", action: "dismissed", record_id: null }]),
      owner,
      "token",
      new AbortController().signal,
      Date.parse("2026-10-01T12:00:00Z"),
    );
    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get("$filter")).toBe("receivedDateTime ge 2026-07-03T12:00:00.000Z and flag/flagStatus eq 'flagged'");
    expect(url.searchParams.get("$orderby")).toBe("receivedDateTime desc");
    expect(url.searchParams.get("$select")).not.toMatch(/body/);
    expect(calls[0]!.headers.get("prefer")).toContain('IdType="ImmutableId"');
    expect(result.messages.map((m) => [m.id, m.capture])).toEqual([["a", null], ["b", "dismissed"]]);
    expect(result.messages[0]).toMatchObject({ sender: "Sam Lee", flag_due: "2026-10-03", importance: "high", url: "https://outlook.office.com/mail/item/a" });
    expect(JSON.stringify(result)).not.toContain("SECRET BODY");
  });
  it("retries unordered when Graph rejects the filter and orders locally", async () => {
    const calls: URL[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      calls.push(url);
      if (url.searchParams.has("$orderby")) return new Response("{}", { status: 400 });
      return Response.json({ value: [
        row("old", { receivedDateTime: "2026-01-01T00:00:00Z" }),
        row("a", { receivedDateTime: "2026-09-01T00:00:00Z" }),
        row("b", { receivedDateTime: "2026-09-20T00:00:00Z" }),
      ] });
    }));
    const result = await flaggedMail(store([]), owner, "t", new AbortController().signal, Date.parse("2026-10-01T12:00:00Z"));
    expect(calls).toHaveLength(2);
    expect(result.messages.map((m) => m.id)).toEqual(["b", "a"]);
  });
  it("does not retry other failures and never follows non-Outlook links", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 429 })));
    await expect(flaggedMail(store([]), owner, "t", new AbortController().signal)).rejects.toThrow(/limiting/);
    expect(summarizeFlagged(row("x", { webLink: "https://evil.example/x" })).url).toBeNull();
  });
  it("strips reply prefixes and caps titles at 120 characters", () => {
    expect(taskTitle("RE: FW: Re: Budget review")).toBe("Budget review");
    expect(taskTitle("x".repeat(300))).toHaveLength(120);
    expect(taskTitle("RE:")).toBe("Follow up on flagged email");
  });
});
