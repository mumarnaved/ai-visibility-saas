import type { TenantManifest } from "../../context/tenant-manifest.js";
import type { TenantRecord } from "./tenant-registry.js";

/* ========================================
   TENANT PROVISIONING FLOW

   create record -> provision schema -> persist
   manifest -> activate. Any failure marks the
   tenant 'failed'; in particular a tenant is
   never activated unless its manifest was
   persisted. Dependencies are injected so the
   ordering is testable without the real pool;
   tenant-provisioning.ts wires the real ones.
======================================== */

export interface TenantProvisioningRequest {
  name: string;
  slug: string;
  websiteUrl: string;
}

export interface ProvisioningFlowDeps {
  createTenantRecord(
    name: string,
    slug: string,
    websiteUrl: string
  ): Promise<TenantRecord>;

  provisionTenantSchema(
    schemaName: string
  ): Promise<void>;

  persistManifest(
    tenant: TenantRecord
  ): Promise<TenantManifest>;

  activateTenant(tenantId: string): Promise<void>;

  failTenant(tenantId: string): Promise<void>;
}

export type ProvisionedTenant = TenantRecord & {
  manifest: TenantManifest;
};

export async function runTenantProvisioning(
  deps: ProvisioningFlowDeps,
  request: TenantProvisioningRequest
): Promise<ProvisionedTenant> {
  const tenant = await deps.createTenantRecord(
    request.name,
    request.slug,
    request.websiteUrl
  );

  try {
    await deps.provisionTenantSchema(
      tenant.schemaName
    );

    const manifest =
      await deps.persistManifest(tenant);

    await deps.activateTenant(tenant.id);

    return {
      ...tenant,
      status: "active",
      manifest,
    };
  } catch (error) {
    /*
     * Report the original error even if
     * marking the tenant failed also fails.
     */
    await deps
      .failTenant(tenant.id)
      .catch(() => undefined);

    throw error;
  }
}
