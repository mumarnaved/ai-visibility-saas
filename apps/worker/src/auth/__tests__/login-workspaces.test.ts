import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

process.env.DATABASE_URL = "postgres://test:test@127.0.0.1:1/test";

const USER_ID = "11111111-1111-4111-8111-111111111111";

interface Row {
  workspace_id: string;
  workspace_name: string;
  workspace_slug: string;
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  website_url: string | null;
  schema_name: string;
  status: string;
  plan: string;
  created_at: number;
}

const row = (
  slug: string,
  status: string,
  created_at: number
): Row => ({
  workspace_id: `ws-${slug}`,
  workspace_name: slug,
  workspace_slug: slug,
  tenant_id: `tn-${slug}`,
  tenant_name: slug,
  tenant_slug: slug,
  website_url: `https://${slug}.example`,
  schema_name: `tenant_${slug}`,
  status,
  plan: "free",
  created_at,
});

let workspaces: Row[] = [];
let sessionsCreated = 0;
let passwordHash = "";

function fakeQuery(sql: string, params: unknown[] = []) {
  if (sql.includes("FROM platform.users")) {
    return Promise.resolve({
      rows: [
        {
          id: USER_ID,
          email: params[0],
          password_hash: passwordHash,
          full_name: "Umar",
          status: "active",
        },
      ],
    });
  }

  if (sql.includes("FROM platform.workspaces w")) {
    /* Applies the SQL's own rules: only 'active' tenants, oldest first. */
    assert.match(sql, /t\.status = 'active'/);
    assert.match(sql, /ORDER BY w\.created_at ASC/);

    const rows = workspaces
      .filter((w) => w.status === "active")
      .sort((a, b) => a.created_at - b.created_at);

    return Promise.resolve({ rows: rows.slice(0, 1) });
  }

  if (sql.includes("INSERT INTO platform.sessions")) {
    sessionsCreated += 1;
  }

  /* DELETE FROM platform.sessions, UPDATE platform.users */
  return Promise.resolve({ rows: [] });
}

let login: typeof import("../auth-service.js").login;

before(async () => {
  const { hashPassword } = await import("../password.js");
  passwordHash = await hashPassword("correct horse battery");

  const { pool } = await import("../../database/postgres/connection.js");
  (pool as unknown as { query: typeof fakeQuery }).query = fakeQuery;

  ({ login } = await import("../auth-service.js"));
});

const attempt = () =>
  login({
    email: "Mumarnaved2@gmail.com",
    password: "correct horse battery",
  });

describe("login picks a live workspace", () => {
  it("returns the oldest ACTIVE workspace, skipping deleted ones", async () => {
    workspaces = [
      row("old-deleted", "deprovisioning", 1),
      row("purged", "deprovisioned", 2),
      row("keeper", "active", 3),
      row("newer", "active", 4),
    ];

    const result = await attempt();

    assert.equal(result.tenant?.slug, "keeper");
    assert.equal(result.workspace?.slug, "keeper");
    assert.equal(result.user.id, USER_ID);
  });

  it("succeeds with a session but NO tenant or workspace once every workspace is deleted", async () => {
    workspaces = [
      row("a", "deprovisioning", 1),
      row("b", "deprovisioning", 2),
      row("c", "deprovisioned", 3),
    ];

    const before = sessionsCreated;
    const result = await attempt();

    assert.equal(result.tenant, null);
    assert.equal(result.workspace, null);
    assert.ok(result.session.sessionToken, "a usable session is still issued");
    assert.equal(sessionsCreated, before + 1);
    assert.equal(result.user.email, "mumarnaved2@gmail.com");
  });

  it("succeeds for an account with no workspace at all", async () => {
    workspaces = [];

    const result = await attempt();

    assert.equal(result.tenant, null);
    assert.equal(result.workspace, null);
    assert.ok(result.session.sessionToken);
  });

  it("a wrong password is still rejected", async () => {
    workspaces = [];

    await assert.rejects(
      login({ email: "mumarnaved2@gmail.com", password: "nope nope nope" }),
      /Invalid email or password/
    );
  });
});
