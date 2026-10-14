import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";

import { FakeJobsDb } from "../../jobs/__tests__/fake-jobs-db.js";

/*
 * Env must be set before server.ts is imported; the
 * real pool is replaced below, so no database is
 * touched.
 */
process.env.DATABASE_URL = "postgres://test:test@127.0.0.1:1/test";
process.env.VERCEL = "1";
process.env.NODE_ENV = "test";
process.env.CREDENTIAL_VAULT_MASTER_KEY = "test-master-key-for-jobs";
process.env.GOOGLE_CLIENT_ID ??= "test-client-id";
process.env.GOOGLE_CLIENT_SECRET ??= "test-client-secret";
process.env.GOOGLE_REDIRECT_URI ??= "http://localhost/api/oauth/google/callback";
delete process.env.CRON_SECRET;

const sha = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TOKEN_A = "token-for-account-a";
const TOKEN_B = "token-for-account-b";
const SECRET = "cron-secret-for-tests";

const sessions = new Map([
  [sha(TOKEN_A), USER_A],
  [sha(TOKEN_B), USER_B],
]);

const memberships = [
  { userId: USER_A, tenantId: TENANT_A },
  { userId: USER_B, tenantId: TENANT_B },
];

const jobsDb = new FakeJobsDb();

function fakeQuery(sql: string, params: unknown[] = []) {
  if (sql.includes("/* jobs.")) {
    return jobsDb.query(sql, params);
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

  /* stage1-audit pre-checks: schema name + verified domain */
  if (sql.includes("domain_verified_at") && sql.includes("FROM platform.tenants")) {
    return Promise.resolve({
      rows: [
        { schema_name: "tenant_test", domain_verified_at: new Date() },
      ],
    });
  }

  throw new Error(`unexpected query: ${sql.trim().slice(0, 60)}`);
}

let server: Server;
let baseUrl: string;
let kicks = 0;

before(async () => {
  const { pool } = await import("../../database/postgres/connection.js");
  (pool as unknown as { query: typeof fakeQuery }).query = fakeQuery;

  const { jobKick } = await import("../../jobs/job-kick.js");
  jobKick.run = () => {
    kicks += 1;
  };

  const { default: app } = await import("../server.js");
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
});

const call = (
  method: string,
  path: string,
  options: { token?: string; body?: unknown; headers?: Record<string, string> } = {}
) =>
  fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...options.headers,
    },
    body: method === "POST" ? JSON.stringify(options.body ?? {}) : undefined,
  });

const auditBody = {
  websiteUrl: "https://example.com",
  queries: [{ query: "best crm", category: "commercial" }],
};

/* ========================================
   ENQUEUE (stage routes answer 202)
======================================== */

describe("stage routes enqueue instead of running", () => {
  it("POST stage1-audit returns 202 with a job id, stores the job for that tenant, and kicks the runner", async () => {
    const before = kicks;

    const res = await call("POST", `/api/tenants/${TENANT_A}/stage1-audit`, {
      token: TOKEN_A,
      body: auditBody,
    });
    const json = await res.json();

    assert.equal(res.status, 202);
    assert.equal(json.success, true);
    assert.equal(json.data.status, "queued");
    assert.equal(json.data.deduplicated, false);
    assert.equal(kicks, before + 1);

    const stored = jobsDb.job(json.data.jobId);
    assert.equal(stored.tenant_id, TENANT_A);
    assert.equal(stored.type, "stage1-audit");
    assert.equal(stored.status, "queued");
    assert.equal((stored.payload as { websiteUrl: string }).websiteUrl, "https://example.com");
  });

  it("an identical request while the first is active returns the same job", async () => {
    const first = await (
      await call("POST", `/api/tenants/${TENANT_A}/stage1-audit`, {
        token: TOKEN_A,
        body: { ...auditBody, websiteUrl: "https://dedupe.example.com" },
      })
    ).json();

    const second = await (
      await call("POST", `/api/tenants/${TENANT_A}/stage1-audit`, {
        token: TOKEN_A,
        body: { ...auditBody, websiteUrl: "https://dedupe.example.com" },
      })
    ).json();

    assert.equal(second.data.jobId, first.data.jobId);
    assert.equal(second.data.deduplicated, true);
  });

  it("invalid input is still rejected synchronously and queues nothing", async () => {
    const count = jobsDb.jobs.length;

    const res = await call("POST", `/api/tenants/${TENANT_A}/stage1-audit`, {
      token: TOKEN_A,
      body: { websiteUrl: "https://example.com", queries: [] },
    });

    assert.equal(res.status, 400);
    assert.equal(jobsDb.jobs.length, count);
  });

  it("a non-member cannot enqueue on another tenant", async () => {
    const count = jobsDb.jobs.length;

    const res = await call("POST", `/api/tenants/${TENANT_A}/stage1-audit`, {
      token: TOKEN_B,
      body: auditBody,
    });

    assert.equal(res.status, 404);
    assert.equal(jobsDb.jobs.length, count);
  });

  it("unauthenticated is 401", async () => {
    const res = await call("POST", `/api/tenants/${TENANT_A}/stage1-audit`, {
      body: auditBody,
    });

    assert.equal(res.status, 401);
  });
});

/* ========================================
   STATUS ROUTE: TENANT ISOLATION
======================================== */

