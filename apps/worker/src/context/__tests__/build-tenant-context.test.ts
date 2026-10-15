import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  TenantNotUsableError,
  buildTenantContextWith,
  createTenantDb,
  createTenantStorage,
  type BuildTenantContextDeps,
  type TenantRow,
} from "../build-tenant-context.js";
import { tenantNamespaces } from "../tenant-manifest.js";

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const row = (overrides: Partial<TenantRow> = {}): TenantRow => ({
  id: ID,
  name: "nexflow",
  slug: "nexflow",
  website_url: "https://nexflow.example",
  schema_name: "tenant_aaaa",
  status: "active",
  plan: "starter",
  ...overrides,
});

function fakePool() {
  const statements: string[] = [];
  const params: unknown[][] = [];
  let released = 0;
  let failOn: RegExp | null = null;

  const client = {
    async query(sql: string, p?: unknown[]) {
      statements.push(sql);
      params.push(p ?? []);

      if (failOn?.test(sql)) {
        throw new Error("boom");
      }

      return { rows: [{ ok: 1 }] };
    },
    release() {
      released += 1;
    },
  };

  return {
    statements,
    params,
    get released() {
      return released;
    },
    failOn(pattern: RegExp) {
      failOn = pattern;
    },
    pool: {
      query: client.query,
      connect: async () => client,
    },
  };
}

function setup(tenant: TenantRow | null) {
  const pool = fakePool();
  const storageCalls: string[] = [];
  const planCalls: Array<[string, string | null]> = [];

  const deps: BuildTenantContextDeps = {
    loadTenant: async () => tenant,
    pool: pool.pool,
    rawStorage: {
      write: async (key) => {
        storageCalls.push(`write:${key}`);
      },
      read: async (key) => {
        storageCalls.push(`read:${key}`);

        return Buffer.from("x");
      },
      delete: async (key) => {
        storageCalls.push(`delete:${key}`);
      },
      list: async (prefix) => {
        storageCalls.push(`list:${prefix}`);

        return [`${prefix}/a.json`, `${prefix}/b/c.json`];
      },
    },
    providers: {
      firecrawl: { scrape: async () => "scraped" },
      serpapi: { siteIndexSignals: async () => "signals" },
      openrouter: { run: async () => "answer" },
    },
    loadPlan: async (tenantId, userId) => {
      planCalls.push([tenantId, userId]);

      return { planTier: "free", status: "active", websiteLimit: 1 };
    },
  };

  return { deps, pool, storageCalls, planCalls };
}

describe("buildTenantContext: the tenant must be usable", () => {
  it("builds a context for an active tenant", async () => {
    const { deps, planCalls } = setup(row());

    const ctx = await buildTenantContextWith(deps, ID, "user-1");

    assert.equal(ctx.tenantId, ID);
    assert.equal(ctx.schema, "tenant_aaaa");
    assert.equal(ctx.userId, "user-1");
    assert.equal(ctx.tenant.slug, "nexflow");
    assert.deepEqual(ctx.plan, {
      planTier: "free",
      status: "active",
      websiteLimit: 1,
    });
    assert.deepEqual(planCalls, [[ID, "user-1"]]);
  });

  it("userId is optional", async () => {
    const { deps } = setup(row());

    assert.equal((await buildTenantContextWith(deps, ID)).userId, null);
  });

  it("takes every naming convention from tenantNamespaces (one source of truth)", async () => {
    const { deps } = setup(row());
    const ctx = await buildTenantContextWith(deps, ID);
    const ns = tenantNamespaces(ID);

    assert.equal(ctx.storagePrefix, ns.storagePrefix);
    assert.equal(ctx.credentialNamespace, ns.credentialNamespace);
    assert.equal(ctx.vectorNamespace, ns.vectorNamespace);
  });

  it("rejects an unknown tenant", async () => {
    await assert.rejects(
      buildTenantContextWith(setup(null).deps, ID),
      (error: unknown) =>
        error instanceof TenantNotUsableError &&
        error.reason === "not_found" &&
        /not found/i.test(error.message)
    );
  });

  it("rejects failed, provisioning and suspended tenants", async () => {
    for (const status of ["failed", "provisioning", "suspended"]) {
      await assert.rejects(
        buildTenantContextWith(setup(row({ status })).deps, ID),
        (error: unknown) =>
          error instanceof TenantNotUsableError &&
          error.reason === "not_active" &&
          error.status === status,
        status
      );
    }
  });

  it("rejects deleted tenants (deprovisioning, deprovisioned) as a deleted workspace", async () => {
    for (const status of ["deprovisioning", "deprovisioned"]) {
      await assert.rejects(
        buildTenantContextWith(setup(row({ status })).deps, ID),
        (error: unknown) =>
          error instanceof TenantNotUsableError &&
          /Workspace was deleted/.test(error.message),
        status
      );
    }
  });

  it("does no work for an unusable tenant (no plan lookup, no connection)", async () => {
    const { deps, planCalls, pool } = setup(row({ status: "failed" }));

    await assert.rejects(buildTenantContextWith(deps, ID));

    assert.deepEqual(planCalls, []);
    assert.deepEqual(pool.statements, []);
  });
});

