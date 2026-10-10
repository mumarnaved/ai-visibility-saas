import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildTenantManifest,
  manifestStorageKey,
  parseTenantManifest,
  TENANT_MANIFEST_FILENAME,
  TENANT_MANIFEST_VERSION,
} from "../../../context/tenant-manifest.js";
import {
  runTenantProvisioning,
  type ProvisioningFlowDeps,
} from "../provisioning-flow.js";
import {
  backfillTenantManifests,
  formatManifestSummary,
  manifestExitCode,
} from "../tenant-manifest-commands.js";
import {
  ensureTenantManifest,
  persistTenantManifest,
  readTenantManifest,
} from "../tenant-manifest-store.js";
import { FakePg, type TenantFixture } from "./fake-pg.js";

/*
 * connection.ts throws without DATABASE_URL and
 * the agent imports it. The pool is lazy and the
 * agent is given fake dependencies, so nothing
 * connects.
 */
process.env.DATABASE_URL ??=
  "postgres://test:test@127.0.0.1:1/test";

const { ProvisioningAgent } = await import(
  "../../../agents/provisioning/provisioning-agent.js"
);

const here = dirname(fileURLToPath(import.meta.url));

const NOW = new Date("2026-10-11T12:00:00.000Z");

const newId = () => randomUUID();

const schemaOf = (id: string) =>
  `tenant_${id.replaceAll("-", "")}`;

class MemoryStorage {
  files = new Map<string, string>();
  failWrites = false;

  async write(key: string, content: Buffer | string) {
    if (this.failWrites) {
      throw new Error("simulated storage failure");
    }

    this.files.set(key, String(content));
  }
}

const tenantRow = (
  status = "active",
  manifest?: unknown
): TenantFixture => {
  const id = newId();

  return {
    id,
    name: `Name ${id.slice(0, 4)}`,
    schema_name: schemaOf(id),
    status,
    manifest,
  };
};

/* ========================================
   THE HELPER
======================================== */

describe("tenant manifest helper", () => {
  const id = newId();

  it("records exactly the conventions in use", () => {
    const manifest = buildTenantManifest(
      { id, schemaName: schemaOf(id) },
      { now: NOW }
    );

    assert.deepEqual(manifest, {
      manifestVersion: TENANT_MANIFEST_VERSION,
      tenantId: id,
      schemaName: schemaOf(id),
      storagePrefix: `tenant-${id}`,
      credentialNamespace: `credentials/tenant-${id}`,
      vectorNamespace: `vector-tenant-${id}`,
      createdAt: "2026-10-11T12:00:00.000Z",
    });
  });

  it("matches the prefixes the rest of the code builds", async () => {
    /*
     * Guards against drift: if one of the
     * existing copies of the convention changes,
     * this fails until the manifest agrees.
     */
    const read = (path: string) =>
      readFile(resolve(here, path), "utf8");

    const [server, scan, deprovision] =
      await Promise.all([
        read("../../../api/server.ts"),
        read("../../../services/automatic-scan.ts"),
        read("../tenant-deprovisioning.ts"),
      ]);

    for (const [name, source] of [
      ["server.ts", server],
      ["automatic-scan.ts", scan],
    ] as const) {
      for (const literal of [
        "`tenant-${tenantId}`",
        "`credentials/tenant-${tenantId}`",
        "`vector-tenant-${tenantId}`",
      ]) {
        assert.ok(
          source.includes(literal),
          `${name} no longer builds ${literal}`
        );
      }
    }

    assert.ok(
      deprovision.includes("`tenant-${tenantId}`"),
      "tenant-deprovisioning.ts no longer uses the tenant-<id> storage prefix"
    );
  });

  it("stores the copy at <prefix>/tenant_manifest.json", () => {
    assert.equal(TENANT_MANIFEST_FILENAME, "tenant_manifest.json");

    assert.equal(
      manifestStorageKey(
        buildTenantManifest({ id, schemaName: schemaOf(id) })
      ),
      `tenant-${id}/tenant_manifest.json`
    );
  });

  it("validates on read: rejects unknown keys, wrong version and bad values", () => {
    const good = buildTenantManifest({
      id,
      schemaName: schemaOf(id),
    });

    assert.deepEqual(parseTenantManifest(good), good);

    const bad: Record<string, unknown>[] = [
      { ...good, extra: 1 },
      { ...good, manifestVersion: 2 },
      { ...good, createdAt: "yesterday" },
      { ...good, schemaName: "bad schema; DROP" },
      { ...good, tenantId: "../other" },
      { ...good, storagePrefix: "" },
    ];

    for (const value of bad) {
      assert.throws(() => parseTenantManifest(value));
    }

    assert.throws(() => parseTenantManifest(null));
    assert.throws(() => parseTenantManifest("{}"));
  });

  it("rejects a manifest that points at another tenant's namespaces", () => {
    const good = buildTenantManifest({
      id,
      schemaName: schemaOf(id),
    });

    for (const key of [
      "storagePrefix",
      "credentialNamespace",
      "vectorNamespace",
    ] as const) {
      assert.throws(
        () =>
          parseTenantManifest({
            ...good,
            [key]: good[key].replace(id, newId()),
          }),
        new RegExp(key)
      );
    }
  });
});