describe("GET /api/tenants/:tenantId/jobs/:jobId", () => {
  const status = (tenantId: string, jobId: string, token?: string) =>
    call("GET", `/api/tenants/${tenantId}/jobs/${jobId}`, { token });

  it("the owner sees its job's status, without the payload", async () => {
    const id = await (await import("../../jobs/job-queue-instance.js")).jobQueue.enqueue(
      TENANT_A,
      "stage2-plan",
      { secret: "payload" }
    );

    const res = await status(TENANT_A, id, TOKEN_A);
    const json = await res.json();

    assert.equal(res.status, 200);
    assert.equal(json.data.id, id);
    assert.equal(json.data.type, "stage2-plan");
    assert.equal(json.data.status, "queued");
    assert.equal(json.data.result, null);
    assert.ok(!JSON.stringify(json).includes("payload"));
  });

  it("shows the result of a succeeded job and the error of a failed one", async () => {
    const { jobQueue } = await import("../../jobs/job-queue-instance.js");

    const ok = await jobQueue.enqueue(TENANT_A, "x");
    jobsDb.job(ok).status = "succeeded";
    jobsDb.job(ok).result = { score: 7 };

    const bad = await jobQueue.enqueue(TENANT_A, "y");
    jobsDb.job(bad).status = "failed";
    jobsDb.job(bad).error = "agent exploded";

    const okJson = await (await status(TENANT_A, ok, TOKEN_A)).json();
    const badJson = await (await status(TENANT_A, bad, TOKEN_A)).json();

    assert.deepEqual(okJson.data.result, { score: 7 });
    assert.equal(okJson.data.error, null);
    assert.equal(badJson.data.error, "agent exploded");
    assert.equal(badJson.data.result, null);
  });

  it("another account cannot read it through the owner's tenant URL", async () => {
    const { jobQueue } = await import("../../jobs/job-queue-instance.js");
    const id = await jobQueue.enqueue(TENANT_A, "stage2-plan");

    assert.equal((await status(TENANT_A, id, TOKEN_B)).status, 404);
  });

  it("another account cannot read it through its own tenant URL either", async () => {
    const { jobQueue } = await import("../../jobs/job-queue-instance.js");
    const id = await jobQueue.enqueue(TENANT_A, "stage2-plan");

    assert.equal((await status(TENANT_B, id, TOKEN_B)).status, 404);
  });

  it("a member cannot read a job of a different tenant by putting its id under their own tenant", async () => {
    const { jobQueue } = await import("../../jobs/job-queue-instance.js");
    const foreign = await jobQueue.enqueue(TENANT_B, "stage2-plan");

    /* A is a member of TENANT_A only; the job belongs to TENANT_B. */
    assert.equal((await status(TENANT_A, foreign, TOKEN_A)).status, 404);
    assert.equal((await status(TENANT_B, foreign, TOKEN_B)).status, 200);
  });

  it("unknown and malformed ids are 404; unauthenticated is 401", async () => {
    assert.equal(
      (await status(TENANT_A, "cccccccc-cccc-4ccc-8ccc-cccccccccccc", TOKEN_A)).status,
      404
    );
    assert.equal((await status(TENANT_A, "not-a-uuid", TOKEN_A)).status, 404);
    assert.equal((await status(TENANT_A, "1%27%20OR%201=1", TOKEN_A)).status, 404);
    assert.equal(
      (await status(TENANT_A, "cccccccc-cccc-4ccc-8ccc-cccccccccccc")).status,
      401
    );
  });
});

/* ========================================
   POST /api/jobs/run: CRON_SECRET
======================================== */

describe("POST /api/jobs/run", () => {
  const run = (authorization?: string) =>
    call("POST", "/api/jobs/run", {
      headers: authorization ? { authorization } : {},
    });

  it("refuses to run when CRON_SECRET is not configured (fails closed)", async () => {
    delete process.env.CRON_SECRET;

    assert.equal((await run()).status, 503);
    assert.equal((await run("Bearer ")).status, 503);
    assert.equal((await run("Bearer undefined")).status, 503);
  });

  it("rejects a missing, malformed or wrong bearer token", async () => {
    process.env.CRON_SECRET = SECRET;

    assert.equal((await run()).status, 401);
    assert.equal((await run("Bearer")).status, 401);
    assert.equal((await run(SECRET)).status, 401, "token without the Bearer prefix");
    assert.equal((await run("Bearer wrong")).status, 401);
    assert.equal(
      (await run(`Bearer ${SECRET.slice(0, -1)}x`)).status,
      401,
      "same length, one character off"
    );
    assert.equal((await run(`Bearer ${SECRET}x`)).status, 401);
  });

  it("does not accept a user session token", async () => {
    process.env.CRON_SECRET = SECRET;

    assert.equal((await run(`Bearer ${TOKEN_A}`)).status, 401);
  });

  it("with the right secret it processes queued jobs and returns a summary", async () => {
    process.env.CRON_SECRET = SECRET;

    const { jobQueue } = await import("../../jobs/job-queue-instance.js");
    const id = await jobQueue.enqueue(TENANT_A, "no-such-handler");

    const res = await run(`Bearer ${SECRET}`);
    const json = await res.json();

    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.ok(json.data.processed >= 1);
    assert.ok(json.data.failed >= 1);
    assert.equal(typeof json.data.elapsedMs, "number");
    assert.equal(jobsDb.job(id).status, "failed");
    assert.match(jobsDb.job(id).error ?? "", /No handler registered/);
  });

  it("is not reachable by GET", async () => {
    process.env.CRON_SECRET = SECRET;

    const res = await call("GET", "/api/jobs/run", {
      headers: { authorization: `Bearer ${SECRET}` },
    });

    assert.equal(res.status, 404);
  });
});
