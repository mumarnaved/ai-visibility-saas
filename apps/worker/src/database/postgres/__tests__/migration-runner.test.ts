import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  applySchemaMigrations,
  loadMigrationFiles,
  planSchemaMigrations,
  type MigrationFile,
} from "../migration-runner.js";
import { FakePg } from "./fake-pg.js";

const here = dirname(fileURLToPath(import.meta.url));

const repoRoot = resolve(here, "../../../../../..");

const tenantFiles = await loadMigrationFiles(
  resolve(
    repoRoot,
    "database/tenant-template/migrations"
  )
);

const SCHEMA = "tenant_acme";

const apply = (
  fake: FakePg,
  files: MigrationFile[],
  schema = SCHEMA
) =>
  applySchemaMigrations(fake, {
    schema,
    kind: "tenant",
    files,
  });

const versionsOf = (fake: FakePg, schema = SCHEMA) =>
  fake.state.versions.get(schema) ?? [];

describe("real tenant migration files", () => {
  it("loads 001-003 in order and skips the .backup.sql", () => {
    assert.deepEqual(
      tenantFiles.map((f) => f.version),
      [
        "001_create_tenant_core",
        "002_add_vector_namespace",
        "003_add_reports",
      ]
    );
  });
});

describe("migration runner (tenant)", () => {
  it("new tenant: creates the schema and runs every version", async () => {
    const fake = new FakePg();

    const result = await apply(fake, tenantFiles);

    assert.deepEqual(
      result.applied,
      tenantFiles.map((f) => f.version)
    );
    assert.deepEqual(result.baselined, []);
    assert.equal(fake.ran.length, 3);
    assert.deepEqual(
      versionsOf(fake),
      tenantFiles.map((f) => f.version)
    );
    assert.ok(fake.state.schemas.has(SCHEMA));
    assert.ok(
      fake.state.relations.has(
        `${SCHEMA}.monitoring_snapshots`
      )
    );
    assert.ok(
      fake.ranOn.every((path) => path === SCHEMA),
      "files must run with search_path set to the tenant schema"
    );
  });

  it("existing tenant with no tracking: baselined, not re-run", async () => {
    const fake = new FakePg();
    fake.seedLegacy(SCHEMA, "tenant", tenantFiles);

    const result = await apply(fake, tenantFiles);

    assert.deepEqual(
      result.baselined,
      tenantFiles.map((f) => f.version)
    );
    assert.deepEqual(result.applied, []);
    assert.equal(fake.ran.length, 0);
    assert.deepEqual(
      versionsOf(fake),
      tenantFiles.map((f) => f.version)
    );
  });

  it("existing tenant missing one object: that version runs, the rest are baselined", async () => {
    const fake = new FakePg();
    fake.seedLegacy(SCHEMA, "tenant", tenantFiles);

    /* 001 half-applied: one index never got created. */
    fake.state.relations.delete(
      `${SCHEMA}.idx_audit_logs_created_at`
    );

    const result = await apply(fake, tenantFiles);

    assert.deepEqual(result.baselined, [
      "002_add_vector_namespace",
      "003_add_reports",
    ]);
    assert.deepEqual(result.applied, [
      "001_create_tenant_core",
    ]);
    assert.ok(
      fake.state.relations.has(
        `${SCHEMA}.idx_audit_logs_created_at`
      )
    );
  });

  it("existing tenant needing one new migration: only that one runs", async () => {
    const fake = new FakePg();
    fake.seedLegacy(
      SCHEMA,
      "tenant",
      tenantFiles.slice(0, 2)
    );

    const result = await apply(fake, tenantFiles);

    assert.deepEqual(result.baselined, [
      "001_create_tenant_core",
      "002_add_vector_namespace",
    ]);
    assert.deepEqual(result.applied, [
      "003_add_reports",
    ]);
    assert.deepEqual(fake.ran, [tenantFiles[2].sql.trim()]);
  });

  it("tracked tenant + a newly added migration: only the new one runs", async () => {
    const fake = new FakePg();
    await apply(fake, tenantFiles.slice(0, 2));

    const ranBefore = fake.ran.length;

    const result = await apply(fake, tenantFiles);

    assert.deepEqual(result.applied, [
      "003_add_reports",
    ]);
    assert.deepEqual(result.baselined, []);
    assert.equal(fake.ran.length, ranBefore + 1);
  });

  it("a migration failing midway rolls back and records nothing", async () => {
    const fake = new FakePg();

    const files: MigrationFile[] = [
      {
        version: "001_ok",
        sql: "CREATE TABLE IF NOT EXISTS a (id int);",
      },
      {
        version: "002_bad",
        sql: "CREATE TABLE IF NOT EXISTS b (id int); BOOM;",
      },
      {
        version: "003_never",
        sql: "CREATE TABLE IF NOT EXISTS c (id int);",
      },
    ];

    await assert.rejects(
      () => apply(fake, files),
      /002_bad.*tenant_acme.*rolled back/
    );

    assert.ok(
      fake.state.relations.has(`${SCHEMA}.a`),
      "001 committed before 002 started"
    );
    assert.ok(
      !fake.state.relations.has(`${SCHEMA}.b`),
      "002's first statement must be rolled back"
    );
    assert.ok(
      !fake.state.relations.has(`${SCHEMA}.c`),
      "003 must not run after a failure"
    );
    assert.deepEqual(versionsOf(fake), ["001_ok"]);
  });

  it("a failure on the very first file leaves no version recorded", async () => {
    const fake = new FakePg();

    await assert.rejects(() =>
      apply(fake, [
        {
          version: "001_bad",
          sql: "CREATE TABLE IF NOT EXISTS a (id int); BOOM;",
        },
      ])
    );

    assert.deepEqual(versionsOf(fake), []);
    assert.ok(
      !fake.state.relations.has(`${SCHEMA}.a`)
    );
  });

  it("after a failure is fixed, a re-run applies the rest", async () => {
    const fake = new FakePg();

    const broken: MigrationFile[] = [
      {
        version: "001_ok",
        sql: "CREATE TABLE IF NOT EXISTS a (id int);",
      },
      {
        version: "002_bad",
        sql: "CREATE TABLE IF NOT EXISTS b (id int); BOOM;",
      },
    ];

    await assert.rejects(() => apply(fake, broken));

    const fixed: MigrationFile[] = [
      broken[0],
      {
        version: "002_bad",
        sql: "CREATE TABLE IF NOT EXISTS b (id int);",
      },
    ];

    const result = await apply(fake, fixed);

    assert.deepEqual(result.applied, ["002_bad"]);
    assert.deepEqual(versionsOf(fake), [
      "001_ok",
      "002_bad",
    ]);
  });

  it("re-running is a no-op", async () => {
    const fake = new FakePg();

    await apply(fake, tenantFiles);

    const ran = fake.ran.length;
    const state = fake.snapshot();

    const again = await apply(fake, tenantFiles);

    assert.deepEqual(again.applied, []);
    assert.deepEqual(again.baselined, []);
    assert.equal(fake.ran.length, ran);
    assert.deepEqual(fake.state, state);
  });

  it("two schemas are tracked independently", async () => {
    const fake = new FakePg();

    await apply(fake, tenantFiles, "tenant_a");
    await apply(fake, tenantFiles.slice(0, 1), "tenant_b");

    assert.equal(versionsOf(fake, "tenant_a").length, 3);
    assert.equal(versionsOf(fake, "tenant_b").length, 1);
  });
});

