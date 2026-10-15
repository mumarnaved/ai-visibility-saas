import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applySchemaMigrations,
  tenantSearchPath,
  type MigrationFile,
} from "../migration-runner.js";
import { FakePg } from "./fake-pg.js";

const SCHEMA = "tenant_acme";

const files: MigrationFile[] = [
  {
    version: "001_core",
    sql: "CREATE TABLE IF NOT EXISTS a (id int);",
  },
  {
    version: "002_vector",
    sql: "CREATE TABLE IF NOT EXISTS entity_embeddings (id int, embedding VECTOR(1536));",
  },
];

const searchPathStatements = (fake: FakePg) =>
  fake.log.filter((statement) => /^SET LOCAL search_path/i.test(statement));

describe("tenant migration search_path", () => {
  it("is the tenant schema, then extensions, then public", () => {
    assert.equal(
      tenantSearchPath('"tenant_acme"'),
      '"tenant_acme", extensions, public'
    );
  });

  it("each tenant migration runs with that path, so pgvector in 'extensions' (Supabase) resolves", async () => {
    const fake = new FakePg();

    await applySchemaMigrations(fake, {
      schema: SCHEMA,
      kind: "tenant",
      files,
    });

    assert.deepEqual(searchPathStatements(fake), [
      `SET LOCAL search_path TO "${SCHEMA}", extensions, public`,
      `SET LOCAL search_path TO "${SCHEMA}", extensions, public`,
    ]);

    /* The tenant schema stays first: tables are still created there. */
    assert.ok(fake.ranOn.every((path) => path === SCHEMA));
    assert.ok(fake.state.relations.has(`${SCHEMA}.entity_embeddings`));
  });

  it("platform migrations still do not touch search_path (they qualify everything)", async () => {
    const fake = new FakePg();

    await applySchemaMigrations(fake, {
      schema: "platform",
      kind: "platform",
      files: [
        {
          version: "001_x",
          sql: "CREATE TABLE IF NOT EXISTS platform.x (id int);",
        },
      ],
    });

    assert.deepEqual(searchPathStatements(fake), []);
  });

  it("a version a tenant already has is never re-run, so already-provisioned tenants are unaffected", async () => {
    const fake = new FakePg();

    await applySchemaMigrations(fake, {
      schema: SCHEMA,
      kind: "tenant",
      files,
    });

    const ranBefore = fake.ran.length;

    /*
     * The runner records versions only (no checksum), so even a
     * file whose contents changed is skipped once its version is
     * recorded. Editing a migration can never alter, or break, a
     * tenant that already has it.
     */
    await applySchemaMigrations(fake, {
      schema: SCHEMA,
      kind: "tenant",
      files: files.map((f) => ({
        ...f,
        sql: `${f.sql}\n-- edited later\nSELECT definitely_not_valid_sql;`,
      })),
    });

    assert.equal(fake.ran.length, ranBefore);
    assert.equal(searchPathStatements(fake).length, 2, "no new SET LOCAL");
  });
});
