import {
  buildTenantManifest,
  parseTenantManifest,
  type TenantManifest,
} from "../../context/tenant-manifest.js";
import type { StorageAdapter } from "../../services/storage/storage-service.js";
import {
  persistTenantManifest,
  writeManifestStorageCopy,
  type Queryable,
} from "./tenant-manifest-store.js";

/* ========================================
   BACKFILL TENANT MANIFESTS

   For tenants that were provisioned before
   manifests existed. Writes ONLY the manifest
   column (and the storage copy); never
   overwrites a manifest that is already there;
   --dry-run writes nothing. Free of the real
   pool so it can be tested with a fake.
======================================== */

export interface ManifestTenantRow {
  id: string;
  name: string;
  schema_name: string;
  status: string;
  manifest: unknown;
}

export interface ManifestOutcome {
  tenant: ManifestTenantRow;
  manifest?: TenantManifest;
  /* skipped / failed explanation */
  reason?: string;
  /* only for real, successful writes */
  storageCopy?: "written" | "failed";
}

export interface ManifestBackfillSummary {
  dryRun: boolean;
  succeeded: ManifestOutcome[];
  failed: ManifestOutcome[];
  skipped: ManifestOutcome[];
}

const message = (error: unknown): string =>
  error instanceof Error
    ? error.message
    : String(error);

export async function backfillTenantManifests(
  db: Queryable,
  storage: Pick<StorageAdapter, "write">,
  options: {
    dryRun: boolean;
    now?: Date;
    log?: (line: string) => void;
  }
): Promise<ManifestBackfillSummary> {
  const log = options.log ?? (() => undefined);

  let rows: ManifestTenantRow[];

  try {
    rows = (
      await db.query(
        `
          SELECT
            id,
            name,
            schema_name,
            status,
            manifest
          FROM platform.tenants
          ORDER BY created_at ASC
        `
      )
    ).rows as ManifestTenantRow[];
  } catch (error) {
    if (/column "manifest"/i.test(message(error))) {
      throw new Error(
        "platform.tenants.manifest does not exist. Apply platform migration 009 first (run-platform-migration.ts)."
      );
    }

    throw error;
  }

  const summary: ManifestBackfillSummary = {
    dryRun: options.dryRun,
    succeeded: [],
    failed: [],
    skipped: [],
  };

  for (const tenant of rows) {
    const label = `"${tenant.name}" (${tenant.schema_name})`;

    const skip = (reason: string) => {
      summary.skipped.push({ tenant, reason });
      log(`SKIP ${label}: ${reason}`);
    };

    const fail = (reason: string) => {
      summary.failed.push({ tenant, reason });
      log(`FAILED ${label}: ${reason}`);
    };

    if (tenant.status !== "active") {
      skip(`status is "${tenant.status}"`);
      continue;
    }

    /*
     * An existing manifest is never touched. If it
     * is not a valid manifest for this tenant that
     * is reported as a failure (needs a human), not
     * silently skipped and not replaced.
     */
    if (
      tenant.manifest !== null &&
      tenant.manifest !== undefined
    ) {
      try {
        const existing = parseTenantManifest(
          tenant.manifest
        );

        if (
          existing.tenantId !== tenant.id ||
          existing.schemaName !== tenant.schema_name
        ) {
          fail(
            "existing manifest belongs to a different tenant/schema; left unchanged"
          );
        } else {
          skip("already has a manifest");
        }
      } catch (error) {
        fail(
          `existing manifest is invalid and was left unchanged: ${message(error)}`
        );
      }

      continue;
    }

    try {
      const manifest = buildTenantManifest(
        { id: tenant.id, schemaName: tenant.schema_name },
        { now: options.now }
      );

      if (options.dryRun) {
        summary.succeeded.push({ tenant, manifest });
        log(`DRY-RUN ${label}: would write manifest`);
        continue;
      }

      if (!(await persistTenantManifest(db, manifest))) {
        skip("manifest appeared while running; left unchanged");
        continue;
      }

      let storageCopy: "written" | "failed" = "written";

      try {
        await writeManifestStorageCopy(storage, manifest);
      } catch (error) {
        storageCopy = "failed";
        log(
          `WARN ${label}: storage copy failed (database manifest written): ${message(error)}`
        );
      }

      summary.succeeded.push({
        tenant,
        manifest,
        storageCopy,
      });

      log(
        `OK ${label}: manifest written, storage copy ${storageCopy}`
      );
    } catch (error) {
      fail(message(error));
    }
  }

  return summary;
}

export function formatManifestSummary(
  summary: ManifestBackfillSummary
): string {
  const copyFailures = summary.succeeded.filter(
    (o) => o.storageCopy === "failed"
  ).length;

  const lines = [
    `${summary.dryRun ? "Dry run complete (nothing was changed)" : "Manifest backfill complete"}: ${summary.succeeded.length} succeeded, ${summary.failed.length} failed, ${summary.skipped.length} skipped`,
  ];

  if (copyFailures > 0) {
    lines.push(
      `  note: ${copyFailures} storage copies failed (database manifests are written)`
    );
  }

  for (const outcome of summary.failed) {
    lines.push(
      `  failed:  ${outcome.tenant.schema_name} - ${outcome.reason}`
    );
  }

  return lines.join("\n");
}

export function manifestExitCode(
  summary: ManifestBackfillSummary
): number {
  return summary.failed.length > 0 ? 1 : 0;
}