/* ========================================
   THE STORE
======================================== */

describe("tenant manifest store", () => {
  it("persists once and never overwrites", async () => {
    const row = tenantRow("active");
    const fake = new FakePg({ tenants: [row] });

    const first = buildTenantManifest(
      { id: row.id, schemaName: row.schema_name },
      { now: NOW }
    );

    const second = buildTenantManifest(
      { id: row.id, schemaName: row.schema_name },
      { now: new Date("2030-01-01T00:00:00Z") }
    );

    assert.equal(await persistTenantManifest(fake, first), true);
    assert.equal(await persistTenantManifest(fake, second), false);
    assert.deepEqual(fake.tenant(row.id)?.manifest, first);
  });

  it("reads null when absent, validates when present, throws for an unknown tenant", async () => {
    const none = tenantRow("active");
    const broken = tenantRow("active", { nonsense: true });
    const ok = tenantRow("active");

    ok.manifest = buildTenantManifest({
      id: ok.id,
      schemaName: ok.schema_name,
    });

    const fake = new FakePg({ tenants: [none, broken, ok] });

    assert.equal(await readTenantManifest(fake, none.id), null);
    assert.deepEqual(
      await readTenantManifest(fake, ok.id),
      ok.manifest
    );
    await assert.rejects(() => readTenantManifest(fake, broken.id));
    await assert.rejects(
      () => readTenantManifest(fake, newId()),
      /does not exist/
    );
  });

  it("ensure: writes the database copy first, then the storage copy", async () => {
    const row = tenantRow("provisioning");
    const fake = new FakePg({ tenants: [row] });
    const storage = new MemoryStorage();

    const manifest = buildTenantManifest({
      id: row.id,
      schemaName: row.schema_name,
    });

    const stored = await ensureTenantManifest(fake, storage, manifest);

    assert.deepEqual(stored, manifest);
    assert.deepEqual(fake.tenant(row.id)?.manifest, manifest);
    assert.deepEqual(
      JSON.parse(
        storage.files.get(`tenant-${row.id}/tenant_manifest.json`)!
      ),
      manifest
    );
  });

  it("ensure: a failed storage copy is a warning, the database copy stands", async () => {
    const row = tenantRow("provisioning");
    const fake = new FakePg({ tenants: [row] });
    const storage = new MemoryStorage();
    storage.failWrites = true;

    const warnings: string[] = [];

    const manifest = buildTenantManifest({
      id: row.id,
      schemaName: row.schema_name,
    });

    const stored = await ensureTenantManifest(
      fake,
      storage,
      manifest,
      (m) => warnings.push(m)
    );

    assert.deepEqual(stored, manifest);
    assert.deepEqual(fake.tenant(row.id)?.manifest, manifest);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /storage copy failed/);
  });

  it("ensure: a failed database write is fatal and writes no storage copy", async () => {
    const row = tenantRow("provisioning");
    const fake = new FakePg({
      tenants: [row],
      failManifestWrites: true,
    });
    const storage = new MemoryStorage();

    await assert.rejects(
      () =>
        ensureTenantManifest(
          fake,
          storage,
          buildTenantManifest({
            id: row.id,
            schemaName: row.schema_name,
          })
        ),
      /simulated manifest write failure/
    );

    assert.equal(storage.files.size, 0);
  });

  it("ensure: keeps and returns an existing manifest", async () => {
    const row = tenantRow("active");
    const original = buildTenantManifest(
      { id: row.id, schemaName: row.schema_name },
      { now: NOW }
    );
    row.manifest = original;

    const fake = new FakePg({ tenants: [row] });
    const storage = new MemoryStorage();

    const stored = await ensureTenantManifest(
      fake,
      storage,
      buildTenantManifest({
        id: row.id,
        schemaName: row.schema_name,
      })
    );

    assert.deepEqual(stored, original);
    assert.deepEqual(fake.tenant(row.id)?.manifest, original);
  });
});