describe("dry run (planSchemaMigrations)", () => {
  it("never writes anything for a schema that does not exist", async () => {
    const fake = new FakePg();
    const before = fake.snapshot();

    const plan = await planSchemaMigrations(fake, {
      schema: SCHEMA,
      kind: "tenant",
      files: tenantFiles,
    });

    assert.equal(plan.schemaExists, false);
    assert.deepEqual(plan.toBaseline, []);
    assert.deepEqual(
      plan.toRun,
      tenantFiles.map((f) => f.version)
    );
    assert.deepEqual(fake.state, before);
    assert.deepEqual(fake.writes(), []);
  });

  it("reports baseline vs run for an untracked tenant, writing nothing", async () => {
    const fake = new FakePg();
    fake.seedLegacy(
      SCHEMA,
      "tenant",
      tenantFiles.slice(0, 2)
    );

    const before = fake.snapshot();

    const plan = await planSchemaMigrations(fake, {
      schema: SCHEMA,
      kind: "tenant",
      files: tenantFiles,
    });

    assert.deepEqual(plan.toBaseline, [
      "001_create_tenant_core",
      "002_add_vector_namespace",
    ]);
    assert.deepEqual(plan.toRun, ["003_add_reports"]);
    assert.equal(plan.trackingTableExists, false);
    assert.deepEqual(fake.state, before);
    assert.deepEqual(fake.writes(), []);
    assert.equal(fake.ran.length, 0);
  });

  it("reports only the pending versions for a tracked tenant", async () => {
    const fake = new FakePg();
    await apply(fake, tenantFiles.slice(0, 2));

    const before = fake.snapshot();

    const plan = await planSchemaMigrations(fake, {
      schema: SCHEMA,
      kind: "tenant",
      files: tenantFiles,
    });

    assert.deepEqual(plan.alreadyApplied, [
      "001_create_tenant_core",
      "002_add_vector_namespace",
    ]);
    assert.deepEqual(plan.toBaseline, []);
    assert.deepEqual(plan.toRun, ["003_add_reports"]);
    assert.deepEqual(fake.state, before);
  });
});
