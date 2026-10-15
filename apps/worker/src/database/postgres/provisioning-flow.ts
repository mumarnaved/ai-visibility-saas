import type { TenantManifest } from "../../context/tenant-manifest.js";
import type { TenantRecord } from "./tenant-registry.js";

/* ========================================
   TENANT PROVISIONING FLOW

   create record -> provision schema -> persist
   manifest -> activate. Any failure marks the
   tenant 'failed' (retried once, so a database
   blip cannot leave it 'provisioning') and then
   rolls back what this attempt created: the
   half-built schema and any manifest copy in
   storage. In particular a tenant is never
   activated unless its manifest was persisted.

   A failed tenant has no workspace (the callers
   create that only after this returns), so it is
   not in anyone's workspace list or website-limit
   count. Dependencies are injected so the ordering
   is testable without the real pool;
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

  /*
   * Removes the schema and storage this attempt created
   * for a tenant that failed. Best effort: its own errors
   * never replace the original one.
   */
  rollbackTenant?(tenant: TenantRecord): Promise<void>;
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
     * Report the original error even if marking
     * the tenant failed, or cleaning up, also fails.
     */
    await deps
      .failTenant(tenant.id)
      .catch(() => deps.failTenant(tenant.id))
      .catch((markError) => {
        console.error(
          `Could not mark tenant ${tenant.id} as failed:`,
          markError
        );
      });

    if (deps.rollbackTenant) {
      await deps
        .rollbackTenant(tenant)
        .catch((rollbackError) => {
          console.error(
            `Could not roll back the partial provisioning of tenant ${tenant.id}:`,
            rollbackError
          );
        });
    }

    throw error;
  }
}
