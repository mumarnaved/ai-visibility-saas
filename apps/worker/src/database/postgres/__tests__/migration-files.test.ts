import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  BASELINE_MARKERS,
  loadMigrationFiles,
  planSchemaMigrations,
  type MigrationKind,
  type Probe,
} from "../migration-runner.js";
import { FakePg } from "./fake-pg.js";

/* ========================================
   The real .sql files, audited:

   1. every migration is idempotent, because
      the runner relies on that when it runs a
      file against a schema that is partly
      migrated, and
   2. each baseline marker lists exactly the
      objects its file creates, so a schema is
      only baselined when the file's work is
      really all there.
======================================== */

const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../.."
);

const kinds: Record<MigrationKind, string> = {
  tenant: "database/tenant-template/migrations",
  platform: "database/platform/migrations",
};

function strip(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ");
}

function statements(sql: string): string[] {
  return strip(sql)
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function created(sql: string): string[] {
  const names: string[] = [];
  const text = strip(sql).replace(/\s+/g, " ");

  for (const re of [
    /CREATE TABLE IF NOT EXISTS (?:\w+\.)?(\w+)/gi,
    /CREATE INDEX IF NOT EXISTS (\w+)/gi,
    /ADD COLUMN IF NOT EXISTS (\w+)/gi,
    /ADD CONSTRAINT (\w+)/gi,
    /CREATE EXTENSION IF NOT EXISTS (\w+)/gi,
  ]) {
    for (const match of text.matchAll(re)) {
      names.push(match[1]);
    }
  }

  return names.sort();
}

function probeName(probe: Probe): string {
  if ("relation" in probe) return probe.relation;
  if ("column" in probe) return probe.column[1];
  if ("constraint" in probe) return probe.constraint.name;
  return probe.extension;
}

for (const [kind, directory] of Object.entries(
  kinds
) as [MigrationKind, string][]) {
  const files = await loadMigrationFiles(
    resolve(repoRoot, directory)
  );

  describe(`${kind} migration files`, () => {
    it("exist and are numbered consecutively", () => {
      assert.ok(files.length > 0);

      files.forEach((file, index) => {
        assert.match(
          file.version,
          new RegExp(
            `^${String(index + 1).padStart(3, "0")}_`
          )
        );
      });
    });

    for (const file of files) {
      describe(file.version, () => {
        const parts = statements(file.sql);

        it("is idempotent", () => {
          for (const s of parts) {
            assert.doesNotMatch(
              s,
              /^CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/i,
              s
            );
            assert.doesNotMatch(
              s,
              /^CREATE (TABLE|SCHEMA|EXTENSION) (?!IF NOT EXISTS)/i,
              s
            );
            assert.doesNotMatch(
              s,
              /ADD COLUMN (?!IF NOT EXISTS)/i,
              s
            );
            assert.doesNotMatch(
              s,
              /^(DROP TABLE|DELETE|TRUNCATE|UPDATE) /i,
              s
            );

            if (/^INSERT /i.test(s)) {
              assert.match(s, /ON CONFLICT/i, s);
            }
          }
        });

        it("drops a constraint before re-adding it", () => {
          for (const match of strip(file.sql)
            .replace(/\s+/g, " ")
            .matchAll(/ADD CONSTRAINT (\w+)/gi)) {
            assert.match(
              strip(file.sql),
              new RegExp(
                `DROP CONSTRAINT IF EXISTS ${match[1]}`,
                "i"
              ),
              `${match[1]} is added without a preceding DROP ... IF EXISTS`
            );
          }
        });

        it("has a baseline marker listing exactly what it creates", () => {
          const probes =
            BASELINE_MARKERS[kind][file.version];

          assert.ok(
            probes && probes.length > 0,
            `no baseline marker for ${kind}/${file.version}`
          );

          assert.deepEqual(
            [...new Set(probes.map(probeName))].sort(),
            [...new Set(created(file.sql))].sort()
          );
        });
      });
    }

    it("has no baseline marker for a file that does not exist", () => {
      const versions = new Set(
        files.map((f) => f.version)
      );

      for (const version of Object.keys(
        BASELINE_MARKERS[kind]
      )) {
        assert.ok(
          versions.has(version),
          `marker for missing file ${version}`
        );
      }
    });

    it("a schema built from these files is fully baselined, and one file short is not", async () => {
      const schema =
        kind === "platform" ? "platform" : "tenant_x";

      const full = new FakePg();
      full.seedLegacy(schema, kind, files);

      const plan = await planSchemaMigrations(full, {
        schema,
        kind,
        files,
      });

      assert.deepEqual(
        plan.toBaseline,
        files.map((f) => f.version)
      );
      assert.deepEqual(plan.toRun, []);

      const short = new FakePg();
      short.seedLegacy(schema, kind, files.slice(0, -1));

      const shortPlan = await planSchemaMigrations(
        short,
        { schema, kind, files }
      );

      assert.deepEqual(shortPlan.toRun, [
        files[files.length - 1].version,
      ]);
    });
  });
}
