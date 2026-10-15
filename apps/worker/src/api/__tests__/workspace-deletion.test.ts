import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, before, beforeEach, describe, it } from "node:test";

import { LIVE_TENANT_SQL } from "../../lib/tenant-status.js";

/*
 * Env must be set before server.ts is imported; the real
 * pool is replaced below, so no database is touched.
 */
process.env.DATABASE_URL = "postgres://test:test@127.0.0.1:1/test";
process.env.VERCEL = "1";
process.env.NODE_ENV = "test";
process.env.CREDENTIAL_VAULT_MASTER_KEY = "test-master-key-for-deletion";
process.env.GOOGLE_CLIENT_ID ??= "test-client-id";
process.env.GOOGLE_CLIENT_SECRET ??= "test-client-secret";
process.env.GOOGLE_REDIRECT_URI ??= "http://localhost/api/oauth/google/callback";
process.env.TENANT_RETENTION_DAYS = "7";

const sha = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const USER_OWNER = "11111111-1111-4111-8111-111111111111";
const USER_MEMBER = "22222222-2222-4222-8222-222222222222";
const USER_OTHER = "33333333-3333-4333-8333-333333333333";

const T_NEX = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const T_NEX2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const T_OTHER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const TOKENS: Record<string, string> = {
  "token-owner": USER_OWNER,
  "token-member": USER_MEMBER,
  "token-other": USER_OTHER,
};

const sessions = new Map(
  Object.entries(TOKENS).map(([token, userId]) => [sha(token), userId])
);

interface FakeTenant {
  id: string;
  name: string;
  slug: string;
  schema_name: string;
  status: string;
  deprovision_at: Date | null;
  created_at: Date;
}

interface FakeMembership {
  tenantId: string;
  userId: string;
  role: string;
}

let tenants: FakeTenant[];
let memberships: FakeMembership[];
let auditRows: { schema: string; actor: unknown; action: string; metadata: any }[];
let failAuditInsert = false;

function reset() {
  const base = new Date("2026-08-26T19:20:00Z");

  tenants = [
    /* Two workspaces with the SAME name, as in real life. */
    {
      id: T_NEX,
      name: "nexflow",
      slug: "nexflow",
      schema_name: "tenant_nex",
      status: "active",
      deprovision_at: null,
      created_at: base,
    },
    {
      id: T_NEX2,
      name: "nexflow",
      slug: "nexflow-2",
      schema_name: "tenant_nex2",
      status: "active",
      deprovision_at: null,
      created_at: new Date(base.getTime() + 60_000),
    },
    {
      id: T_OTHER,
      name: "someone else",
      slug: "someone-else",
      schema_name: "tenant_other",
      status: "active",
      deprovision_at: null,
      created_at: base,
    },
  ];

  memberships = [
    { tenantId: T_NEX, userId: USER_OWNER, role: "owner" },
    { tenantId: T_NEX2, userId: USER_OWNER, role: "owner" },
    { tenantId: T_NEX, userId: USER_MEMBER, role: "member" },
    { tenantId: T_OTHER, userId: USER_OTHER, role: "owner" },
  ];

  auditRows = [];
  failAuditInsert = false;
}

const isLive = (t: FakeTenant) =>
  t.status !== "deprovisioning" && t.status !== "deprovisioned";

/* The fake only applies the live filter when the SQL really contains it. */
const applyLive = (sql: string, list: FakeTenant[]) =>
  sql.includes(LIVE_TENANT_SQL) ? list.filter(isLive) : list;

const tenantById = (id: string) => tenants.find((t) => t.id === id);

