import {
  applySchemaMigrations,
  planSchemaMigrations,
  type MigrationFile,
  type MigrationPool,
  type SchemaMigrationPlan,
  type SchemaMigrationResult,
} from "./migration-runner.js";

/* ========================================
   MIGRATION COMMANDS

   The logic behind migrate-all-tenants and
   run-platform-migration. Kept free of the
   database connection module so it can be
   tested with a fake pool; the two CLI files
   only wire in the real pool and argv.
======================================== */

export interface TenantRow {
  id: string;
  name: string;
  schema_name: string;
  status: string;
}

export interface TenantOutcome {
  tenant: TenantRow;
  plan?: SchemaMigrationPlan;
  result?: SchemaMigrationResult;
  error?: string;
}

export interface TenantMigrationSummary {
  dryRun: boolean;
  succeeded: TenantOutcome[];
  failed: TenantOutcome[];
  skipped: TenantOutcome[];
}

type Log = (line: string) => void;

function describe(
  versions: string[]
): string {
  return versions.length > 0
    ? versions.join(", ")
    : "none";
}

/*
 * Only 'active' tenants are migrated. Every
 * other status (provisioning, failed,
 * suspended, deprovisioning, deprovisioned) is
 * listed as skipped, never touched.
 */
export async function migrateAllTenants(
  pool: MigrationPool,
  options: {
    files: MigrationFile[];
    dryRun: boolean;
    log?: Log;
  }
): Promise<TenantMigrationSummary> {
  const { files, dryRun } = options;
  const log = options.log ?? (() => undefined);

  const tenants = await pool.query(
    `
      SELECT
        id,
        name,
        schema_name,
        status
      FROM platform.tenants
      ORDER BY created_at ASC
    `
  );

  const summary: TenantMigrationSummary = {
    dryRun,
    succeeded: [],
    failed: [],
    skipped: [],
  };

  for (const tenant of tenants.rows as TenantRow[]) {
    const label = `"${tenant.name}" (${tenant.schema_name})`;

    if (tenant.status !== "active") {
      summary.skipped.push({ tenant });

      log(
        `SKIP ${label}: status is "${tenant.status}"`
      );

      continue;
    }

    try {
      if (dryRun) {
        const plan = await planSchemaMigrations(
          pool,
          {
            schema: tenant.schema_name,
            kind: "tenant",
            files,
          }
        );

        summary.succeeded.push({ tenant, plan });

        log(
          `DRY-RUN ${label}: baseline [${describe(plan.toBaseline)}], run [${describe(plan.toRun)}]`
        );
      } else {
        const result =
          await applySchemaMigrations(pool, {
            schema: tenant.schema_name,
            kind: "tenant",
            files,
          });

        summary.succeeded.push({ tenant, result });

        log(
          `OK ${label}: baselined [${describe(result.baselined)}], applied [${describe(result.applied)}]`
        );
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      summary.failed.push({
        tenant,
        error: message,
      });

      log(`FAILED ${label}: ${message}`);
    }
  }

  return summary;
}

export function formatTenantSummary(
  summary: TenantMigrationSummary
): string {
  const lines = [
    `${summary.dryRun ? "Dry run complete (nothing was changed)" : "Migration complete"}: ${summary.succeeded.length} succeeded, ${summary.failed.length} failed, ${summary.skipped.length} skipped`,
  ];

  for (const outcome of summary.failed) {
    lines.push(
      `  failed:  ${outcome.tenant.schema_name} - ${outcome.error}`
    );
  }

  for (const outcome of summary.skipped) {
    lines.push(
      `  skipped: ${outcome.tenant.schema_name} (${outcome.tenant.status})`
    );
  }

  return lines.join("\n");
}

export function tenantExitCode(
  summary: TenantMigrationSummary
): number {
  return summary.failed.length > 0 ? 1 : 0;
}

/* ========================================
   PLATFORM
======================================== */

export async function migratePlatform(
  pool: MigrationPool,
  options: {
    files: MigrationFile[];
    dryRun: boolean;
    log?: Log;
  }
): Promise<{
  plan?: SchemaMigrationPlan;
  result?: SchemaMigrationResult;
}> {
  const { files, dryRun } = options;
  const log = options.log ?? (() => undefined);

  if (files.length === 0) {
    throw new Error("No platform migrations found.");
  }

  if (dryRun) {
    const plan = await planSchemaMigrations(pool, {
      schema: "platform",
      kind: "platform",
      files,
    });

    log(
      `DRY-RUN platform: baseline [${describe(plan.toBaseline)}], run [${describe(plan.toRun)}]`
    );

    return { plan };
  }

  const result = await applySchemaMigrations(
    pool,
    {
      schema: "platform",
      kind: "platform",
      files,
    }
  );

  log(
    `OK platform: baselined [${describe(result.baselined)}], applied [${describe(result.applied)}]`
  );

  return { result };
}

/*
 * Only --dry-run is recognised. Anything else
 * is rejected so a typo (--dryrun) cannot turn
 * a rehearsal into a real run.
 */
export function parseDryRunFlag(
  argv: string[]
): boolean {
  const unknown = argv.filter(
    (arg) => arg !== "--dry-run"
  );

  if (unknown.length > 0) {
    throw new Error(
      `Unknown argument(s): ${unknown.join(" ")}. Only --dry-run is supported.`
    );
  }

  return argv.includes("--dry-run");
}
