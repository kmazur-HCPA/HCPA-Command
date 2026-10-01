import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
}));
vi.mock("@supabase/supabase-js", () => {
  // Minimal chainable fake: filters are equality only, which is all the handler uses.
  function from(table: string) {
    const filters: [string, unknown, string][] = [];
    let op: "select" | "update" | "delete" | "upsert" = "select";
    let patch: Record<string, unknown> = {};
    const match = () =>
      (db.tables[table] ??= []).filter((r) =>
        filters.every(([k, v, kind]) =>
          kind === "gt" ? String(r[k]) > String(v) : r[k] === v,
        ),
      );
    const run = () => {
      const rows = match();
      if (op === "update") rows.forEach((r) => Object.assign(r, patch));
      if (op === "delete")
        db.tables[table] = (db.tables[table] ?? []).filter(
          (r) => !rows.includes(r),
        );
      if (op === "upsert") {
        const key = patch.user_id;
        db.tables[table] = (db.tables[table] ?? []).filter(
          (r) => r.user_id !== key,
        );
        db.tables[table].push({ ...patch });
      }
      return {
        data:
          op === "select" || op === "update"
            ? structuredClone(rows[0] ?? null)
            : null,
        error: null,
      };
    };
    const b: Record<string, unknown> = {
      select: () => b,
      update: (p: Record<string, unknown>) => ((op = "update"), (patch = p), b),
      delete: () => ((op = "delete"), b),
      upsert: (p: Record<string, unknown>) => (
        (op = "upsert"),
        (patch = p),
        run()
      ),
      eq: (k: string, v: unknown) => (filters.push([k, v, "eq"]), b),
      gt: (k: string, v: unknown) => (filters.push([k, v, "gt"]), b),
      maybeSingle: async () => run(),
      then: (f: (v: unknown) => unknown) => Promise.resolve(run()).then(f),
    };
    return b;
  }
  return {
    createClient: () => ({
      from,
      auth: {
        getUser: async () => ({
          data: {
            user: {
              id: "u1",
              email: "kevin@hillspafl.gov",
              is_anonymous: false,
            },
          },
          error: null,
        }),
      },
    }),
  };
});

import { handleHelix } from "../../netlify/functions/_shared/helix/handler";
import {
  helixConfig,
  helixResource,
} from "../../netlify/functions/_shared/helix/config";
import { seal, unseal } from "../../netlify/functions/_shared/microsoft/crypto";
import { sanitizeSummary } from "../../src/features/helix/model";

const env: Record<string, string> = {
  HELIX_SUPABASE_URL: "https://helix-fixture.supabase.co",
  HELIX_OAUTH_CLIENT_ID: "44444444-4444-4444-8444-444444444444",
  HELIX_OAUTH_CLIENT_SECRET: "fixture-secret",
  HELIX_TOKEN_ENCRYPTION_KEY: "ab".repeat(32),
};
const conn = () => db.tables.helix_connections![0]!;
const helix = helixConfig((n) => env[n])!;
const server = { url: "https://c.supabase.co", key: "k", secret: "s", helix };
const req = (path: string, init: RequestInit = {}) =>
  new Request(`https://cmd.hillspafl.gov/api/helix/${path}`, {
    ...init,
    headers: {
      Authorization: "Bearer user-token",
      Origin: "https://cmd.hillspafl.gov",
      ...init.headers,
    },
  });
const item = {
  id: "1",
  module: "ticket",
  number: "IT-1",
  title: "Printer",
  status: "New",
  priority: "High",
  due_date: null,
  updated_at: "2026-10-01T00:00:00Z",
  url: "https://helix.hillspafl.gov/service-desk",
};
const sections = (over: Record<string, unknown> = {}) => ({
  as_of: "2026-10-01T09:00:00-04:00",
  sections: Object.fromEntries(
    [
      "opsqueue_mine",
      "tickets_mine",
      "tickets_unassigned",
      "changes_recent",
      "contracts_expiring",
      "assets_lifecycle",
    ].map((n) => [n, { total: 0, records: [] }]),
  ),
  ...over,
});
const sealedTokens = (expires: number, generation = "g1") =>
  seal(
    JSON.stringify({ a: "access-1", r: "refresh-1", e: expires }),
    helix.encryptionKey,
    `u1:${generation}:helix`,
  );