describe("tenant-scoped db", () => {
  it('runs each query in its own transaction with search_path "<tenant>", extensions, public', async () => {
    const { deps, pool } = setup(row());
    const ctx = await buildTenantContextWith(deps, ID);

    const result = await ctx.db.query("SELECT 1 FROM audit_reports WHERE id = $1", ["x"]);

    assert.deepEqual(result.rows, [{ ok: 1 }]);
    assert.deepEqual(pool.statements, [
      "BEGIN",
      'SET LOCAL search_path TO "tenant_aaaa", extensions, public',
      "SELECT 1 FROM audit_reports WHERE id = $1",
      "COMMIT",
    ]);
    assert.deepEqual(pool.params[2], ["x"]);
    assert.equal(pool.released, 1);
  });

  it("rolls back and releases the connection when the query fails", async () => {
    const { deps, pool } = setup(row());
    const ctx = await buildTenantContextWith(deps, ID);

    pool.failOn(/audit_reports/);

    await assert.rejects(ctx.db.query("SELECT * FROM audit_reports"), /boom/);

    assert.equal(pool.statements.at(-1), "ROLLBACK");
    assert.ok(!pool.statements.includes("COMMIT"));
    assert.equal(pool.released, 1);
  });

  it("refuses a schema name that is not a plain identifier", () => {
    const { pool } = fakePool();

    for (const bad of ['x"; DROP SCHEMA platform; --', "a b", "", "1abc"]) {
      assert.throws(() => createTenantDb(pool, bad), /Invalid PostgreSQL identifier/);
    }
  });
});

describe("tenant-scoped storage", () => {
  it("confines every key to the tenant's prefix", async () => {
    const { deps, storageCalls } = setup(row());
    const ctx = await buildTenantContextWith(deps, ID);

    await ctx.storage.write("reports/a.json", "{}");
    await ctx.storage.read("reports/a.json");
    await ctx.storage.delete("reports/a.json");

    assert.deepEqual(storageCalls, [
      `write:tenant-${ID}/reports/a.json`,
      `read:tenant-${ID}/reports/a.json`,
      `delete:tenant-${ID}/reports/a.json`,
    ]);
  });

  it("lists relative to the prefix", async () => {
    const { deps } = setup(row());
    const ctx = await buildTenantContextWith(deps, ID);

    assert.deepEqual(await ctx.storage.list(), ["a.json", "b/c.json"]);
  });

  it("refuses keys that could leave the prefix", async () => {
    const { deps } = setup(row());
    const storage = createTenantStorage(deps.rawStorage, `tenant-${ID}`);

    for (const bad of ["../tenant-other/x", "a/../../b", "/etc/passwd", "", "a\\..\\b"]) {
      await assert.rejects(
        storage.write(bad, "x"),
        /Invalid storage key/,
        JSON.stringify(bad)
      );
    }
  });
});

describe("providers", () => {
  it("exposes the (metered) provider clients", async () => {
    const { deps } = setup(row());
    const ctx = await buildTenantContextWith(deps, ID);

    assert.equal(await ctx.providers.firecrawl.scrape("https://x"), "scraped");
    assert.equal(await ctx.providers.serpapi.siteIndexSignals("x.com"), "signals");
    assert.equal(await ctx.providers.openrouter.run("q"), "answer");
  });
});
