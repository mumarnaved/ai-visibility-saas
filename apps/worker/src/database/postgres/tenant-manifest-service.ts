import type { TenantManifest } from "../../context/tenant-manifest.js";
import { storageService } from "../../services/storage/storage-service.js";
import { pool } from "./connection.js";
import { ensureTenantManifest } from "./tenant-manifest-store.js";

/*
 * The real-pool, real-storage binding used by
 * provisionTenant() and the Provisioning Agent.
 */
export function persistTenantManifestWithCopy(
  manifest: TenantManifest
): Promise<TenantManifest> {
  return ensureTenantManifest(
    pool,
    storageService,
    manifest
  );
}