function fakeQuery(sql: string, params: unknown[] = []) {
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
          email: `${String(params[0]).slice(0, 4)}@example.com`,
          full_name: null,
          status: "active",
        },
      ],
    });
  }

  /* requireTenantAccess */
  if (
    sql.includes("platform.workspace_members wm") &&
    sql.includes("w.tenant_id::text")
  ) {
    const [tenantId, userId] = params as [string, string];

    const live = applyLive(
      sql,
      tenants.filter((t) => t.id === tenantId)
    );

    const member = memberships.some(
      (m) => m.tenantId === tenantId && m.userId === userId
    );

    return Promise.resolve({
      rows: live.length > 0 && member ? [{ "?column?": 1 }] : [],
    });
  }

  /* DELETE handler: the caller's membership and role */
  if (sql.includes("wm.role") && sql.includes("t.id::text = $1")) {
    const [tenantId, userId] = params as [string, string];
    const tenant = tenants.find((t) => t.id === tenantId);
    const m = memberships.find(
      (x) => x.tenantId === tenantId && x.userId === userId
    );

    return Promise.resolve({
      rows: tenant && m ? [{ ...tenant, role: m.role }] : [],
    });
  }

  /* scheduleTenantDeprovisioning */
  if (sql.includes("status = 'deprovisioning'")) {
    const [id, days] = params as [string, string];
    const tenant = tenantById(id);

    if (tenant) {
      tenant.status = "deprovisioning";
      tenant.deprovision_at = new Date(
        Date.now() + Number(days) * 86_400_000
      );
    }

    return Promise.resolve({ rows: [] });
  }

  if (sql.includes("SELECT deprovision_at")) {
    return Promise.resolve({
      rows: [{ deprovision_at: tenantById(params[0] as string)?.deprovision_at }],
    });
  }

  if (sql.includes(".audit_logs")) {
    if (failAuditInsert) {
      return Promise.reject(new Error("audit table missing"));
    }

    const schema = /"([a-z_0-9]+)"\.audit_logs/.exec(sql)?.[1] ?? "?";

    auditRows.push({
      schema,
      actor: params[0],
      action: "workspace.delete_requested",
      metadata: JSON.parse(params[1] as string),
    });

    return Promise.resolve({ rows: [] });
  }

  /* GET /api/tenants and /api/tenants/latest */
  if (
    sql.includes("FROM platform.tenants t") &&
    sql.includes("wm.user_id = $1") &&
    sql.includes("ORDER BY t.created_at DESC")
  ) {
    const userId = params[0] as string;

    const mine = applyLive(
      sql,
      tenants.filter((t) =>
        memberships.some((m) => m.tenantId === t.id && m.userId === userId)
      )
    ).sort((a, b) => b.created_at.getTime() - a.created_at.getTime());

    return Promise.resolve({
      rows: sql.includes("LIMIT 1") ? mine.slice(0, 1) : mine,
    });
  }

  /* countTenantsOwnedByUser */
  if (sql.includes("COUNT(*)::text AS count")) {
    const userId = params[0] as string;

    const mine = applyLive(
      sql,
      tenants.filter((t) =>
        memberships.some((m) => m.tenantId === t.id && m.userId === userId)
      )
    );

    return Promise.resolve({ rows: [{ count: String(mine.length) }] });
  }

  throw new Error(`unexpected query: ${sql.trim().slice(0, 70)}`);
}

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

beforeEach(reset);

const call = (
  method: string,
  path: string,
  token?: string,
  body?: unknown
) =>
  fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const del = (tenantId: string, token: string | undefined, body?: unknown) =>
  call("DELETE", `/api/tenants/${tenantId}`, token, body);

const list = async (token: string) =>
  (await (await call("GET", "/api/tenants", token)).json()).data as {
    id: string;
    slug: string;
  }[];

describe("DELETE /api/tenants/:tenantId: access", () => {
  it("a non-member gets 404 and nothing is scheduled", async () => {
    const res = await del(T_NEX, "token-other", { confirmSlug: "nexflow" });

    assert.equal(res.status, 404);
    assert.equal(tenantById(T_NEX)!.status, "active");
    assert.equal(tenantById(T_NEX)!.deprovision_at, null);
  });

  it("a member who is not the owner gets 403 and nothing is scheduled", async () => {
    const res = await del(T_NEX, "token-member", { confirmSlug: "nexflow" });
    const body = await res.json();

    assert.equal(res.status, 403);
    assert.match(body.error, /owner/i);
    assert.equal(tenantById(T_NEX)!.status, "active");
  });

  it("unauthenticated is 401", async () => {
    assert.equal((await del(T_NEX, undefined, { confirmSlug: "nexflow" })).status, 401);
    assert.equal(tenantById(T_NEX)!.status, "active");
  });

  it("'latest' and malformed ids are 404", async () => {
    assert.equal((await del("latest", "token-owner", { confirmSlug: "x" })).status, 404);
    assert.equal((await del("not-a-uuid", "token-owner", { confirmSlug: "x" })).status, 404);
  });
});

