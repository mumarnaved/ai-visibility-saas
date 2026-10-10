import "dotenv/config";

import { storageService } from "../../services/storage/storage-service.js";
import { pool } from "./connection.js";
import { parseDryRunFlag } from "./migration-commands.js";
import {
  backfillTenantManifests,
  formatManifestSummary,
  manifestExitCode,
} from "./tenant-manifest-commands.js";

/* ========================================
   BACKFILL TENANT MANIFESTS

   Writes platform.tenants.manifest (and the
   tenant_manifest.json storage copy) for active
   tenants that do not have one. Never overwrites.
   Needs platform migration 009 applied first.

     pnpm --filter worker backfill:manifests --dry-run
     pnpm --filter worker backfill:manifests

   (a "--" before --dry-run is also accepted)
======================================== */

try {
  const dryRun = parseDryRunFlag(
    process.argv.slice(2)
  );

  const summary = await backfillTenantManifests(
    pool,
    storageService,
    { dryRun, log: (line) => console.log(line) }
  );

  console.log(formatManifestSummary(summary));

  process.exitCode = manifestExitCode(summary);
} catch (error) {
  console.error("Tenant manifest backfill FAILED");

  console.error(
    error instanceof Error ? error.message : error
  );

  process.exitCode = 1;
} finally {
  await pool.end();
}
