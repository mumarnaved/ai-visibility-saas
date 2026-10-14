import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

/* ========================================
   VERSIONED MIGRATION RUNNER

   Applies the .sql files of one migrations
   folder to one schema, recording each file's
   version in <schema>.schema_migrations. Used
   for every tenant schema (tenant-template
   migrations) and for the platform schema.

   - Each file runs as ONE transaction on a
     dedicated connection (BEGIN ... COMMIT), so
     semicolons inside strings/functions are not
     a problem and a failing file leaves nothing
     behind. The version row is inserted in the
     same transaction.
   - search_path is set with SET LOCAL on that
     same connection, so it cannot leak to or be
     lost across pooled connections.
   - A per-schema advisory lock plus a re-check
     inside the transaction keeps two runners
     from applying the same version twice.
   - Existing schemas that predate this table
     are baselined, see detectAlreadyApplied().
======================================== */

export interface MigrationClient {
  query(
    sql: string,
    params?: unknown[]
  ): Promise<{ rows: any[] }>;
  release(): void;
}

export interface MigrationPool {
  query(
    sql: string,
    params?: unknown[]
  ): Promise<{ rows: any[] }>;
  connect(): Promise<MigrationClient>;
}

export interface MigrationFile {
  version: string;
  sql: string;
}

export interface SchemaMigrationPlan {
  schema: string;
  schemaExists: boolean;
  trackingTableExists: boolean;
  alreadyApplied: string[];
  toBaseline: string[];
  toRun: string[];
}

export interface SchemaMigrationResult {
  schema: string;
  baselined: string[];
  applied: string[];
}

export type MigrationKind =
  | "tenant"
  | "platform";

/*
 * Same cwd-relative lookup the provisioner and
 * platform runner always used; run from
 * apps/worker (pnpm --filter worker ...).
 */
export function tenantMigrationsDirectory(): string {
  return resolve(
    process.cwd(),
    "..",
    "..",
    "database",
    "tenant-template",
    "migrations"
  );
}

export function platformMigrationsDirectory(): string {
  return resolve(
    process.cwd(),
    "..",
    "..",
    "database",
    "platform",
    "migrations"
  );
}

export function quoteIdentifier(
  identifier: string
): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

/* ========================================
   LOAD FILES
======================================== */

export async function loadMigrationFiles(
  directory: string
): Promise<MigrationFile[]> {
  const names = (await readdir(directory))
    .filter(
      (file) =>
        file.endsWith(".sql") &&
        !file.endsWith(".backup.sql")
    )
    .sort();

  return Promise.all(
    names.map(async (name) => ({
      version: name.slice(0, -".sql".length),
      sql: await readFile(
        resolve(directory, name),
        "utf8"
      ),
    }))
  );
}

/* ========================================
   BASELINE MARKERS

   A schema that was migrated before version
   tracking existed has no schema_migrations
   rows. A version is baselined (recorded as
   applied WITHOUT running) only when EVERY
   object its file creates is present, so a
   schema that is missing even one table or
   index still gets that file run. That is safe
   because every migration is idempotent (see
   migration-files.test.ts). A version with no
   markers is never baselined; it just runs.

   Platform files run as one implicit
   transaction under the old runner, so the
   markers also cover ALTER-only files (columns
   and the CHECK constraints they replace).
======================================== */

export type Probe =
  | { relation: string }
  | { column: [table: string, column: string] }
  | { extension: string }
  | {
      constraint: {
        table: string;
        name: string;
        includes?: string;
      };
    };

const relations = (...names: string[]): Probe[] =>
  names.map((relation) => ({ relation }));

const columns = (
  table: string,
  ...names: string[]
): Probe[] =>
  names.map((name) => ({
    column: [table, name] as [string, string],
  }));

export const BASELINE_MARKERS: Record<
  MigrationKind,
  Record<string, Probe[]>
