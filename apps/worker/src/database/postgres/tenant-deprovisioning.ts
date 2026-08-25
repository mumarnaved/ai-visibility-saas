import { pool } from "./connection.js";

import {
  revokeCredential,
} from "./credential-vault/credential-vault-service.js";

import {
  storageService,
} from "../../services/storage/storage-service.js";

/* ========================================
   TYPES
======================================== */

export interface DeprovisionedTenant {
  tenantId: string;
  schemaName: string;
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

    /*
     * The storage prefix is derived the
     * same deterministic way the Stage 1
     * audit route builds it.
     */
    const storagePrefix =
      `tenant-${tenantId}`;

    await pool.query(
      `
        DROP SCHEMA IF EXISTS ${quoteIdentifier(
          schemaName
        )} CASCADE
      `
    );

    const storedKeys =
      await storageService.list(
        storagePrefix
      );

    for (const key of storedKeys) {
      await storageService.delete(key);
    }

    const credentialResult =
      await pool.query<{
        provider: string;
      }>(
        `
          SELECT provider
          FROM platform.credential_vault
          WHERE tenant_id = $1
        `,
        [tenantId]
      );

    for (const credentialRow of credentialResult.rows) {
      await revokeCredential(
        tenantId,
        credentialRow.provider
      );
    }

    await pool.query(
      `
        UPDATE platform.tenants
        SET
          status = 'deprovisioned',
          updated_at = NOW()
        WHERE id = $1
      `,
      [tenantId]
    );

    torn.push({
      tenantId,
      schemaName,
    });
  }

  return torn;
}