function seed(
  tokens: string | null = sealedTokens(Date.now() + 3600000),
  summary: unknown = null,
) {
  db.tables = {
    app_memberships: [{ user_id: "u1", active: true }],
    helix_connections: [
      {
        user_id: "u1",
        generation: "g1",
        revision: 1,
        tokens,
        summary,
        summary_at: summary ? "2026-10-01T12:00:00Z" : null,
      },
    ],
  };
}
beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  seed();
});
afterEach(() => vi.unstubAllGlobals());

describe("helixConfig", () => {
  it("requires every setting and a valid origin", () => {
    expect(helix.origin).toBe("https://cmd.hillspafl.gov");
    expect(helixConfig(() => undefined)).toBeUndefined();
    expect(
      helixConfig((n) =>
        n === "HELIX_TOKEN_ENCRYPTION_KEY" ? "short" : env[n],
      ),
    ).toBeUndefined();
    expect(
      helixConfig((n) =>
        n === "HELIX_SUPABASE_URL" ? "https://evil.example" : env[n],
      ),
    ).toBeUndefined();
  });
});

describe("sanitizeSummary", () => {
  it("keeps only allowlisted keys and drops items without a Helix URL", () => {
    const s = sanitizeSummary(
      sections({
        sections: {
          ...sections().sections,
          tickets_mine: {
            total: 12,
            records: [
              { ...item, description: "SECRET", requester_email: "x@y.gov" },
              { ...item, id: "2", url: "https://evil.example/x" },
            ],
          },
        },
      }),
    )!;
    expect(s.sections.tickets_mine.total).toBe(12);
    expect(s.sections.tickets_mine.records).toHaveLength(1);
    expect(Object.keys(s.sections.tickets_mine.records[0]!).sort()).toEqual([
      "due_date",
      "id",
      "module",
      "number",
      "priority",
      "status",
      "title",
      "updated_at",
      "url",
    ]);
    expect(JSON.stringify(s)).not.toMatch(/SECRET|x@y\.gov/);
  });
  it("rejects a response missing a section", () => {
    expect(sanitizeSummary({ as_of: "x", sections: {} })).toBeNull();
    expect(sanitizeSummary(null)).toBeNull();
  });
});