> = {
  tenant: {
    "001_create_tenant_core": relations(
      "users",
      "workspaces",
      "audit_logs",
      "idx_audit_logs_created_at",
      "technical_audits",
      "idx_technical_audits_created_at",
      "content_entity_audits",
      "idx_content_entity_audits_created_at",
      "citation_audits",
      "idx_citation_audits_created_at",
      "competitor_benchmarks",
      "idx_competitor_benchmarks_created_at",
      "audit_reports",
      "idx_audit_reports_created_at",
      "content_plans",
      "idx_content_plans_created_at",
      "execution_tasks",
      "idx_execution_tasks_status",
      "publish_logs",
      "idx_publish_logs_created_at",
      "monitoring_snapshots",
      "idx_monitoring_snapshots_date"
    ),
    "002_add_vector_namespace": relations(
      "entity_embeddings",
      "idx_entity_embeddings_entity_type"
    ),
    "003_add_reports": relations(
      "reports",
      "idx_reports_created_at"
    ),
  },
  platform: {
    "001_create_platform": relations(
      "tenants",
      "idx_platform_tenants_status",
      "idx_platform_tenants_schema_name"
    ),
    "002_add_website_url_to_tenants": columns(
      "tenants",
      "website_url"
    ),
    "003_create_authentication": relations(
      "users",
      "idx_platform_users_email",
      "idx_platform_users_status",
      "workspaces",
      "idx_platform_workspaces_tenant_id",
      "workspace_members",
      "idx_workspace_members_workspace_id",
      "idx_workspace_members_user_id",
      "sessions",
      "idx_platform_sessions_user_id",
      "idx_platform_sessions_expires_at"
    ),
    "004_enable_vector_extension": [
      { extension: "vector" },
    ],
    "005_create_credential_vault": relations(
      "credential_vault",
      "idx_credential_vault_tenant_id"
    ),
    "006_add_domain_verification_and_deprovisioning":
      [
        ...columns(
          "tenants",
          "verification_token",
          "domain_verified_at",
          "deprovision_at"
        ),
        {
          constraint: {
            table: "tenants",
            name: "tenants_status_check",
            includes: "deprovisioned",
          },
        },
      ],
    "007_add_scan_status": [
      ...columns(
        "tenants",
        "scan_status",
        "scan_error"
      ),
      {
        constraint: {
          table: "tenants",
          name: "tenants_scan_status_check",
          includes: "not_started",
        },
      },
    ],
    "008_create_billing_accounts": relations(
      "billing_accounts",
      "idx_billing_accounts_user_id",
      "idx_billing_accounts_stripe_customer_id",
      "idx_billing_accounts_stripe_subscription_id"
    ),
    "009_add_tenant_manifest": columns(
      "tenants",
      "manifest"
    ),
    "010_create_jobs": relations(
      "jobs",
      "idx_jobs_status_run_at",
      "idx_jobs_tenant_id"
    ),
  },
};

async function probeExists(
  db: Pick<MigrationPool, "query">,
  schema: string,
  probe: Probe
): Promise<boolean> {
  if ("relation" in probe) {
    const result = await db.query(
      `SELECT to_regclass($1) IS NOT NULL AS present`,
      [
        `${quoteIdentifier(schema)}.${quoteIdentifier(probe.relation)}`,
      ]
    );

    return result.rows[0]?.present === true;
  }

  if ("column" in probe) {
    const result = await db.query(
      `
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = $1
            AND table_name = $2
            AND column_name = $3
        ) AS present
      `,
      [
        schema,
        probe.column[0],
        probe.column[1],
      ]
    );

    return result.rows[0]?.present === true;
  }

  if ("constraint" in probe) {
    const result = await db.query(
      `
        SELECT EXISTS (
          SELECT 1
          FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
          WHERE n.nspname = $1
            AND t.relname = $2
            AND c.conname = $3
            AND pg_get_constraintdef(c.oid) LIKE '%' || $4 || '%'
        ) AS present
      `,
      [
        schema,
        probe.constraint.table,
        probe.constraint.name,
        probe.constraint.includes ?? "",
      ]
    );

    return result.rows[0]?.present === true;
  }

  const result = await db.query(
    `
      SELECT EXISTS (
        SELECT 1
        FROM pg_extension
        WHERE extname = $1
      ) AS present
    `,
    [probe.extension]
  );

  return result.rows[0]?.present === true;
}

async function allProbesExist(
  db: Pick<MigrationPool, "query">,
  schema: string,
  probes: Probe[]
): Promise<boolean> {
  for (const probe of probes) {
    if (!(await probeExists(db, schema, probe))) {
      return false;
    }
  }

  return true;
}

/* ========================================
   PLAN (read-only)

   Never writes. This is what --dry-run prints.
======================================== */

