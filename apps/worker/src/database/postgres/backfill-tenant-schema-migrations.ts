import "dotenv/config";

import { pool } from "./connection.js";
import { provisionTenantSchema } from "./tenant-schema-provisioner.js";

/* ========================================
   BACKFILL TENANT SCHEMA MIGRATIONS

   provisionTenantSchema() re-runs every
   file in database/tenant-template/migrations
   against one tenant schema. Every statement
   in those files is CREATE TABLE/INDEX IF NOT
   EXISTS, so re-running them against a schema
   that was provisioned before a table (e.g.
   execution_tasks/publish_logs) existed just
   creates what is missing and leaves
   everything else untouched.

   Run with:
     npx tsx src/database/postgres/backfill-tenant-schema-migrations.ts
======================================== */

try {
  const tenants = await pool.query<{
    id: string;
    name: string;
    schema_name: string;
  }>(
    `
      SELECT
        id,
        name,
        schema_name
      FROM platform.tenants
      ORDER BY created_at ASC
    `
  );

  if (tenants.rows.length === 0) {
    console.log("No tenants found.");
  }

  for (const tenant of tenants.rows) {
    console.log(
      `Backfilling schema "${tenant.schema_name}" (tenant "${tenant.name}", ${tenant.id})...`
    );

    await provisionTenantSchema(
      tenant.schema_name
    );

    console.log(
      `Backfilled schema "${tenant.schema_name}": OK`
    );
  }

  console.log(
    "All tenant schemas backfilled successfully."
  );
} catch (error) {
  console.error(
    "Tenant schema backfill FAILED"
  );

  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
} finally {
  await pool.end();
}
