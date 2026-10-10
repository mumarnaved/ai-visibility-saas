import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  formatTenantSummary,
  migrateAllTenants,
  migratePlatform,
  parseDryRunFlag,
  tenantExitCode,
} from "../migration-commands.js";
import {
  loadMigrationFiles,
  type MigrationFile,
} from "../migration-runner.js";
import { FakePg, type TenantFixture } from "./fake-pg.js";

const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../.."
);

const platformFiles = await loadMigrationFiles(
  resolve(repoRoot, "database/platform/migrations")
);

const tenantFiles = await loadMigrationFiles(
  resolve(
    repoRoot,
    "database/tenant-template/migrations"
  )
);

const files: MigrationFile[] = [
  {
    version: "001_a",
    sql: "CREATE TABLE IF NOT EXISTS a (id int);",
  },
  {
    version: "002_b",
    sql: "CREATE TABLE IF NOT EXISTS b (id int);",
  },
];

const tenant = (
  schema: string,
  status: string
): TenantFixture => ({
  id: `id-${schema}`,
  name: `Name ${schema}`,
  schema_name: schema,
  status,
});

const roster = [
  tenant("t_active_1", "active"),
  tenant("t_active_2", "active"),
  tenant("t_provisioning", "provisioning"),
  tenant("t_failed", "failed"),
  tenant("t_deprovisioning", "deprovisioning"),
  tenant("t_deprovisioned", "deprovisioned"),
  tenant("t_suspended", "suspended"),
  tenant("t_active_3", "active"),
];

const schemasOf = (outcomes: { tenant: TenantFixture }[]) =>
  outcomes.map((o) => o.tenant.schema_name);

describe("migrateAllTenants", () => {
  it("migrates only active tenants and lists the rest as skipped", async () => {
    const fake = new FakePg({ tenants: roster });

    const summary = await migrateAllTenants(fake, {
      files,
      dryRun: false,
    });

    assert.deepEqual(schemasOf(summary.succeeded), [
      "t_active_1",
      "t_active_2",
      "t_active_3",
    ]);
    assert.deepEqual(schemasOf(summary.skipped), [
      "t_provisioning",
      "t_failed",
      "t_deprovisioning",
      "t_deprovisioned",
      "t_suspended",
    ]);
    assert.deepEqual(summary.failed, []);
    assert.equal(tenantExitCode(summary), 0);

    for (const name of [
      "t_provisioning",
      "t_failed",
      "t_deprovisioning",
      "t_deprovisioned",
      "t_suspended",
    ]) {
      assert.ok(
        !fake.state.schemas.has(name),
        `${name} must not be touched`
      );
    }

    for (const name of [
      "t_active_1",
      "t_active_2",
      "t_active_3",
    ]) {
      assert.deepEqual(fake.state.versions.get(name), [
        "001_a",
        "002_b",
      ]);
    }
  });

  it("keeps going after a tenant fails, then reports it and exits non-zero", async () => {
    const fake = new FakePg({
      tenants: roster,
      failSchemas: ["t_active_2"],
    });

    const summary = await migrateAllTenants(fake, {
      files,
      dryRun: false,
    });

    assert.deepEqual(schemasOf(summary.succeeded), [
      "t_active_1",
      "t_active_3",
    ]);
    assert.deepEqual(schemasOf(summary.failed), [
      "t_active_2",
    ]);
    assert.match(
      summary.failed[0].error ?? "",
      /001_a.*t_active_2.*rolled back/
    );
    assert.equal(summary.skipped.length, 5);
    assert.equal(tenantExitCode(summary), 1);

    /* t_active_3 comes after the failure and was still migrated. */
    assert.deepEqual(
      fake.state.versions.get("t_active_3"),
      ["001_a", "002_b"]
    );
    assert.deepEqual(
      fake.state.versions.get("t_active_2") ?? [],
      []
    );

    const text = formatTenantSummary(summary);
    assert.match(text, /2 succeeded, 1 failed, 5 skipped/);
    assert.match(text, /failed:\s+t_active_2/);
    assert.match(text, /skipped: t_suspended \(suspended\)/);
  });

  it("processes tenants one at a time, in order", async () => {
    const fake = new FakePg({ tenants: roster });

    await migrateAllTenants(fake, {
      files,
      dryRun: false,
    });

    assert.deepEqual(
      fake.ranOn.filter(
        (path, i) => path !== fake.ranOn[i - 1]
      ),
      ["t_active_1", "t_active_2", "t_active_3"]
    );
  });

  it("--dry-run reports baseline/run per tenant and changes nothing", async () => {
    /* Real files: baselining is keyed on real version names. */
    const fake = new FakePg({ tenants: roster });
    fake.seedLegacy("t_active_1", "tenant", tenantFiles);
    fake.seedLegacy(
      "t_active_2",
      "tenant",
      tenantFiles.slice(0, 1)
    );

    const before = fake.snapshot();
    const lines: string[] = [];

    const summary = await migrateAllTenants(fake, {
      files: tenantFiles,
      dryRun: true,
      log: (line) => lines.push(line),
    });

    assert.deepEqual(fake.state, before);
    assert.deepEqual(fake.writes(), []);
    assert.equal(fake.ran.length, 0);

    assert.equal(summary.dryRun, true);
    assert.equal(summary.failed.length, 0);
    assert.equal(summary.skipped.length, 5);

    const byName = Object.fromEntries(
      summary.succeeded.map((o) => [
        o.tenant.schema_name,
        o.plan,
      ])
    );

    assert.deepEqual(
      byName.t_active_1?.toBaseline,
      tenantFiles.map((f) => f.version)
    );
    assert.deepEqual(byName.t_active_1?.toRun, []);
    assert.deepEqual(byName.t_active_2?.toBaseline, [
      "001_create_tenant_core",
    ]);
    assert.deepEqual(byName.t_active_2?.toRun, [
      "002_add_vector_namespace",
      "003_add_reports",
    ]);
    assert.deepEqual(byName.t_active_3?.toBaseline, []);
    assert.deepEqual(
      byName.t_active_3?.toRun,
      tenantFiles.map((f) => f.version)
    );

    assert.ok(
      lines.some((l) =>
        /DRY-RUN .*t_active_2.*baseline \[001_create_tenant_core\], run \[002_add_vector_namespace, 003_add_reports\]/.test(
          l
        )
      )
    );
  });

  it("a second real run is a no-op for every tenant", async () => {
    const fake = new FakePg({ tenants: roster });

    await migrateAllTenants(fake, {
      files,
      dryRun: false,
    });

    const ran = fake.ran.length;

    const again = await migrateAllTenants(fake, {
      files,
      dryRun: false,
    });

    assert.equal(fake.ran.length, ran);
    assert.equal(again.succeeded.length, 3);

    for (const outcome of again.succeeded) {
      assert.deepEqual(outcome.result?.applied, []);
    }
  });
});

