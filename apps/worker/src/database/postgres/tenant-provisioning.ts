import {
  buildTenantManifest,
  tenantNamespaces,
} from "../../context/tenant-manifest.js";

import { pool } from "./connection.js";

import { storageService } from "../../services/storage/storage-service.js";

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
 * Undo what a FAILED provisioning attempt created for this
 * tenant: the half-migrated schema and any manifest copy in
 * storage. Both are brand new (named after a fresh tenant id),
 * so nothing else can be using them. The tenant row stays,
 * marked 'failed', as the record of the attempt.
 */
export async function rollbackProvisioning(
  tenant: { id: string; schemaName: string },
  deps: {
    dropSchema(schemaName: string): Promise<void>;
    purgeStorage(prefix: string): Promise<void>;
  } = {
    dropSchema: async (schemaName) => {
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schemaName)) {
        throw new Error("Invalid PostgreSQL identifier.");
      }

      await pool.query(
        `DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`
      );
    },

    purgeStorage: async (prefix) => {
      for (const key of await storageService.list(prefix)) {
        await storageService.delete(key);
      }
    },
  }
): Promise<void> {
  const errors: unknown[] = [];

  for (const step of [
    () => deps.dropSchema(tenant.schemaName),
    () =>
      deps.purgeStorage(
        tenantNamespaces(tenant.id).storagePrefix
      ),
  ]) {
    try {
      await step();
    } catch (error) {
      errors.push(error);
    }
  }

  if (errors.length > 0) {
    throw new AggregateError(
      errors,
      `Rollback of tenant ${tenant.id} was incomplete.`
    );
  }
}

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
      rollbackTenant: rollbackProvisioning,
    },
    request
  );
}
