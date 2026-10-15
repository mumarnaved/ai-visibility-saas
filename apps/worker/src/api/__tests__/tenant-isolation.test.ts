import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, before, describe, it, mock } from "node:test";

/*
 * Env must be set before server.ts is imported:
 * connection.ts throws without DATABASE_URL, and
 * the real pool is never used (pool.query is
 * replaced below), so no database is touched.
 */
process.env.DATABASE_URL = "postgres://test:test@127.0.0.1:1/test";
process.env.VERCEL = "1";
process.env.NODE_ENV = "test";
process.env.CREDENTIAL_VAULT_MASTER_KEY = "test-master-key-for-oauth-state";
process.env.WEB_APP_URL = "http://web.test";
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

const users = new Map([
  [USER_A, "a@example.com"],
  [USER_B, "b@example.com"],
]);

/* workspace_members: user -> tenants they belong to */
const memberships = [
  { userId: USER_A, tenantId: TENANT_A },
  { userId: USER_B, tenantId: TENANT_B },
];

/* Any query that is not auth / membership means a handler ran. */
const handlerQueries: string[] = [];

function fakeQuery(sql: string, params: unknown[] = []) {
  if (sql.includes("FROM platform.sessions")) {
    const userId = sessions.get(params[0] as string);
    return {
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
    };
  }

  if (sql.includes("FROM platform.users")) {
    const email = users.get(params[0] as string);
    return {
      rows: email
        ? [{ id: params[0], email, full_name: null, status: "active" }]
        : [],
    };
  }

  if (
    sql.includes("platform.workspace_members wm") &&
    sql.includes("w.tenant_id::text")
  ) {
    const [tenantId, userId] = params as [string, string];
    const found = memberships.some(
      (m) => m.tenantId === tenantId && m.userId === userId
    );
    return { rows: found ? [{ "?column?": 1 }] : [] };
  }

  handlerQueries.push(sql);
  throw new Error("handler reached the database");
}

/* [method, path template] for every /api/tenants/:tenantId/* route. */
const TENANT_ROUTES: Array<[string, string]> = [
  ["POST", "/stage1-audit"],
  ["POST", "/stage2-plan"],
  ["GET", "/stage2-plan/latest"],
  ["POST", "/stage2-plan/some-plan/approve"],
  ["POST", "/stage3-produce"],
  ["POST", "/stage3-fix"],
  ["GET", "/execution-tasks"],
  ["POST", "/execution-tasks/some-task/approve"],
  ["POST", "/execution-tasks/some-task/publish"],
  ["POST", "/stage4-monitor"],
  ["POST", "/stage4-report"],
  ["GET", "/monitoring/latest"],
  ["GET", "/reports/latest"],
  ["GET", "/oauth/google/start"],
  ["GET", "/oauth/google/status"],
  ["POST", "/oauth/google/disconnect"],
  ["POST", "/verify-domain"],
  ["POST", "/quick-verify-domain"],
  ["GET", "/jobs/some-job"],
  ["GET", "/usage"],
];

/* Routes under /api/citation-audit, which take ?tenantId=. */
const CITATION_ROUTES = ["/metrics", "/queries", "/latest"];

let server: Server;
let baseUrl: string;

before(async () => {
  const { pool } = await import("../../database/postgres/connection.js");
  (pool as unknown as { query: typeof fakeQuery }).query = fakeQuery;

  const { default: app } = await import("../server.js");
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
});

const call = (method: string, path: string, token?: string) =>
  fetch(`${baseUrl}${path}`, {
    method,
    redirect: "manual",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: method === "POST" ? "{}" : undefined,
  });