/* ========================================
   PROVISIONING
======================================== */

function flowDeps(
  fake: FakePg,
  storage: MemoryStorage,
  options: { schemaFails?: boolean } = {}
) {
  const calls: string[] = [];
  const statuses: string[] = [];

  const setStatus = async (id: string, status: string) => {
    statuses.push(status);
    await fake.query(
      `UPDATE platform.tenants SET status = '${status}' WHERE id = $1`,
      [id]
    );
  };

  const deps: ProvisioningFlowDeps = {
    async createTenantRecord(name, slug, websiteUrl) {
      const id = newId();
      const schemaName = schemaOf(id);

      fake.addTenant({
        id,
        name,
        schema_name: schemaName,
        status: "provisioning",
      });

      return {
        id,
        slug,
        name,
        websiteUrl,
        schemaName,
        status: "provisioning",
        plan: "starter",
        verificationToken: null,
        domainVerifiedAt: null,
      };
    },

    async provisionTenantSchema() {
      calls.push("schema");

      if (options.schemaFails) {
        throw new Error("schema boom");
      }
    },

    async persistManifest(tenant) {
      calls.push("manifest");

      return ensureTenantManifest(
        fake,
        storage,
        buildTenantManifest({
          id: tenant.id,
          schemaName: tenant.schemaName,
        }),
        () => undefined
      );
    },

    activateTenant: (id) => setStatus(id, "active"),
    failTenant: (id) => setStatus(id, "failed"),
  };

  return { deps, calls, statuses };
}

const request = {
  name: "Acme",
  slug: "acme",
  websiteUrl: "https://acme.test",
};