describe("DELETE /api/tenants/:tenantId: confirmation", () => {
  const attempts: Array<[string, unknown]> = [
    ["no body", undefined],
    ["empty body", {}],
    ["empty slug", { confirmSlug: "" }],
    ["the NAME of a same-named workspace instead of the slug", { confirmSlug: "nexflow-2" }],
    ["wrong case", { confirmSlug: "NEXFLOW" }],
    ["a non-string", { confirmSlug: 123 }],
    ["the old name field", { confirmName: "nexflow" }],
  ];

  for (const [label, body] of attempts) {
    it(`rejects ${label} with 400 and schedules nothing`, async () => {
      const res = await del(T_NEX, "token-owner", body);
      const json = await res.json();

      assert.equal(res.status, 400);
      assert.equal(json.success, false);
      assert.equal(json.code, "confirmation_mismatch");
      assert.equal(tenantById(T_NEX)!.status, "active");
      assert.equal(auditRows.length, 0);
    });
  }

  it("the other same-named workspace's slug does not confirm this one", async () => {
    const res = await del(T_NEX2, "token-owner", { confirmSlug: "nexflow" });

    assert.equal(res.status, 400);
    assert.equal(tenantById(T_NEX2)!.status, "active");
  });
});

describe("DELETE /api/tenants/:tenantId: deletion", () => {
  it("the owner with the right slug starts deprovisioning with the retention window", async () => {
    const res = await del(T_NEX2, "token-owner", { confirmSlug: "nexflow-2" });
    const json = await res.json();

    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.equal(json.data.status, "deprovisioning");
    assert.equal(json.data.retentionDays, 7);

    const tenant = tenantById(T_NEX2)!;

    assert.equal(tenant.status, "deprovisioning", "not purged, only scheduled");
    assert.ok(tenant.deprovision_at);

    const days = (tenant.deprovision_at!.getTime() - Date.now()) / 86_400_000;

    assert.ok(days > 6.9 && days <= 7, `retention ${days} days`);
    assert.equal(new Date(json.data.deprovisionAt).getTime(), tenant.deprovision_at!.getTime());
  });

  it("only the confirmed workspace is touched", async () => {
    await del(T_NEX2, "token-owner", { confirmSlug: "nexflow-2" });

    assert.equal(tenantById(T_NEX)!.status, "active");
    assert.equal(tenantById(T_OTHER)!.status, "active");
  });

  it("writes an audit line (log + tenant audit_logs) naming actor, tenant and slug", async () => {
    const lines: string[] = [];
    const original = console.log;

    console.log = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };

    try {
      await del(T_NEX, "token-owner", { confirmSlug: "nexflow" });
    } finally {
      console.log = original;
    }

    const audit = lines
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .find((l) => l?.audit === "workspace.delete_requested");

    assert.ok(audit, "no audit line was logged");
    assert.equal(audit.actorId, USER_OWNER);
    assert.equal(audit.tenantId, T_NEX);
    assert.equal(audit.slug, "nexflow");
    assert.equal(audit.retentionDays, 7);

    assert.equal(auditRows.length, 1);
    assert.equal(auditRows[0].schema, "tenant_nex");
    assert.equal(auditRows[0].actor, USER_OWNER);
    assert.equal(auditRows[0].metadata.tenantId, T_NEX);
  });

  it("a failing tenant audit_logs insert does not fail the deletion", async () => {
    failAuditInsert = true;

    const original = console.warn;
    console.warn = () => undefined;

    try {
      const res = await del(T_NEX, "token-owner", { confirmSlug: "nexflow" });

      assert.equal(res.status, 200);
      assert.equal(tenantById(T_NEX)!.status, "deprovisioning");
    } finally {
      console.warn = original;
    }
  });

  it("deleting twice: the second attempt is 404", async () => {
    assert.equal(
      (await del(T_NEX, "token-owner", { confirmSlug: "nexflow" })).status,
      200
    );
    assert.equal(
      (await del(T_NEX, "token-owner", { confirmSlug: "nexflow" })).status,
      404
    );
  });
});

