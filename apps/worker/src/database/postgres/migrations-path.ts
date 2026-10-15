import { statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/* ========================================
   WHERE THE SQL MIGRATION FILES ARE

   The .sql files live in database/ at the repo root,
   which is outside the worker's deployable folder
   (apps/worker). They used to be found with
   process.cwd()/../../database, which only works when
   the process starts in apps/worker. On Vercel the
   working directory is /var/task, so the path became
   /database and provisioning failed with ENOENT.

   Paths are now resolved from this module's own
   location, and the first candidate that exists wins:

   1. $MIGRATIONS_ROOT - explicit override. It points at
      a folder shaped like the repo's database/ folder
      (platform/migrations and tenant-template/migrations
      inside). Strict: if it is set but wrong, that is an
      error, not a silent fallback.
   2. <repo>/database  - local dev, tests, CLI scripts.
      Always the source of truth when it exists.
   3. <app>/database   - the copy scripts/vercel-build.sh
      puts inside apps/worker so it ships with the
      function (vercel.json includeFiles lists it too).
   4. <cwd>/database   - the same copy, found via cwd.
   5. <cwd>/../../database - the old behaviour, last.

   <app> is apps/worker, derived from this file's
   location (src/database/postgres/ -> three levels up),
   so it is right wherever the process was started.
======================================== */

export type MigrationsKind = "tenant" | "platform";

const SUBFOLDER: Record<MigrationsKind, string> = {
  tenant: "tenant-template/migrations",
  platform: "platform/migrations",
};

export interface MigrationsPathContext {
  env: NodeJS.ProcessEnv;
  cwd: string;
  /* Directory of this module (src/database/postgres). */
  moduleDir: string;
  isDirectory: (path: string) => boolean;
}

function directoryExists(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function defaultMigrationsPathContext(): MigrationsPathContext {
  return {
    env: process.env,
    cwd: process.cwd(),
    moduleDir: dirname(fileURLToPath(import.meta.url)),
    isDirectory: directoryExists,
  };
}

/* The database/ roots to try, in order, with a label for errors. */
export function migrationsRootCandidates(
  context: MigrationsPathContext
): { label: string; root: string }[] {
  /* apps/worker, from src/database/postgres */
  const appRoot = resolve(context.moduleDir, "..", "..", "..");

  return [
    {
      label: "<repo>/database",
      root: resolve(appRoot, "..", "..", "database"),
    },
    {
      label: "<app>/database",
      root: resolve(appRoot, "database"),
    },
    {
      label: "<cwd>/database",
      root: resolve(context.cwd, "database"),
    },
    {
      label: "<cwd>/../../database",
      root: resolve(context.cwd, "..", "..", "database"),
    },
  ];
}

export function resolveMigrationsDirectory(
  kind: MigrationsKind,
  context: MigrationsPathContext = defaultMigrationsPathContext()
): string {
  const override = context.env.MIGRATIONS_ROOT?.trim();

  if (override) {
    const directory = resolve(override, SUBFOLDER[kind]);

    if (!context.isDirectory(directory)) {
      throw new Error(
        `MIGRATIONS_ROOT is set to "${override}" but ${directory} does not exist. It must contain platform/migrations and tenant-template/migrations.`
      );
    }

    return directory;
  }

  const tried: string[] = [];

  for (const { root } of migrationsRootCandidates(context)) {
    const directory = resolve(root, SUBFOLDER[kind]);

    if (context.isDirectory(directory)) {
      return directory;
    }

    tried.push(directory);
  }

  throw new Error(
    `Could not find the ${kind} migration files. Looked in:\n${tried
      .map((path) => `  - ${path}`)
      .join(
        "\n"
      )}\nSet MIGRATIONS_ROOT to a folder containing platform/migrations and tenant-template/migrations, or make sure the build copied database/ into apps/worker.`
  );
}