describe("route guard (static)", () => {
  const source = readFileSync(
    new URL("../server.ts", import.meta.url),
    "utf8"
  );

  it("every route that takes a tenantId sits under a tenant-access mount", () => {
    /* app.use("<prefix>", requireTenantAccess[FromQuery]) mounts */
    const mounts = [
      ...source.matchAll(
        /app\.use\(\s*"([^"]+)"\s*,\s*requireTenantAccess(?:FromQuery)?\s*\)/g
      ),
    ].map((m) => m[1]!);
    assert.ok(mounts.length >= 2, "tenant-access mounts not found");

    /* Split into top-level blocks (route, section banner, function) and inspect each route body. */
    const blocks = source.split(
      /\n(?=app\.|\/\* =====|export |async function |function )/
    );
    const routes: string[] = [];

    for (const block of blocks) {
      const head = block.match(
        /^app\.(?:get|post|put|patch|delete)\(\s*"([^"]+)"/
      );
      if (!head) continue;

      const path = head[1]!;
      const takesTenantId =
        path.includes(":tenantId") ||
        /req\.(?:query|body|params)\.tenantId/.test(block);
      if (!takesTenantId) continue;

      routes.push(path);
      assert.ok(
        mounts.some((prefix) => path.startsWith(prefix)),
        `route ${path} takes a tenantId but is not under a tenant-access mount`
      );
    }

    /* The detector must actually be finding the known routes. */
    assert.ok(
      routes.length >= TENANT_ROUTES.length + CITATION_ROUTES.length,
      `guard only found ${routes.length} tenantId routes`
    );
  });

  it("every /api/tenants/:tenantId route in server.ts is exercised below", () => {
    const declared = [
      ...source.matchAll(/"\/api\/tenants\/:tenantId(\/[^"]*)"/g),
    ].map((m) => m[1]!);
    const tested = new Set(
      TENANT_ROUTES.map(([, path]) =>
        path.replace("some-plan", ":planId").replace("some-task", ":taskId")
        .replace("some-job", ":jobId")
      )
    );

    for (const route of new Set(declared)) {
      assert.ok(tested.has(route), `route ${route} is not covered by this test`);
    }
  });
});

describe("tenant isolation (requireTenantAccess)", () => {
  for (const [method, path] of TENANT_ROUTES) {
    it(`B gets 404 on A's tenant: ${method} ${path}`, async () => {
      handlerQueries.length = 0;

      const res = await call(method, `/api/tenants/${TENANT_A}${path}`, TOKEN_B);

      assert.equal(res.status, 404);
      assert.equal(handlerQueries.length, 0, "handler ran for a non-member");
    });
  }

  it("a made-up tenant id is also 404 (indistinguishable from A's)", async () => {
    const res = await call(
      "GET",
      "/api/tenants/not-a-uuid/execution-tasks",
      TOKEN_B
    );
    assert.equal(res.status, 404);
  });

  it("A is let through to the handler on its own tenant", async () => {
    handlerQueries.length = 0;
    const res = await call(
      "GET",
      `/api/tenants/${TENANT_A}/execution-tasks`,
      TOKEN_A
    );
    assert.notEqual(res.status, 404);
    assert.ok(handlerQueries.length > 0, "handler never ran for the owner");
  });

  it("B is let through on B's own tenant (symmetry)", async () => {
    handlerQueries.length = 0;
    const res = await call(
      "GET",
      `/api/tenants/${TENANT_B}/execution-tasks`,
      TOKEN_B
    );
    assert.notEqual(res.status, 404);
    assert.ok(handlerQueries.length > 0);
  });

  it("unauthenticated requests still get 401, not 404", async () => {
    const res = await call("GET", `/api/tenants/${TENANT_A}/execution-tasks`);
    assert.equal(res.status, 401);
  });

  it("GET /api/tenants/latest is not treated as a tenant id", async () => {
    handlerQueries.length = 0;
    const res = await call("GET", "/api/tenants/latest", TOKEN_B);

    /* Reaches its own handler (fake DB then errors -> 500), not the 404 gate. */
    assert.equal(res.status, 500);
    assert.ok(handlerQueries.length > 0);
  });
});

describe("citation-audit tenant isolation", () => {
  const get = (path: string, token?: string) =>
    call("GET", `/api/citation-audit${path}`, token);

  for (const route of CITATION_ROUTES) {
    it(`B gets 404 reading A's data: ${route}`, async () => {
      handlerQueries.length = 0;
      const res = await get(`${route}?tenantId=${TENANT_A}`, TOKEN_B);
      assert.equal(res.status, 404);
      assert.equal(handlerQueries.length, 0, "handler ran for a non-member");
    });

    it(`A reaches the handler on own tenant: ${route}`, async () => {
      handlerQueries.length = 0;
      const res = await get(`${route}?tenantId=${TENANT_A}`, TOKEN_A);
      assert.notEqual(res.status, 404);
      assert.ok(handlerQueries.length > 0);
    });

    it(`missing / blank / repeated / malformed tenantId is handled safely: ${route}`, async () => {
      handlerQueries.length = 0;

      assert.equal((await get(route, TOKEN_A)).status, 400);
      assert.equal((await get(`${route}?tenantId=`, TOKEN_A)).status, 400);
      assert.equal((await get(`${route}?tenantId=%20%20`, TOKEN_A)).status, 400);
      assert.equal(
        (await get(`${route}?tenantId=${TENANT_A}&tenantId=${TENANT_B}`, TOKEN_A))
          .status,
        400,
        "repeated tenantId must not slip through as an array"
      );
      assert.equal(
        (await get(`${route}?tenantId[]=${TENANT_A}`, TOKEN_A)).status,
        400
      );
      assert.equal(
        (await get(`${route}?tenantId=not-a-uuid`, TOKEN_A)).status,
        404
      );
      assert.equal(
        (
          await get(
            `${route}?tenantId=${encodeURIComponent("' OR 1=1 --")}`,
            TOKEN_A
          )
        ).status,
        404
      );

      assert.equal(handlerQueries.length, 0, "handler ran for a bad tenantId");
    });

    it(`unauthenticated is 401: ${route}`, async () => {
      assert.equal((await get(`${route}?tenantId=${TENANT_A}`)).status, 401);
    });
  }
});

