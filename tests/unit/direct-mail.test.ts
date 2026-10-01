import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultSince, directArgs, directMail, isAutomated } from "../../netlify/functions/_shared/microsoft/direct";
import type { AppClient } from "../../src/platform/supabase";

const owner = "11111111-1111-4111-8111-111111111111";
const seeded = ["noreply@*", "no-reply@*", "donotreply*@*", "request_submissions@hcpaflapps.org", "falcon@crowdstrike.com", "*ups*@hcpafl.org", "presidio@service-now.com", "moveitxfer@hillsclerk.com", "standout@standoutmail.tmbc.com"];
const store = (patterns = seeded) =>
  ({
    from: (t: string) =>
      t === "mail_automated_senders"
        ? { select: () => Promise.resolve({ data: patterns.map((pattern) => ({ pattern })), error: null }) }
        : { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { active: true, account_email: "Kevin@hcpafl.org" }, error: null }) }) }) },
  }) as unknown as AppClient;
const msg = (id: string, over: Record<string, unknown> = {}) => ({
  id, conversationId: "c-" + id, subject: "Hello", receivedDateTime: "2026-09-30T14:00:00Z", importance: "normal",
  from: { emailAddress: { name: "Sam", address: "Sam@Example.org" } },
  toRecipients: [{ emailAddress: { address: "kevin@hcpafl.org" } }], flag: { flagStatus: "notFlagged" },
  inferenceClassification: "focused", webLink: "https://outlook.office.com/m/" + id, bodyPreview: "SECRET", body: { content: "SECRET" }, ...over,
});
const now = Date.parse("2026-10-01T16:00:00Z");
const run = (args: Record<string, unknown> = { since: null, limit: null }) => directMail(store(), owner, "t", new AbortController().signal, args, now);
afterEach(() => vi.unstubAllGlobals());

function graph(inbox: unknown[], sentPages: unknown[][], inboxNext = false) {
  const calls: Request[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const r = new Request(input, init), u = new URL(r.url);
    calls.push(r);
    if (u.pathname.endsWith("/inbox/messages")) return Response.json({ value: inbox, ...(inboxNext ? { "@odata.nextLink": u.href + "&x=1" } : {}) });
    const page = Number(u.searchParams.get("page") ?? 0);
    const more = page + 1 < sentPages.length;
    const nextUrl = new URL(u.href); nextUrl.searchParams.set("page", String(page + 1));
    return Response.json({ value: sentPages[page], ...(more ? { "@odata.nextLink": nextUrl.href } : {}) });
  }));
  return calls;
}

describe("get_direct_mail", () => {
  it("computes to_me, replied, focused and automated without returning any body text", async () => {
    const calls = graph(
      [msg("a"), msg("b", { toRecipients: [], }), msg("c"), msg("d", { from: { emailAddress: { name: "Falcon", address: "falcon@crowdstrike.com" } }, inferenceClassification: "other" })],
      [[{ conversationId: "c-a", sentDateTime: "2026-09-30T15:00:00Z" }, { conversationId: "c-c", sentDateTime: "2026-09-30T13:00:00Z" }]],
    );
    const r = await run();
    const by = Object.fromEntries(r.records.map((m) => [m.immutable_id, m]));
    expect(by.a).toMatchObject({ to_me: true, replied: true, automated: false, focused: true, sender_address: "sam@example.org" });
    expect(by.b).toMatchObject({ to_me: false, replied: false });
    expect(by.c!.replied).toBe(false); // reply predates the message
    expect(by.d).toMatchObject({ automated: true, focused: false });
    expect(JSON.stringify(r)).not.toContain("SECRET");
    expect(calls.every((c) => c.headers.get("prefer")!.includes('IdType="ImmutableId"'))).toBe(true);
    expect(new URL(calls[0]!.url).searchParams.get("$select")).not.toMatch(/body/);
    expect(r).toMatchObject({ total_returned: 4, truncated: false, sent_items_truncated: false });
  });
  it("pages Sent Items and reports truncation at 1,000", async () => {
    const page = (n: number) => Array.from({ length: 200 }, (_, i) => ({ conversationId: `x${n}-${i}`, sentDateTime: "2026-09-30T15:00:00Z" }));
    graph([msg("a")], [page(0), [{ conversationId: "c-a", sentDateTime: "2026-09-30T20:00:00Z" }]]);
    expect((await run()).records[0]!.replied).toBe(true);
    graph([msg("a")], [0, 1, 2, 3, 4, 5].map(page));
    expect((await run()).sent_items_truncated).toBe(true);
  });
  it("flags a truncated inbox and applies defaults and limits", async () => {
    graph([msg("a")], [[]], true);
    expect((await run({ since: null, limit: 1 })).truncated).toBe(true);
    expect(() => directArgs({ since: null, limit: 101 })).toThrow();
    expect(() => directArgs({ since: "2026-09-01T00:00:00Z", limit: null }, now)).toThrow(/14 days/);
    expect(() => directArgs({ since: "2026-09-30T00:00:00", limit: null }, now)).toThrow(/offset/);
    expect(() => directArgs({ since: null }, now)).toThrow();
    expect(directArgs({ since: "2026-09-30T00:00:00-04:00", limit: 10 }, now)).toEqual({ since: "2026-09-30T04:00:00.000Z", limit: 10 });
  });
  it("defaults to 3 business days ago at midnight Eastern, across weekends and DST", () => {
    expect(defaultSince(Date.parse("2026-10-01T16:00:00Z"))).toBe("2026-09-28T04:00:00.000Z"); // Thu -> Mon
    expect(defaultSince(Date.parse("2026-10-05T16:00:00Z"))).toBe("2026-09-30T04:00:00.000Z"); // Mon -> Wed
    expect(defaultSince(Date.parse("2026-11-03T16:00:00Z"))).toBe("2026-10-29T04:00:00.000Z"); // Tue -> Thu
    expect(defaultSince(Date.parse("2026-11-04T16:00:00Z"))).toBe("2026-10-30T04:00:00.000Z"); // Wed -> Fri, still EDT
    expect(defaultSince(Date.parse("2026-11-05T16:00:00Z"))).toBe("2026-11-02T05:00:00.000Z"); // Thu -> Mon, EST
  });
  it("matches every seeded automated sender and nothing ordinary", () => {
    for (const a of ["noreply@x.org", "No-Reply@x.org", "donotreply-it@x.org", "request_submissions@hcpaflapps.org", "falcon@crowdstrike.com", "itups-alerts@hcpafl.org", "presidio@service-now.com", "moveitxfer@hillsclerk.com", "standout@standoutmail.tmbc.com"])
      expect(isAutomated(a, seeded), a).toBe(true);
    expect(isAutomated("sam@example.org", seeded)).toBe(false);
    expect(isAutomated("sam@crowdstrike.com", seeded)).toBe(false);
    expect(isAutomated("a@vendor.com", ["vendor.com"])).toBe(true); // domain-only pattern
    expect(isAutomated("a@vendor.com", [])).toBe(false);
  });
});
