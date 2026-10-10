import { pool } from "./connection.js";
import {
  applySchemaMigrations,
  loadMigrationFiles,
  tenantMigrationsDirectory,
} from "./migration-runner.js";

/*
 * Creates the tenant schema (if needed) and
 * applies only the tenant-template migrations
 * it has not recorded yet. Safe to call again
 * on an existing schema.
 */
export async function provisionTenantSchema(
  schemaName: string
): Promise<void> {
  const files = await loadMigrationFiles(
    tenantMigrationsDirectory()
  );

  await applySchemaMigrations(pool, {
    schema: schemaName,
    kind: "tenant",
    files,
  });
}
