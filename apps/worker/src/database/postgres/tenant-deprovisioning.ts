import { pool } from "./connection.js";

import {
  revokeCredential,
} from "./credential-vault/credential-vault-service.js";

import {
  storageService,
} from "../../services/storage/storage-service.js";

import {
  tenantNamespaces,
} from "../../context/tenant-manifest.js";

import {
  runTenantDeprovisioning,
} from "./deprovisioning-flow.js";

/* ========================================
   TYPES
======================================== */

export interface DeprovisionedTenant {
  tenantId: string;
  schemaName: string;
}

/* ========================================
   MARK DEPROVISIONED

   The manifest is cleared in the same UPDATE
   that flips the status, as the very last step.
======================================== */

export async function markTenantDeprovisioned(
  db: {
    query(
      sql: string,
      params?: unknown[]
    ): Promise<unknown>;
  },
  tenantId: string
): Promise<void> {
  await db.query(
    `
      UPDATE platform.tenants
      SET
        status = 'deprovisioned',
        manifest = NULL,
        updated_at = NOW()
      WHERE id = $1
    `,
    [tenantId]
  );
}

/* ========================================
   QUOTE IDENTIFIER
======================================== */

function quoteIdentifier(
  identifier: string
): string {
  if (
    !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(
      identifier
    )
  ) {
    throw new Error(
      "Invalid PostgreSQL identifier."
    );
  }

  return `"${identifier}"`;
}

/* ========================================
   SCHEDULE TENANT DEPROVISIONING
======================================== */

export async function scheduleTenantDeprovisioning(
  tenantId: string
): Promise<void> {
  const retentionDays =
    process.env
      .TENANT_RETENTION_DAYS ??
    "30";

  await pool.query(
    `
      UPDATE platform.tenants
      SET
        status = 'deprovisioning',
        deprovision_at =
          NOW() + ($2 || ' days')::interval,
        updated_at = NOW()
      WHERE id = $1
    `,
    [tenantId, retentionDays]
  );
}

/* ========================================
   RUN DUE DEPROVISIONING
======================================== */

export async function runDueDeprovisioning(): Promise<
  DeprovisionedTenant[]
> {
  const dueResult =
    await pool.query<{
      id: string;
      schema_name: string;
    }>(
      `
        SELECT
          id,
          schema_name
        FROM platform.tenants
        WHERE
          status = 'deprovisioning' AND
          deprovision_at <= NOW()
      `
    );

  const torn: DeprovisionedTenant[] =
    [];

  for (const row of dueResult.rows) {
    const tenantId = row.id;
    const schemaName = row.schema_name;

    await runTenantDeprovisioning(
      {
        dropSchema: async (name) => {
          await pool.query(
            `
              DROP SCHEMA IF EXISTS ${quoteIdentifier(
                name
              )} CASCADE
            `
          );
        },

        purgeStorage: async (prefix) => {
          const storedKeys =
            await storageService.list(prefix);

          for (const key of storedKeys) {
            await storageService.delete(key);
          }
        },

        revokeCredentials: async (id) => {
          const credentialResult =
            await pool.query<{
              provider: string;
            }>(
              `
                SELECT provider
                FROM platform.credential_vault
                WHERE tenant_id = $1
              `,
              [id]
            );

          for (const credentialRow of credentialResult.rows) {
            await revokeCredential(
              id,
              credentialRow.provider
            );
          }
        },

        markDeprovisioned: (id) =>
          markTenantDeprovisioned(pool, id),
      },
      {
        tenantId,
        schemaName,
        storagePrefix:
          tenantNamespaces(tenantId)
            .storagePrefix,
      }
    );

    torn.push({
      tenantId,
      schemaName,
    });
  }

  return torn;
}
