import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, afterEach, before, describe, it } from "node:test";

import {
  defaultMigrationsPathContext,
  migrationsRootCandidates,
  resolveMigrationsDirectory,
  type MigrationsPathContext,
} from "../migrations-path.js";
import {
  loadMigrationFiles,
  platformMigrationsDirectory,
  tenantMigrationsDirectory,
} from "../migration-runner.js";
import { FakePg } from "./fake-pg.js";

process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:1/test";

const sandbox = mkdtempSync(join(tmpdir(), "migrations-path-"));

after(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/* A database/ folder shaped like the repo's, with one file per kind. */
function makeDatabaseRoot(root: string, tag: string): string {
  for (const sub of [
    "platform/migrations",
    "tenant-template/migrations",
  ]) {
    mkdirSync(join(root, sub), { recursive: true });
    writeFileSync(
      join(root, sub, "001_marker.sql"),
      `-- ${tag}\nSELECT 1;\n`
    );
  }

  return root;
}

const isDirectory = (path: string) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

function context(
  overrides: Partial<MigrationsPathContext>
): MigrationsPathContext {
  return {
    env: {},
    cwd: sandbox,
    moduleDir: join(sandbox, "nowhere", "src", "database", "postgres"),
    isDirectory,
    ...overrides,
  };
}

describe("resolveMigrationsDirectory", () => {
  it("MIGRATIONS_ROOT wins over everything else", () => {
    const root = makeDatabaseRoot(join(sandbox, "override"), "override");

    assert.equal(
      resolveMigrationsDirectory(
        "tenant",
        context({ env: { MIGRATIONS_ROOT: root } })
      ),
      resolve(root, "tenant-template/migrations")
    );

    assert.equal(
      resolveMigrationsDirectory(
        "platform",
        context({ env: { MIGRATIONS_ROOT: root } })
      ),
      resolve(root, "platform/migrations")
    );
  });

  it("a wrong MIGRATIONS_ROOT is an error, not a silent fallback", () => {
    assert.throws(
      () =>
        resolveMigrationsDirectory(
          "tenant",
          context({
            env: { MIGRATIONS_ROOT: join(sandbox, "does-not-exist") },
          })
        ),
      /MIGRATIONS_ROOT is set to .* does not exist/
    );
  });

  it("finds the copy bundled next to the app (the Vercel layout), whatever the cwd", () => {
    /* /var/task/{src/database/postgres, database/...} */
    const task = join(sandbox, "vercel-task");
    makeDatabaseRoot(join(task, "database"), "bundled");

    for (const cwd of [task, tmpdir(), "/"]) {
      assert.equal(
        resolveMigrationsDirectory(
          "tenant",
          context({
            cwd,
            moduleDir: join(task, "src", "database", "postgres"),
          })
        ),
        resolve(task, "database/tenant-template/migrations"),
        `cwd ${cwd}`
      );
    }
  });

  it("the old cwd-relative path (cwd/../../database) is not needed any more", () => {
    /* On Vercel that resolved to /database, which does not exist. */
    const task = join(sandbox, "vercel-task-2");
    makeDatabaseRoot(join(task, "database"), "bundled");

    const candidates = migrationsRootCandidates(
      context({
        cwd: task,
        moduleDir: join(task, "src", "database", "postgres"),
      })
    ).map((c) => c.root);

    assert.ok(candidates.includes(resolve(task, "database")));
    assert.doesNotThrow(() =>
      resolveMigrationsDirectory(
        "platform",
        context({
          cwd: task,
          moduleDir: join(task, "src", "database", "postgres"),
        })
      )
    );
  });

  it("the repo-level database/ folder wins over a bundled copy, so a stale copy never shadows the source", () => {
    const repo = join(sandbox, "repo");
    makeDatabaseRoot(join(repo, "database"), "repo");
    makeDatabaseRoot(join(repo, "apps", "worker", "database"), "stale copy");

    assert.equal(
      resolveMigrationsDirectory(
        "tenant",
        context({
          cwd: "/",
          moduleDir: join(
            repo,
            "apps",
            "worker",
            "src",
            "database",
            "postgres"
          ),
        })
      ),
      resolve(repo, "database/tenant-template/migrations")
    );
  });

  it("finds the bundled copy through cwd when the module location does not help", () => {
    const task = join(sandbox, "cwd-only");
    makeDatabaseRoot(join(task, "database"), "cwd copy");

    assert.equal(
      resolveMigrationsDirectory(
        "platform",
        context({ cwd: task })
      ),
      resolve(task, "database/platform/migrations")
    );
  });

  it("when nothing is found the error lists every place it looked and how to fix it", () => {
    assert.throws(
      () =>
        resolveMigrationsDirectory(
          "tenant",
          context({
            cwd: join(sandbox, "empty-cwd"),
            moduleDir: join(sandbox, "empty-app", "src", "database", "postgres"),
          })
        ),
      (error: Error) =>
        /Could not find the tenant migration files/.test(error.message) &&
        error.message.includes(
          resolve(sandbox, "empty-cwd", "database", "tenant-template", "migrations")
        ) &&
        /MIGRATIONS_ROOT/.test(error.message) &&
        (error.message.match(/^ {2}- /gm) ?? []).length === 4
    );
  });
});

describe("started from a different working directory", () => {
  const originalCwd = process.cwd();
  const originalRoot = process.env.MIGRATIONS_ROOT;

  afterEach(() => {
    process.chdir(originalCwd);

    if (originalRoot === undefined) {
      delete process.env.MIGRATIONS_ROOT;
    } else {
      process.env.MIGRATIONS_ROOT = originalRoot;
    }
  });

  it("the real repo migrations are found from the filesystem root, the temp dir and the repo root", async () => {
    delete process.env.MIGRATIONS_ROOT;

    const starts = [
      sandbox,
      tmpdir(),
      resolve(originalCwd, "..", ".."),
      resolve(originalCwd, "src"),
    ];

    for (const start of starts) {
      process.chdir(start);

      const tenant = await loadMigrationFiles(tenantMigrationsDirectory());
      const platform = await loadMigrationFiles(platformMigrationsDirectory());

      assert.ok(
        tenant.some((f) => f.version === "001_create_tenant_core"),
        `tenant files from ${start}`
      );
      assert.ok(
        platform.some((f) => f.version === "001_create_platform"),
        `platform files from ${start}`
      );
      assert.ok(
        platform.some((f) => f.version === "012_create_rate_limit_buckets"),
        `latest platform file from ${start}`
      );
    }
  });

  it("provisioning a tenant schema applies every tenant migration even when started elsewhere", async () => {
    delete process.env.MIGRATIONS_ROOT;
    process.chdir(sandbox);

    const fake = new FakePg();

    const { pool } = await import("../connection.js");

    (pool as unknown as {
      query: FakePg["query"];
      connect: FakePg["connect"];
    }).query = (sql, params) => fake.query(sql, params);
    (pool as unknown as { connect: FakePg["connect"] }).connect = () =>
      fake.connect();

    const { provisionTenantSchema } = await import(
      "../tenant-schema-provisioner.js"
    );

    await provisionTenantSchema("tenant_started_elsewhere");

    const expected = await loadMigrationFiles(tenantMigrationsDirectory());

    assert.ok(expected.length >= 3);
    assert.equal(
      fake.ran.length,
      expected.length,
      "every tenant-template file was found and executed"
    );
    assert.ok(
      fake.ranOn.every((schema) => schema === "tenant_started_elsewhere")
    );
  });

  it("MIGRATIONS_ROOT also works from anywhere (the escape hatch on a host)", async () => {
    const root = makeDatabaseRoot(join(sandbox, "env-root"), "env-root");

    process.env.MIGRATIONS_ROOT = root;
    process.chdir(tmpdir());

    const files = await loadMigrationFiles(tenantMigrationsDirectory());

    assert.deepEqual(
      files.map((f) => f.version),
      ["001_marker"]
    );
  });
});

describe("default context", () => {
  before(() => {
    delete process.env.MIGRATIONS_ROOT;
  });

  it("derives the module directory from this codebase, not from cwd", () => {
    const context = defaultMigrationsPathContext();

    assert.match(
      context.moduleDir.replaceAll("\\", "/"),
      /apps\/worker\/src\/database\/postgres$/
    );
  });
});