export async function planSchemaMigrations(
  db: Pick<MigrationPool, "query">,
  options: {
    schema: string;
    kind: MigrationKind;
    files: MigrationFile[];
  }
): Promise<SchemaMigrationPlan> {
  const { schema, kind, files } = options;

  const schemaRow = await db.query(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.schemata
        WHERE schema_name = $1
      ) AS present
    `,
    [schema]
  );

  const schemaExists =
    schemaRow.rows[0]?.present === true;

  let trackingTableExists = false;
  let alreadyApplied: string[] = [];

  if (schemaExists) {
    const tracking = await db.query(
      `SELECT to_regclass($1) IS NOT NULL AS present`,
      [
        `${quoteIdentifier(schema)}.schema_migrations`,
      ]
    );

    trackingTableExists =
      tracking.rows[0]?.present === true;

    if (trackingTableExists) {
      const applied = await db.query(
        `SELECT version FROM ${quoteIdentifier(schema)}.schema_migrations`
      );

      alreadyApplied = applied.rows.map(
        (row) => row.version as string
      );
    }
  }

  const appliedSet = new Set(alreadyApplied);

  const pending = files.filter(
    (file) => !appliedSet.has(file.version)
  );

  /*
   * Baseline only on first adoption (nothing
   * recorded yet) and only for schemas that
   * already exist.
   */
  const toBaseline: string[] = [];

  if (
    schemaExists &&
    alreadyApplied.length === 0
  ) {
    for (const file of pending) {
      const probes =
        BASELINE_MARKERS[kind][file.version];

      if (
        probes &&
        (await allProbesExist(
          db,
          schema,
          probes
        ))
      ) {
        toBaseline.push(file.version);
      }
    }
  }

  const baselineSet = new Set(toBaseline);

  return {
    schema,
    schemaExists,
    trackingTableExists,
    alreadyApplied,
    toBaseline,
    toRun: pending
      .filter(
        (file) =>
          !baselineSet.has(file.version)
      )
      .map((file) => file.version),
  };
}

/* ========================================
   APPLY
======================================== */

export async function applySchemaMigrations(
  pool: MigrationPool,
  options: {
    schema: string;
    kind: MigrationKind;
    files: MigrationFile[];
  }
): Promise<SchemaMigrationResult> {
  const { schema, kind, files } = options;

  const quotedSchema =
    quoteIdentifier(schema);

  /*
   * Tenant schemas are created here; the
   * platform schema is created by its own 001
   * migration, so it is only created if absent
   * (needed to hold schema_migrations before
   * 001 has ever run).
   */
  await pool.query(
    `CREATE SCHEMA IF NOT EXISTS ${quotedSchema}`
  );

  const planBefore =
    await planSchemaMigrations(pool, {
      schema,
      kind,
      files,
    });

  await pool.query(
    `
      CREATE TABLE IF NOT EXISTS ${quotedSchema}.schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `
  );

  const baselined: string[] = [];

  if (planBefore.toBaseline.length > 0) {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      for (const version of planBefore.toBaseline) {
        await client.query(
          `
            INSERT INTO ${quotedSchema}.schema_migrations (version)
            VALUES ($1)
            ON CONFLICT (version) DO NOTHING
          `,
          [version]
        );

        baselined.push(version);
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");

      throw error;
    } finally {
      client.release();
    }
  }

  const baselineSet = new Set(
    planBefore.toBaseline
  );

  const applied: string[] = [];

  for (const file of files) {
    if (
      planBefore.alreadyApplied.includes(
        file.version
      ) ||
      baselineSet.has(file.version)
    ) {
      continue;
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext($1))`,
        [`schema_migrations:${schema}`]
      );

      const already = await client.query(
        `SELECT 1 FROM ${quotedSchema}.schema_migrations WHERE version = $1`,
        [file.version]
      );

      if (already.rows.length === 0) {
        /*
         * Tenant files use unqualified table
         * names; platform files qualify
         * everything with "platform.".
         */
        if (kind === "tenant") {
          await client.query(
            `SET LOCAL search_path TO ${quotedSchema}, public`
          );
        }

        await client.query(file.sql);

        await client.query(
          `INSERT INTO ${quotedSchema}.schema_migrations (version) VALUES ($1)`,
          [file.version]
        );

        applied.push(file.version);
      }

      await client.query("COMMIT");
    } catch (error) {
      await client
        .query("ROLLBACK")
        .catch(() => undefined);

      throw new Error(
        `Migration ${file.version} failed on schema "${schema}" and was rolled back: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`
      );
    } finally {
      client.release();
    }
  }

  return { schema, baselined, applied };
}
