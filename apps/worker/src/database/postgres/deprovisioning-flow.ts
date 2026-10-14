/* ========================================
   TENANT DEPROVISIONING FLOW

   drop schema -> purge storage -> revoke
   credentials -> mark deprovisioned. The last
   step also clears platform.tenants.manifest,
   so the manifest (the map of what still has to
   be torn down) survives any failure midway.
   Dependencies are injected so the ordering is
   testable without the real pool;
   tenant-deprovisioning.ts wires the real ones.
======================================== */

export interface DeprovisioningFlowDeps {
  dropSchema(schemaName: string): Promise<void>;

  purgeStorage(storagePrefix: string): Promise<void>;

  revokeCredentials(tenantId: string): Promise<void>;

  markDeprovisioned(tenantId: string): Promise<void>;
}

export async function runTenantDeprovisioning(
  deps: DeprovisioningFlowDeps,
  tenant: {
    tenantId: string;
    schemaName: string;
    storagePrefix: string;
  }
): Promise<void> {
  await deps.dropSchema(tenant.schemaName);

  await deps.purgeStorage(tenant.storagePrefix);

  await deps.revokeCredentials(tenant.tenantId);

  await deps.markDeprovisioned(tenant.tenantId);
}