describe("tenant provisioning with a manifest", () => {
  it("a new tenant gets its manifest, in the database and in storage, then goes active", async () => {
    const fake = new FakePg();
    const storage = new MemoryStorage();
    const { deps, calls, statuses } = flowDeps(fake, storage);

    const tenant = await runTenantProvisioning(deps, request);

    assert.equal(tenant.status, "active");
    assert.deepEqual(calls, ["schema", "manifest"]);
    assert.deepEqual(statuses, ["active"]);

    assert.equal(tenant.manifest.tenantId, tenant.id);
    assert.equal(tenant.manifest.schemaName, tenant.schemaName);
    assert.equal(tenant.manifest.storagePrefix, `tenant-${tenant.id}`);
    assert.equal(
      tenant.manifest.credentialNamespace,
      `credentials/tenant-${tenant.id}`
    );
    assert.equal(
      tenant.manifest.vectorNamespace,
      `vector-tenant-${tenant.id}`
    );

    assert.deepEqual(fake.tenant(tenant.id)?.manifest, tenant.manifest);
    assert.equal(fake.tenant(tenant.id)?.status, "active");
    assert.ok(
      storage.files.has(`tenant-${tenant.id}/tenant_manifest.json`)
    );
  });

  it("keeps the existing TenantRecord fields on the result", async () => {
    const fake = new FakePg();
    const { deps } = flowDeps(fake, new MemoryStorage());

    const tenant = await runTenantProvisioning(deps, request);

    for (const key of [
      "id",
      "slug",
      "name",
      "websiteUrl",
      "schemaName",
      "status",
      "plan",
      "verificationToken",
      "domainVerifiedAt",
    ]) {
      assert.ok(key in tenant, `missing ${key}`);
    }
  });

  it("a failed manifest write leaves the tenant failed, never active", async () => {
    const fake = new FakePg({ failManifestWrites: true });
    const storage = new MemoryStorage();
    const { deps, statuses } = flowDeps(fake, storage);

    await assert.rejects(
      () => runTenantProvisioning(deps, request),
      /simulated manifest write failure/
    );

    assert.deepEqual(statuses, ["failed"]);

    const [row] = fake.tenantRows();
    assert.equal(row.status, "failed");
    assert.equal(row.manifest ?? null, null);
    assert.equal(storage.files.size, 0);
  });

  it("a failed storage copy does not block activation", async () => {
    const fake = new FakePg();
    const storage = new MemoryStorage();
    storage.failWrites = true;
    const { deps } = flowDeps(fake, storage);

    const tenant = await runTenantProvisioning(deps, request);

    assert.equal(fake.tenant(tenant.id)?.status, "active");
    assert.deepEqual(fake.tenant(tenant.id)?.manifest, tenant.manifest);
  });

  it("a schema failure marks the tenant failed and writes no manifest", async () => {
    const fake = new FakePg();
    const { deps, calls, statuses } = flowDeps(
      fake,
      new MemoryStorage(),
      { schemaFails: true }
    );

    await assert.rejects(
      () => runTenantProvisioning(deps, request),
      /schema boom/
    );

    assert.deepEqual(calls, ["schema"]);
    assert.deepEqual(statuses, ["failed"]);
    assert.equal(fake.tenantRows()[0].manifest ?? null, null);
  });

  it("still reports the original error if marking the tenant failed also fails", async () => {
    const fake = new FakePg({ failManifestWrites: true });
    const { deps } = flowDeps(fake, new MemoryStorage());

    deps.failTenant = async () => {
      throw new Error("db down");
    };

    await assert.rejects(
      () => runTenantProvisioning(deps, request),
      /simulated manifest write failure/
    );
  });
});

/* ========================================
   PROVISIONING AGENT
======================================== */

describe("ProvisioningAgent", () => {
  const id = newId();

  const context = (overrides: Record<string, string> = {}) => ({
    tenantId: id,
    schema: schemaOf(id),
    storagePrefix: `tenant-${id}`,
    credentialNamespace: `credentials/tenant-${id}`,
    vectorNamespace: `vector-tenant-${id}`,
    ...overrides,
  });

  const input = (tenantContext: unknown) =>
    ({
      tenantContext,
      payload: { tenantId: id, tenantName: "Acme", slug: "acme" },
    }) as never;

  it("provisions, persists the manifest after the schema, and returns it", async () => {
    const calls: string[] = [];

    const agent = new ProvisioningAgent({
      provisionSchema: async () => {
        calls.push("schema");
      },
      persistManifest: async (manifest) => {
        calls.push("manifest");
        return manifest;
      },
    });

    const result = await agent.execute(input(context()));

    assert.equal(result.success, true);
    assert.deepEqual(calls, ["schema", "manifest"]);

    const data = result.data;
    assert.ok(data);

    assert.equal(data.tenantId, id);
    assert.equal(data.schemaName, schemaOf(id));
    assert.equal(data.storagePrefix, `tenant-${id}`);
    assert.equal(data.manifest.tenantId, id);
    assert.equal(data.manifest.vectorNamespace, `vector-tenant-${id}`);
  });

  it("fails (and does not provision) when the context disagrees with the convention", async () => {
    const calls: string[] = [];

    const agent = new ProvisioningAgent({
      provisionSchema: async () => {
        calls.push("schema");
      },
      persistManifest: async (m) => m,
    });

    const result = await agent.execute(
      input(context({ storagePrefix: `tenants/${id}` }))
    );

    assert.equal(result.success, false);
    assert.deepEqual(calls, []);
  });

  it("fails when the manifest cannot be persisted", async () => {
    const agent = new ProvisioningAgent({
      provisionSchema: async () => undefined,
      persistManifest: async () => {
        throw new Error("manifest boom");
      },
    });

    const result = await agent.execute(input(context()));

    assert.equal(result.success, false);

    assert.match(String(result.error), /manifest boom/);
  });
});

