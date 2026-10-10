import { z } from "zod";

/* ========================================
   TENANT MANIFEST

   The map of one tenant's isolated system:
   which schema, storage prefix, credential
   namespace and vector namespace belong to
   it. platform.tenants.manifest is the source
   of truth; tenant_manifest.json under the
   storage prefix is only a convenience copy.

   This is the ONE place that builds the
   manifest's names. The values are the ones
   the code already uses today (see
   buildTenantContext in server.ts and
   automatic-scan.ts, and the storage prefix in
   tenant-deprovisioning.ts):

     storagePrefix        tenant-<id>
     credentialNamespace  credentials/tenant-<id>
     vectorNamespace      vector-tenant-<id>

   The vault itself is keyed by
   (tenant_id, provider) and filled lazily when
   a tenant connects something, so the manifest
   only records the namespace, never secrets.
======================================== */

export const TENANT_MANIFEST_VERSION = 1;

export const TENANT_MANIFEST_FILENAME =
  "tenant_manifest.json";

export function tenantNamespaces(
  tenantId: string
): {
  storagePrefix: string;
  credentialNamespace: string;
  vectorNamespace: string;
} {
  return {
    storagePrefix: `tenant-${tenantId}`,
    credentialNamespace: `credentials/tenant-${tenantId}`,
    vectorNamespace: `vector-tenant-${tenantId}`,
  };
}

/*
 * The tenant id ends up inside a storage path,
 * so it is restricted to characters that cannot
 * climb out of the prefix.
 */
const TENANT_ID = /^[A-Za-z0-9_-]+$/;

const SCHEMA_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const tenantManifestSchema = z
  .strictObject({
    manifestVersion: z.literal(
      TENANT_MANIFEST_VERSION
    ),
    tenantId: z.string().regex(TENANT_ID),
    schemaName: z.string().regex(SCHEMA_NAME),
    storagePrefix: z.string().min(1),
    credentialNamespace: z.string().min(1),
    vectorNamespace: z.string().min(1),
    createdAt: z.iso.datetime(),
  })
  .superRefine((manifest, ctx) => {
    /*
     * A manifest pointing at another tenant's
     * prefix would be an isolation hole, so the
     * three names must be exactly this tenant's.
     */
    const expected = tenantNamespaces(
      manifest.tenantId
    );

    for (const key of [
      "storagePrefix",
      "credentialNamespace",
      "vectorNamespace",
    ] as const) {
      if (manifest[key] !== expected[key]) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `${key} must be "${expected[key]}" for tenant ${manifest.tenantId}`,
        });
      }
    }
  });

export type TenantManifest = z.infer<
  typeof tenantManifestSchema
>;

/* ========================================
   BUILD (from a tenant row)
======================================== */

export function buildTenantManifest(
  tenant: { id: string; schemaName: string },
  options: { now?: Date } = {}
): TenantManifest {
  return tenantManifestSchema.parse({
    manifestVersion: TENANT_MANIFEST_VERSION,
    tenantId: tenant.id,
    schemaName: tenant.schemaName,
    ...tenantNamespaces(tenant.id),
    createdAt: (
      options.now ?? new Date()
    ).toISOString(),
  });
}

/* ========================================
   VALIDATE (on read)
======================================== */

export function parseTenantManifest(
  value: unknown
): TenantManifest {
  return tenantManifestSchema.parse(value);
}

/* ========================================
   STORAGE COPY
======================================== */

export function manifestStorageKey(
  manifest: Pick<TenantManifest, "storagePrefix">
): string {
  return `${manifest.storagePrefix}/${TENANT_MANIFEST_FILENAME}`;
}

export function serializeTenantManifest(
  manifest: TenantManifest
): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
