import { buildTenantManifest } from "../../context/tenant-manifest.js";

import {
  runTenantProvisioning,
  type ProvisionedTenant,
  type TenantProvisioningRequest,
} from "./provisioning-flow.js";

import {
  createTenantRecord,
  activateTenant,
  failTenant,
} from "./tenant-registry.js";

import {
  provisionTenantSchema,
} from "./tenant-schema-provisioner.js";

import {
  persistTenantManifestWithCopy,
} from "./tenant-manifest-service.js";

export type { TenantProvisioningRequest };

/*
 * Same call as before; the result is the
 * TenantRecord plus the persisted manifest.
 */
export async function provisionTenant(
  request: TenantProvisioningRequest
): Promise<ProvisionedTenant> {
  return runTenantProvisioning(
    {
      createTenantRecord,
      provisionTenantSchema,
      persistManifest: (tenant) =>
        persistTenantManifestWithCopy(
          buildTenantManifest({
            id: tenant.id,
            schemaName: tenant.schemaName,
          })
        ),
      activateTenant,
      failTenant,
    },
    request
  );
}