/* ========================================
   BACKFILL
======================================== */

function roster() {
  const needs1 = tenantRow("active");
  const needs2 = tenantRow("active");
  const needs3 = tenantRow("active");
  const has = tenantRow("active");
  has.manifest = buildTenantManifest(
    { id: has.id, schemaName: has.schema_name },
    { now: new Date("2026-01-01T00:00:00Z") }
  );
  const provisioning = tenantRow("provisioning");
  const suspended = tenantRow("suspended");

  return { needs1, needs2, needs3, has, provisioning, suspended };
}

const rosterRows = (r: ReturnType<typeof roster>) => [
  r.needs1,
  r.has,
  r.provisioning,
  r.needs2,
  r.suspended,
  r.needs3,
];

describe("tenant manifest backfill", () => {
  it("writes manifests for active tenants without one; skips the rest", async () => {
    const r = roster();
    const fake = new FakePg({ tenants: rosterRows(r) });
    const storage = new MemoryStorage();
    const hadBefore = structuredClone(r.has.manifest);

    const summary = await backfillTenantManifests(fake, storage, {
      dryRun: false,
      now: NOW,
    });

    assert.deepEqual(
      summary.succeeded.map((o) => o.tenant.id),
      [r.needs1.id, r.needs2.id, r.needs3.id]
    );
    assert.deepEqual(
      summary.skipped.map((o) => o.tenant.id).sort(),
      [r.has.id, r.provisioning.id, r.suspended.id].sort()
    );
    assert.deepEqual(summary.failed, []);
    assert.equal(manifestExitCode(summary), 0);

    for (const t of [r.needs1, r.needs2, r.needs3]) {
      assert.deepEqual(
        fake.tenant(t.id)?.manifest,
        buildTenantManifest(
          { id: t.id, schemaName: t.schema_name },
          { now: NOW }
        )
      );
      assert.ok(
        storage.files.has(`tenant-${t.id}/tenant_manifest.json`)
      );
    }

    /* the one that had a manifest is untouched; non-active get none */
    assert.deepEqual(fake.tenant(r.has.id)?.manifest, hadBefore);
    assert.equal(fake.tenant(r.provisioning.id)?.manifest ?? null, null);
    assert.equal(fake.tenant(r.suspended.id)?.manifest ?? null, null);
    assert.equal(storage.files.size, 3);
  });

  it("writes only the manifest column", async () => {
    const r = roster();
    const fake = new FakePg({ tenants: rosterRows(r) });
    const before = fake.tenantRows();

    await backfillTenantManifests(fake, new MemoryStorage(), {
      dryRun: false,
      now: NOW,
    });

    for (const statement of fake.writes()) {
      assert.match(
        statement,
        /^UPDATE platform\.tenants\s+SET manifest = /,
        statement
      );
    }

    for (const after of fake.tenantRows()) {
      const was = before.find((b) => b.id === after.id)!;
      const { manifest: _a, ...restAfter } = after;
      const { manifest: _b, ...restBefore } = was;
      assert.deepEqual(restAfter, restBefore);
    }
  });

  it("--dry-run writes nothing, to the database or to storage", async () => {
    const r = roster();
    const fake = new FakePg({ tenants: rosterRows(r) });
    const storage = new MemoryStorage();
    const before = fake.tenantRows();

    const summary = await backfillTenantManifests(fake, storage, {
      dryRun: true,
      now: NOW,
    });

    assert.equal(summary.dryRun, true);
    assert.equal(summary.succeeded.length, 3);
    assert.deepEqual(fake.tenantRows(), before);
    assert.deepEqual(fake.writes(), []);
    assert.equal(storage.files.size, 0);
    assert.match(
      formatManifestSummary(summary),
      /Dry run complete \(nothing was changed\): 3 succeeded, 0 failed, 3 skipped/
    );
  });

  it("re-running is a no-op", async () => {
    const r = roster();
    const fake = new FakePg({ tenants: rosterRows(r) });
    const storage = new MemoryStorage();

    await backfillTenantManifests(fake, storage, {
      dryRun: false,
      now: NOW,
    });

    const after = fake.tenantRows();
    const writes = fake.writes().length;
    const files = storage.files.size;

    const again = await backfillTenantManifests(fake, storage, {
      dryRun: false,
      now: new Date("2031-01-01T00:00:00Z"),
    });

    assert.equal(again.succeeded.length, 0);
    assert.equal(again.failed.length, 0);
    assert.equal(again.skipped.length, 6);
    assert.deepEqual(fake.tenantRows(), after);
    assert.equal(fake.writes().length, writes);
    assert.equal(storage.files.size, files);
  });

  it("continues past a failure, reports it, and exits non-zero", async () => {
    const r = roster();
    const fake = new FakePg({
      tenants: rosterRows(r),
      failManifestWrites: [r.needs2.id],
    });
    const storage = new MemoryStorage();

    const summary = await backfillTenantManifests(fake, storage, {
      dryRun: false,
      now: NOW,
    });

    assert.deepEqual(
      summary.failed.map((o) => o.tenant.id),
      [r.needs2.id]
    );
    assert.deepEqual(
      summary.succeeded.map((o) => o.tenant.id),
      [r.needs1.id, r.needs3.id]
    );
    assert.equal(manifestExitCode(summary), 1);
    assert.equal(fake.tenant(r.needs2.id)?.manifest ?? null, null);
    assert.ok(
      !storage.files.has(`tenant-${r.needs2.id}/tenant_manifest.json`)
    );
    assert.match(
      formatManifestSummary(summary),
      /2 succeeded, 1 failed, 3 skipped/
    );
  });

  it("an invalid existing manifest is a failure and is never overwritten", async () => {
    const bad = tenantRow("active", { junk: true });
    const wrongTenant = tenantRow("active");
    wrongTenant.manifest = buildTenantManifest({
      id: bad.id,
      schemaName: schemaOf(bad.id),
    });

    const fake = new FakePg({ tenants: [bad, wrongTenant] });
    const before = fake.tenantRows();

    const summary = await backfillTenantManifests(fake, new MemoryStorage(), {
      dryRun: false,
      now: NOW,
    });

    assert.equal(summary.failed.length, 2);
    assert.equal(summary.succeeded.length, 0);
    assert.equal(manifestExitCode(summary), 1);
    assert.deepEqual(fake.tenantRows(), before);
    assert.deepEqual(fake.writes(), []);
  });

  it("a failed storage copy is reported but the database manifest stands", async () => {
    const r = roster();
    const fake = new FakePg({ tenants: rosterRows(r) });
    const storage = new MemoryStorage();
    storage.failWrites = true;
    const lines: string[] = [];

    const summary = await backfillTenantManifests(fake, storage, {
      dryRun: false,
      now: NOW,
      log: (l) => lines.push(l),
    });

    assert.equal(summary.succeeded.length, 3);
    assert.ok(summary.succeeded.every((o) => o.storageCopy === "failed"));
    assert.equal(manifestExitCode(summary), 0);
    assert.ok(fake.tenant(r.needs1.id)?.manifest);
    assert.ok(lines.some((l) => l.startsWith("WARN")));
    assert.match(
      formatManifestSummary(summary),
      /3 storage copies failed/
    );
  });

  it("explains when migration 009 has not been applied", async () => {
    const fake = new FakePg({
      tenants: [tenantRow()],
      noManifestColumn: true,
    });

    await assert.rejects(
      () =>
        backfillTenantManifests(fake, new MemoryStorage(), {
          dryRun: true,
        }),
      /migration 009/
    );
  });
});