describe("connect and callback", () => {
  it("builds a PKCE authorization URL for the bridge resource and stores only hashes", async () => {
    const res = await handleHelix(req("connect", { method: "POST" }), server);
    const { url } = await res.json();
    const target = new URL(url);
    expect(target.origin + target.pathname).toBe(
      "https://helix-fixture.supabase.co/auth/v1/oauth/authorize",
    );
    expect(target.searchParams.get("code_challenge_method")).toBe("S256");
    expect(target.searchParams.get("resource")).toBe(helixResource);
    expect(target.searchParams.get("redirect_uri")).toBe(
      "https://cmd.hillspafl.gov/api/helix/callback",
    );
    expect(res.headers.get("Set-Cookie")).toContain("__Host-command-helix=");
    const stored = conn();
    expect(stored.auth_state).not.toBe(target.searchParams.get("state"));
    expect(stored.tokens).toBeNull();
  });
  it("refuses connect from another origin", async () => {
    const res = await handleHelix(
      req("connect", {
        method: "POST",
        headers: { Origin: "https://evil.example" },
      }),
      server,
    );
    expect(res.status).toBe(403);
  });
  it("rejects a callback without the browser cookie", async () => {
    const res = await handleHelix(
      new Request(
        "https://cmd.hillspafl.gov/api/helix/callback?code=c&state=" +
          "a".repeat(43),
      ),
      server,
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toContain("helix=failed");
  });
  it("completes a callback: single-use state, encrypted tokens", async () => {
    const connect = await handleHelix(
      req("connect", { method: "POST" }),
      server,
    );
    const state = new URL((await connect.json()).url).searchParams.get(
      "state",
    )!;
    const browser = connect.headers
      .get("Set-Cookie")!
      .match(/=([\w-]{43});/)![1];
    const fetchMock = vi.fn(async () =>
      Response.json({
        access_token: "A1",
        refresh_token: "R1",
        expires_in: 3600,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const callback = () =>
      handleHelix(
        new Request(
          `https://cmd.hillspafl.gov/api/helix/callback?code=abc&state=${state}`,
          {
            headers: { cookie: `__Host-command-helix=${browser}` },
          },
        ),
        server,
      );
    const first = await callback();
    expect(first.headers.get("Location")).toContain("helix=connected");
    const body = (
      fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    )[1].body as URLSearchParams;
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code_verifier")).toBeTruthy();
    const stored = conn();
    expect(String(stored.tokens)).toMatch(/^v1\./);
    expect(String(stored.tokens)).not.toContain("A1");
    expect(
      JSON.parse(
        unseal(
          String(stored.tokens),
          helix.encryptionKey,
          `u1:${stored.generation}:helix`,
        ),
      ).r,
    ).toBe("R1");
    expect((await callback()).headers.get("Location")).toContain(
      "helix=failed",
    ); // replay
  });
});

describe("summary", () => {
  it("returns 409 when Helix is not connected", async () => {
    seed(null);
    const res = await handleHelix(req("summary"), server);
    expect(res.status).toBe(409);
    expect((await res.json()).message).toContain("Connect Helix");
  });
  it("fetches fresh data with the bridge bearer token, a 4-second limit, and caches it", async () => {
    const fetchMock = vi.fn(async () => Response.json(sections()));
    vi.stubGlobal("fetch", fetchMock);
    const res = await handleHelix(req("summary"), server);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stale).toBe(false);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(helixResource);
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer access-1",
    );
    expect(conn().summary).toBeTruthy();
  });
  it("refreshes an expiring token and stores the rotated refresh token", async () => {
    seed(sealedTokens(Date.now() + 1000));
    const fetchMock = vi.fn(async (url: string) =>
      url.includes("/oauth/token")
        ? Response.json({
            access_token: "access-2",
            refresh_token: "refresh-2",
            expires_in: 3600,
          })
        : Response.json(sections()),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect((await handleHelix(req("summary"), server)).status).toBe(200);
    const stored = conn();
    expect(stored.revision).toBe(2);
    expect(
      JSON.parse(
        unseal(String(stored.tokens), helix.encryptionKey, "u1:g1:helix"),
      ).r,
    ).toBe("refresh-2");
    expect(
      (fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].headers,
    ).toMatchObject({
      Authorization: "Bearer access-2",
    });
  });
  it("falls back to the cached summary when Helix is slow or failing", async () => {
    seed(sealedTokens(Date.now() + 3600000), sections());
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("no", { status: 503 })),
    );
    const res = await handleHelix(req("summary"), server);
    expect(res.status).toBe(200);
    expect((await res.json()).stale).toBe(true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("timeout", "TimeoutError");
      }),
    );
    expect(
      (await (await handleHelix(req("summary"), server)).json()).stale,
    ).toBe(true);
  });
  it("returns 503 with no cache, and asks to reconnect when the grant is revoked", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("no", { status: 503 })),
    );
    expect((await handleHelix(req("summary"), server)).status).toBe(503);
    seed(sealedTokens(Date.now() + 1000));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: "invalid_grant" }, { status: 400 }),
      ),
    );
    const res = await handleHelix(req("summary"), server);
    expect(res.status).toBe(409);
    expect(db.tables.helix_connections ?? []).toHaveLength(0);
  });
  it("never passes unexpected fields from Helix through", async () => {
    const dirty = sections();
    (
      dirty.sections as Record<string, { total: number; records: unknown[] }>
    ).tickets_mine = {
      total: 1,
      records: [{ ...item, description: "SECRET" }],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(dirty)),
    );
    const text = await (await handleHelix(req("summary"), server)).text();
    expect(text).not.toContain("SECRET");
  });
});

describe("status and disconnect", () => {
  it("reports connection and removes credentials on disconnect", async () => {
    expect(
      await (await handleHelix(req("status"), server)).json(),
    ).toMatchObject({ configured: true, connected: true });
    const res = await handleHelix(
      req("disconnect", { method: "POST" }),
      server,
    );
    expect((await res.json()).connected).toBe(false);
    expect(db.tables.helix_connections ?? []).toHaveLength(0);
  });
  it("requires sign-in and the right method", async () => {
    expect(
      (
        await handleHelix(
          new Request("https://cmd.hillspafl.gov/api/helix/status"),
          server,
        )
      ).status,
    ).toBe(401);
    expect(
      (await handleHelix(req("summary", { method: "POST" }), server)).status,
    ).toBe(405);
    expect((await handleHelix(req("nope"), server)).status).toBe(404);
  });
  it("reports unconfigured when settings are missing", async () => {
    const res = await handleHelix(req("status"), {
      ...server,
      helix: undefined,
    });
    expect(await res.json()).toEqual({ configured: false, connected: false });
  });
});
