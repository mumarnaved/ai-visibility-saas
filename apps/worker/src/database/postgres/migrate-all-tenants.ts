import "dotenv/config";

import { pool } from "./connection.js";
import {
  formatTenantSummary,
  migrateAllTenants,
  parseDryRunFlag,
  tenantExitCode,
} from "./migration-commands.js";
import {
  loadMigrationFiles,
  tenantMigrationsDirectory,
} from "./migration-runner.js";

/* ========================================
   MIGRATE ALL TENANTS

   Applies unapplied tenant-template
   migrations to every ACTIVE tenant schema,
   one tenant at a time, continuing past
   failures.

     pnpm --filter worker migrate:tenants --dry-run
     pnpm --filter worker migrate:tenants

   (a "--" before --dry-run is also accepted)

   --dry-run prints, per tenant, which versions
   would be baselined and which would run, and
   changes nothing.
======================================== */

try {
  const dryRun = parseDryRunFlag(
    process.argv.slice(2)
  );

  const files = await loadMigrationFiles(
    tenantMigrationsDirectory()
  );

  const summary = await migrateAllTenants(pool, {
    files,
    dryRun,
    log: (line) => console.log(line),
  });

  console.log(formatTenantSummary(summary));

  process.exitCode = tenantExitCode(summary);
} catch (error) {
  console.error("Tenant migration run FAILED");

  console.error(
    error instanceof Error
      ? error.message
      : error
  );

  process.exitCode = 1;
} finally {
  await pool.end();
}
