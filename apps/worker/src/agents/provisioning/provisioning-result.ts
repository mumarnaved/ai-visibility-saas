import type { TenantManifest } from "../../context/tenant-manifest.js";

export interface ProvisioningResult {
  tenantId: string;
  schemaName: string;
  storagePrefix: string;
  credentialNamespace: string;
  vectorNamespace: string;
  manifest: TenantManifest;
}