describe("google oauth state binding", () => {
  let state: typeof import("../../lib/google-oauth-state.js");

  before(async () => {
    state = await import("../../lib/google-oauth-state.js");
  });

  async function callback(stateValue: string, token?: string) {
    const res = await fetch(
      `${baseUrl}/api/oauth/google/callback?code=abc&state=${encodeURIComponent(
        stateValue
      )}`,
      {
        redirect: "manual",
        headers: token ? { authorization: `Bearer ${token}` } : {},
      }
    );
    assert.equal(res.status, 302);
    return new URL(res.headers.get("location")!).searchParams.get("reason");
  }

  const forge = (s: string, change: Record<string, string>) => {
    const [payload, sig] = s.split(".");
    const body = JSON.parse(Buffer.from(payload!, "base64url").toString());
    Object.assign(body, change);
    return `${Buffer.from(JSON.stringify(body)).toString("base64url")}.${sig}`;
  };

  it("a state round-trips both the tenant and the user who started it", () => {
    const s = state.buildOAuthState(TENANT_A, USER_A);
    assert.deepEqual(state.verifyOAuthState(s), {
      tenantId: TENANT_A,
      userId: USER_A,
    });
  });

  it("rejects a tampered payload (swapped tenant, original signature)", async () => {
    const tampered = forge(state.buildOAuthState(TENANT_A, USER_A), {
      tenantId: TENANT_B,
    });
    assert.equal(state.verifyOAuthState(tampered), null);
    assert.equal(await callback(tampered), "invalid_state");
  });

  it("rejects a tampered payload (swapped user, original signature)", async () => {
    const tampered = forge(state.buildOAuthState(TENANT_A, USER_A), {
      userId: USER_B,
    });
    assert.equal(await callback(tampered), "invalid_state");
  });

  it("rejects a tampered, truncated or garbage signature", async () => {
    const s = state.buildOAuthState(TENANT_A, USER_A);
    assert.equal(await callback(s.slice(0, -4) + "AAAA"), "invalid_state");
    assert.equal(await callback(s.slice(0, -1)), "invalid_state");
    assert.equal(await callback("garbage"), "invalid_state");
    assert.equal(await callback("a.b"), "invalid_state");
  });

  it("rejects a correctly signed state that has no user binding", async () => {
    const payload = Buffer.from(
      JSON.stringify({ tenantId: TENANT_A, nonce: "n", issuedAt: Date.now() })
    ).toString("base64url");
    const sig = createHmac("sha256", process.env.CREDENTIAL_VAULT_MASTER_KEY!)
      .update(payload)
      .digest("base64url");
    assert.equal(await callback(`${payload}.${sig}`), "invalid_state");
  });

  it("rejects an expired state", async () => {
    const realNow = Date.now();
    const clock = mock.method(Date, "now", () => realNow - 11 * 60 * 1000);
    const expired = state.buildOAuthState(TENANT_A, USER_A);
    clock.mock.restore();

    assert.equal(state.verifyOAuthState(expired), null);
    assert.equal(await callback(expired), "invalid_state");
  });

  it("rejects a state started by a different user than the session presented", async () => {
    handlerQueries.length = 0;
    const startedByA = state.buildOAuthState(TENANT_A, USER_A);

    assert.equal(await callback(startedByA, TOKEN_B), "user_mismatch");
    assert.equal(handlerQueries.length, 0, "tenant lookup / token exchange ran");
  });

  it("rejects a state whose user is not a member of the tenant", async () => {
    handlerQueries.length = 0;
    const bOnA = state.buildOAuthState(TENANT_A, USER_B);

    assert.equal(await callback(bOnA), "access_denied");
    assert.equal(handlerQueries.length, 0);
  });

  it("a valid state for a member passes the gates (with and without a session)", async () => {
    const s = state.buildOAuthState(TENANT_A, USER_A);

    for (const token of [undefined, TOKEN_A]) {
      handlerQueries.length = 0;
      // Gates pass; the fake DB then fails the tenant lookup -> server_error.
      assert.equal(await callback(s, token), "server_error");
      assert.ok(handlerQueries.length > 0, "callback never got past the gates");
    }
  });
});
