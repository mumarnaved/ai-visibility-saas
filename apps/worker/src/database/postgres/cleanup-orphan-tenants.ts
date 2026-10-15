import "dotenv/config";

import { pool } from "./connection.js";
import {
  deprovisionApproved,
  findOrphanCandidates,
} from "./orphan-tenant-commands.js";
import { scheduleTenantDeprovisioning } from "./tenant-deprovisioning.js";

/*
 * One-off cleanup of orphaned tenants, in two phases.
 *
 *   Phase 1 (read only, the default):
 *     npx tsx src/database/postgres/cleanup-orphan-tenants.ts
 *
 *   Phase 2, after reviewing the list. Without --confirm
 *   it only previews; with it, it runs the existing
 *   deprovisioning flow (recoverable until the purge cron
 *   runs, TENANT_RETENTION_DAYS later) on EXACTLY these ids:
 *     npx tsx src/database/postgres/cleanup-orphan-tenants.ts \
 *       --deprovision <id>,<id> [--confirm]
 *
 * Any id that is not a current orphan candidate is refused
 * and nothing is touched.
 */

function parseArgs(argv: string[]) {
  const args = argv.filter((arg) => arg !== "--");
  let ids: string[] | null = null;
  let confirm = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--confirm") {
      confirm = true;
    } else if (arg === "--deprovision") {
      const value = args[++i];

      if (!value || value.startsWith("--")) {
        throw new Error("--deprovision needs a comma-separated list of ids.");
      }

      ids = value.split(",");
    } else if (arg.startsWith("--deprovision=")) {
      ids = arg.slice("--deprovision=".length).split(",");
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (confirm && !ids) {
    throw new Error("--confirm only makes sense together with --deprovision.");
  }

  return { ids, confirm };
}

try {
  const { ids, confirm } = parseArgs(process.argv.slice(2));

  if (!ids) {
    const candidates = await findOrphanCandidates(pool);

    if (candidates.length === 0) {
      console.log("No orphan candidates found.");
    } else {
      console.table(
        candidates.map((c) => ({
          name: c.name,
          slug: c.slug,
          id: c.id,
          status: c.status,
          created: c.createdAt.toISOString().slice(0, 16),
          reasons: c.reasons.join(", "),
          members: c.members.join(", ") || "-",
          flag: c.belongsToAnotherAccount ? "ANOTHER ACCOUNT'S" : "",
        }))
      );

      console.log(
        `${candidates.length} candidate(s). Nothing was changed. To act, re-run with --deprovision <ids> (and --confirm).`
      );
    }
  } else {
    const outcome = await deprovisionApproved(pool, ids, {
      schedule: scheduleTenantDeprovisioning,
      dryRun: !confirm,
      log: (line) => console.log(line),
    });

    for (const refusal of outcome.refused) {
      console.error(`REFUSED ${refusal.id}: ${refusal.why}`);
    }

    if (outcome.refused.length > 0) {
      console.error("Nothing was changed (one or more ids were refused).");
      process.exitCode = 1;
    } else if (outcome.dryRun) {
      console.log(
        `Preview only (${outcome.scheduled.length} tenant(s)). Add --confirm to run it.`
      );
    } else {
      console.log(
        `Done: ${outcome.scheduled.length} tenant(s) scheduled. Data stays recoverable until the purge cron runs after TENANT_RETENTION_DAYS (default 30).`
      );
    }
  }
} catch (error) {
  console.error(
    "Orphan cleanup FAILED:",
    error instanceof Error ? error.message : error
  );

  process.exitCode = 1;
} finally {
  await pool.end();
}
