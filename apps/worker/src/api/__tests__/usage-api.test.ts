import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";

import { FakeUsageDb } from "../../usage/__tests__/fake-usage-db.js";

/*
 * Env must be set before server.ts is imported; the
 * real pool is replaced below, so no database is
 * touched.
 */
process.env.DATABASE_URL = "postgres://test:test@127.0.0.1:1/test";
process.env.VERCEL = "1";
process.env.NODE_ENV = "test";
process.env.CREDENTIAL_VAULT_MASTER_KEY = "test-master-key-for-usage";
process.env.GOOGLE_CLIENT_ID ??= "test-client-id";
process.env.GOOGLE_CLIENT_SECRET ??= "test-client-secret";
process.env.GOOGLE_REDIRECT_URI ??= "http://localhost/api/oauth/google/callback";

const sha = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TOKEN_A = "token-for-account-a";
const TOKEN_B = "token-for-account-b";

const sessions = new Map([
  [sha(TOKEN_A), USER_A],
  [sha(TOKEN_B), USER_B],
]);

const memberships = [
  { userId: USER_A, tenantId: TENANT_A },
  { userId: USER_B, tenantId: TENANT_B },
];

const usageDb = new FakeUsageDb();

function fakeQuery(sql: string, params: unknown[] = []) {
  if (sql.includes("/* usage.")) {
    return usageDb.query(sql, params);
  }

  if (sql.includes("FROM platform.sessions")) {
    const userId = sessions.get(params[0] as string);

    return Promise.resolve({
      rows: userId
        ? [
            {
              id: "s",
              user_id: userId,
              expires_at: new Date(Date.now() + 3_600_000),
              created_at: new Date(),
            },
          ]
        : [],
    });
  }

  if (sql.includes("FROM platform.users")) {
    return Promise.resolve({
      rows: [
        {
          id: params[0],
          email: "x@example.com",
          full_name: null,
          status: "active",
        },
      ],
    });
  }

  if (
    sql.includes("platform.workspace_members wm") &&
    sql.includes("w.tenant_id::text")
  ) {
    const [tenantId, userId] = params as [string, string];

    return Promise.resolve({
      rows: memberships.some(
        (m) => m.tenantId === tenantId && m.userId === userId
      )
        ? [{ "?column?": 1 }]
        : [],
    });
  }

  throw new Error(`unexpected query: ${sql.trim().slice(0, 60)}`);
}

let server: Server;
let baseUrl: string;

/* Seed straight into the fake table, at the fake clock's "now". */
function seed(
  tenantId: string,
  provider: string,
  units: number,
  cost: number,
  success = true,
  at: Date = usageDb.now
) {
  usageDb.events.push({
    tenant_id: tenantId,
    provider,
    operation: "op",
    units,
    cost_estimate: cost,
    job_id: null,
    success,
    error: success ? null : "boom",
    created_at: at,
  });
}

before(async () => {
  const { pool } = await import("../../database/postgres/connection.js");
  (pool as unknown as { query: typeof fakeQuery }).query = fakeQuery;

  /* The route reads "the current month" from the real clock; pin the fake's to it. */
  usageDb.now = new Date();

  const { default: app } = await import("../server.js");
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
});

const get = (path: string, token?: string) =>
  fetch(`${baseUrl}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

describe("GET /api/tenants/:tenantId/usage", () => {
  it("returns this month's totals per provider for the owner", async () => {
    seed(TENANT_A, "openrouter", 1500, 0);
    seed(TENANT_A, "openrouter", 500, 0.002);
    seed(TENANT_A, "firecrawl", 1, 0.0053);
    seed(TENANT_A, "firecrawl", 0, 0, false);
    seed(TENANT_A, "serpapi", 1, 0.015);

    const res = await get(`/api/tenants/${TENANT_A}/usage`, TOKEN_A);
    const json = await res.json();

    assert.equal(res.status, 200);
    assert.equal(json.success, true);

    const { data } = json;

    assert.equal(data.currency, "USD");
    assert.match(data.period.label, /^\d{4}-\d{2}$/);

    const by = Object.fromEntries(
      data.providers.map((p: { provider: string }) => [p.provider, p])
    );

    assert.deepEqual(by.openrouter, {
      provider: "openrouter",
      unit: "token",
      requests: 2,
      failedRequests: 0,
      units: 2000,
      costEstimate: 0.002,
    });
    assert.equal(by.firecrawl.requests, 2);
    assert.equal(by.firecrawl.failedRequests, 1);
    assert.equal(by.firecrawl.units, 1);
    assert.equal(by.serpapi.requests, 1);

    assert.ok(Math.abs(data.totalCostEstimate - 0.0223) < 1e-9);
  });

  it("lists every provider, zero-filled, for a tenant with no usage", async () => {
    const res = await get(`/api/tenants/${TENANT_B}/usage`, TOKEN_B);
    const { data } = await res.json();

    assert.equal(res.status, 200);
    assert.deepEqual(
      data.providers.map((p: { provider: string }) => p.provider).sort(),
      ["firecrawl", "openrouter", "serpapi"]
    );
    assert.ok(
      data.providers.every(
        (p: { requests: number; costEstimate: number }) =>
          p.requests === 0 && p.costEstimate === 0
      )
    );
    assert.equal(data.totalCostEstimate, 0);
  });

  it("only counts the current month", async () => {
    const lastMonth = new Date(usageDb.now);
    lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);

    seed(TENANT_B, "serpapi", 7, 0.105, true, lastMonth);

    const { data } = await (
      await get(`/api/tenants/${TENANT_B}/usage`, TOKEN_B)
    ).json();

    assert.equal(
      data.providers.find((p: { provider: string }) => p.provider === "serpapi")
        .requests,
      0
    );
  });

  it("is tenant-scoped: another account gets 404 for the owner's tenant", async () => {
    const res = await get(`/api/tenants/${TENANT_A}/usage`, TOKEN_B);
    const body = await res.json();

    assert.equal(res.status, 404);
    assert.equal(body.success, false);
    assert.ok(!JSON.stringify(body).includes("providers"));
  });

  it("never mixes tenants: each account sees only its own totals", async () => {
    seed(TENANT_B, "firecrawl", 9, 0.0477);

    const a = (await (await get(`/api/tenants/${TENANT_A}/usage`, TOKEN_A)).json())
      .data;
    const b = (await (await get(`/api/tenants/${TENANT_B}/usage`, TOKEN_B)).json())
      .data;

    const firecrawl = (d: typeof a) =>
      d.providers.find((p: { provider: string }) => p.provider === "firecrawl");

    assert.equal(firecrawl(a).units, 1);
    assert.equal(firecrawl(b).units, 9);
  });

  it("requires login", async () => {
    assert.equal((await get(`/api/tenants/${TENANT_A}/usage`)).status, 401);
  });

  it("'latest' and malformed ids are 404, not a server error", async () => {
    assert.equal((await get("/api/tenants/latest/usage", TOKEN_A)).status, 404);
    assert.equal((await get("/api/tenants/not-a-uuid/usage", TOKEN_A)).status, 404);
  });
});
