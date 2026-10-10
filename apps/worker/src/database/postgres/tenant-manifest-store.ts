import {
  manifestStorageKey,
  parseTenantManifest,
  serializeTenantManifest,
  type TenantManifest,
} from "../../context/tenant-manifest.js";
import type { StorageAdapter } from "../../services/storage/storage-service.js";

/* ========================================
   TENANT MANIFEST STORE

   Reads/writes platform.tenants.manifest (the
   source of truth) and the tenant_manifest.json
   convenience copy. Takes the db and storage as
   arguments, so it never imports the real pool
   and can be tested with fakes.
======================================== */

export interface Queryable {
  query(
    sql: string,
    params?: unknown[]
  ): Promise<{ rows: any[] }>;
}

/*
 * Writes only when the tenant has no manifest
 * yet (manifest IS NULL), in one statement, so
 * an existing manifest is never overwritten and
 * two writers cannot both win. Touches nothing
 * but the manifest column.
 *
 * Returns true if this call wrote it.
 */
export async function persistTenantManifest(
  db: Queryable,
  manifest: TenantManifest
): Promise<boolean> {
  const result = await db.query(
    `
      UPDATE platform.tenants
      SET manifest = $2::jsonb
      WHERE id = $1
        AND manifest IS NULL
      RETURNING id
    `,
    [manifest.tenantId, JSON.stringify(manifest)]
  );

  return result.rows.length > 0;
}

/*
 * Returns the tenant's validated manifest, or
 * null when it has none yet. Throws if the
 * tenant does not exist, or if the stored value
 * is not a valid manifest.
 */
export async function readTenantManifest(
  db: Queryable,
  tenantId: string
): Promise<TenantManifest | null> {
  const result = await db.query(
    `SELECT manifest FROM platform.tenants WHERE id = $1`,
    [tenantId]
  );

  const row = result.rows[0];

  if (!row) {
    throw new Error(
      `Tenant ${tenantId} does not exist.`
    );
  }

  return row.manifest === null ||
    row.manifest === undefined
    ? null
    : parseTenantManifest(row.manifest);
}

/*
 * Convenience copy under the tenant's storage
 * prefix. Not the source of truth.
 */
export async function writeManifestStorageCopy(
  storage: Pick<StorageAdapter, "write">,
  manifest: TenantManifest
): Promise<void> {
  await storage.write(
    manifestStorageKey(manifest),
    serializeTenantManifest(manifest)
  );
}

/*
 * Provisioning path. Persists the manifest to
 * the database (a failure here is fatal and
 * propagates), then writes the storage copy.
 * The copy is best-effort: the local-filesystem
 * adapter can be unwritable on serverless hosts,
 * and the database column is what other code
 * reads, so a failed copy must not fail
 * provisioning.
 *
 * If the tenant already has a manifest it is
 * kept and returned unchanged.
 */
export async function ensureTenantManifest(
  db: Queryable,
  storage: Pick<StorageAdapter, "write">,
  manifest: TenantManifest,
  warn: (message: string) => void = console.warn
): Promise<TenantManifest> {
  let stored = manifest;

  if (!(await persistTenantManifest(db, manifest))) {
    const existing = await readTenantManifest(
      db,
      manifest.tenantId
    );

    if (!existing) {
      throw new Error(
        `Manifest for tenant ${manifest.tenantId} could not be persisted.`
      );
    }

    if (existing.schemaName !== manifest.schemaName) {
      throw new Error(
        `Tenant ${manifest.tenantId} already has a manifest for schema "${existing.schemaName}", not "${manifest.schemaName}".`
      );
    }

    stored = existing;
  }

  try {
    await writeManifestStorageCopy(storage, stored);
  } catch (error) {
    warn(
      `Tenant manifest storage copy failed for ${stored.tenantId} (database copy is intact): ${
        error instanceof Error
          ? error.message
          : String(error)
      }`
    );
  }

  return stored;
}