describe("parseDryRunFlag", () => {
  it("accepts no args and --dry-run only", () => {
    assert.equal(parseDryRunFlag([]), false);
    assert.equal(parseDryRunFlag(["--dry-run"]), true);
    assert.throws(
      () => parseDryRunFlag(["--dryrun"]),
      /Unknown argument/
    );
    assert.throws(
      () => parseDryRunFlag(["--dry-run", "--force"]),
      /Unknown argument/
    );
  });

  it("ignores the lone -- that pnpm forwards, still rejecting other flags", () => {
    assert.equal(parseDryRunFlag(["--", "--dry-run"]), true);
    assert.equal(parseDryRunFlag(["--"]), false);
    assert.equal(parseDryRunFlag(["--dry-run", "--"]), true);
    assert.throws(
      () => parseDryRunFlag(["--", "--dryrun"]),
      /Unknown argument/
    );
    assert.throws(
      () => parseDryRunFlag(["--", "--force"]),
      /Unknown argument/
    );
  });
});

describe("migratePlatform", () => {
  it("fresh database: runs every platform migration in order", async () => {
    const fake = new FakePg();

    const { result } = await migratePlatform(fake, {
      files: platformFiles,
      dryRun: false,
    });

    assert.deepEqual(
      result?.applied,
      platformFiles.map((f) => f.version)
    );
    assert.deepEqual(
      fake.state.versions.get("platform"),
      platformFiles.map((f) => f.version)
    );
    assert.ok(
      fake.state.relations.has("platform.tenants")
    );
  });

  it("existing platform schema: baselined, nothing re-run", async () => {
    const fake = new FakePg();
    fake.seedLegacy("platform", "platform", platformFiles);

    const { result } = await migratePlatform(fake, {
      files: platformFiles,
      dryRun: false,
    });

    assert.deepEqual(
      result?.baselined,
      platformFiles.map((f) => f.version)
    );
    assert.deepEqual(result?.applied, []);
    assert.equal(fake.ran.length, 0);
  });

  it("existing platform schema missing the newest migrations: only those run", async () => {
    const fake = new FakePg();
    fake.seedLegacy(
      "platform",
      "platform",
      platformFiles.slice(0, 5)
    );

    const { result } = await migratePlatform(fake, {
      files: platformFiles,
      dryRun: false,
    });

    assert.equal(result?.baselined.length, 5);
    assert.deepEqual(
      result?.applied,
      platformFiles.slice(5).map((f) => f.version)
    );
  });

  it("--dry-run changes nothing", async () => {
    const fake = new FakePg();
    fake.seedLegacy(
      "platform",
      "platform",
      platformFiles.slice(0, 6)
    );

    const before = fake.snapshot();

    const { plan, result } = await migratePlatform(fake, {
      files: platformFiles,
      dryRun: true,
    });

    assert.equal(result, undefined);
    assert.equal(plan?.toBaseline.length, 6);
    assert.deepEqual(
      plan?.toRun,
      platformFiles.slice(6).map((f) => f.version)
    );
    assert.deepEqual(fake.state, before);
    assert.deepEqual(fake.writes(), []);
  });

  it("refuses to run with no migration files", async () => {
    await assert.rejects(
      () =>
        migratePlatform(new FakePg(), {
          files: [],
          dryRun: false,
        }),
      /No platform migrations/
    );
  });
});
