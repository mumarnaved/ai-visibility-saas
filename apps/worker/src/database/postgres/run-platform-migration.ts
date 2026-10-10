import "dotenv/config";

import { pool } from "./connection.js";
import {
  migratePlatform,
  parseDryRunFlag,
} from "./migration-commands.js";
import {
  loadMigrationFiles,
  platformMigrationsDirectory,
} from "./migration-runner.js";

/*
 * Applies unapplied platform migrations,
 * tracked in platform.schema_migrations.
 *
 *   npx tsx src/database/postgres/run-platform-migration.ts [--dry-run]
 */

try {
  const dryRun = parseDryRunFlag(
    process.argv.slice(2)
  );

  const files = await loadMigrationFiles(
    platformMigrationsDirectory()
  );

  await migratePlatform(pool, {
    files,
    dryRun,
    log: (line) => console.log(line),
  });

  console.log(
    dryRun
      ? "Dry run complete (nothing was changed)."
      : "All platform migrations completed successfully."
  );
} catch (error) {
  console.error("Platform migrations FAILED");

  console.error(
    error instanceof Error
      ? error.message
      : error
  );

  process.exitCode = 1;
} finally {
  await pool.end();
}
