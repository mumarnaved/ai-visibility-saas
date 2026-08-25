import {
  createTenantRecord,
  activateTenant,
  failTenant,
  type TenantRecord,
} from "./tenant-registry.js";

import {
  provisionTenantSchema,
} from "./tenant-schema-provisioner.js";

export interface TenantProvisioningRequest {
  name: string;
  slug: string;
  websiteUrl: string;
}

export async function provisionTenant(
  request: TenantProvisioningRequest
): Promise<TenantRecord> {
  const tenant = await createTenantRecord(
    request.name,
    request.slug,
    request.websiteUrl
  );

  try {
    await provisionTenantSchema(
      tenant.schemaName
    );

    await activateTenant(tenant.id);

    return {
      ...tenant,
      status: "active",
    };
  } catch (error) {
    await failTenant(tenant.id);

    throw error;
  }
}