describe("a deleted workspace is gone for the user", () => {
  it("disappears from the workspace list; the other same-named one stays", async () => {
    assert.deepEqual(
      (await list("token-owner")).map((t) => t.slug).sort(),
      ["nexflow", "nexflow-2"]
    );

    await del(T_NEX2, "token-owner", { confirmSlug: "nexflow-2" });

    assert.deepEqual(
      (await list("token-owner")).map((t) => t.slug),
      ["nexflow"]
    );
  });

  it("other accounts' lists are untouched", async () => {
    await del(T_NEX2, "token-owner", { confirmSlug: "nexflow-2" });

    assert.deepEqual(
      (await list("token-other")).map((t) => t.slug),
      ["someone-else"]
    );
  });

  it("/latest skips it", async () => {
    /* nexflow-2 is the newest; once deleted /latest falls back to nexflow. */
    assert.equal(
      (await (await call("GET", "/api/tenants/latest", "token-owner")).json()).data.slug,
      "nexflow-2"
    );

    await del(T_NEX2, "token-owner", { confirmSlug: "nexflow-2" });

    assert.equal(
      (await (await call("GET", "/api/tenants/latest", "token-owner")).json()).data.slug,
      "nexflow"
    );
  });

  it("every tenant route 404s for it, even for the owner", async () => {
    await del(T_NEX2, "token-owner", { confirmSlug: "nexflow-2" });

    for (const path of ["/usage", "/execution-tasks", "/stage2-plan/latest"]) {
      assert.equal(
        (await call("GET", `/api/tenants/${T_NEX2}${path}`, "token-owner")).status,
        404,
        path
      );
    }
  });

  it("does not count toward the plan's website limit, so a new workspace fits straight away", async () => {
    const { countTenantsOwnedByUser } = await import(
      "../../database/postgres/billing/billing-repository.js"
    );

    assert.equal(await countTenantsOwnedByUser(USER_OWNER), 2);

    await del(T_NEX2, "token-owner", { confirmSlug: "nexflow-2" });
    assert.equal(await countTenantsOwnedByUser(USER_OWNER), 1);

    await del(T_NEX, "token-owner", { confirmSlug: "nexflow" });
    assert.equal(await countTenantsOwnedByUser(USER_OWNER), 0);

    /* Free plan allows 1 website: 0 < 1, so POST /api/tenants would pass its gate. */
    assert.ok((await countTenantsOwnedByUser(USER_OWNER)) < 1);
  });
});

describe("deleting the user's LAST workspace", () => {
  it("is allowed, and leaves an empty list and no /latest (the web app then goes to onboarding)", async () => {
    assert.equal(
      (await del(T_NEX, "token-owner", { confirmSlug: "nexflow" })).status,
      200
    );
    assert.equal(
      (await del(T_NEX2, "token-owner", { confirmSlug: "nexflow-2" })).status,
      200
    );

    assert.deepEqual(await list("token-owner"), []);

    const latest = await call("GET", "/api/tenants/latest", "token-owner");

    assert.equal(latest.status, 404);
    assert.equal((await latest.json()).error, "No tenant found.");
  });

  it("the session keeps working with no workspace (GET /api/tenants is 200, not 401/403)", async () => {
    await del(T_NEX, "token-owner", { confirmSlug: "nexflow" });
    await del(T_NEX2, "token-owner", { confirmSlug: "nexflow-2" });

    const res = await call("GET", "/api/tenants", "token-owner");

    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).data, []);
  });
});
