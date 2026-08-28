import { randomBytes, randomUUID } from "node:crypto";

import { pool } from "./connection.js";

export interface TenantRecord {
  id: string;
  slug: string;
  name: string;
  websiteUrl: string | null;
  schemaName: string;
  status: string;
  plan: string;
  verificationToken: string | null;
  domainVerifiedAt: string | null;
}

export type ScanStatus =
  | "not_started"
  | "auditing"
  | "planning"
  | "ready"
  | "failed";

/* ========================================
   CREATE SCHEMA NAME
======================================== */

function createSchemaName(
  tenantId: string
): string {
  return `tenant_${tenantId.replaceAll(
    "-",
    ""
  )}`;
}

/* ========================================
   NORMALIZE TENANT RECORD

   pg returns TIMESTAMPTZ columns as Date
   objects, not strings.
======================================== */

function normalizeTenantRecord(
  row: Omit<
    TenantRecord,
    "domainVerifiedAt"
  > & {
    domainVerifiedAt: Date | string | null;
  }
): TenantRecord {
  return {
    ...row,
    domainVerifiedAt:
      row.domainVerifiedAt instanceof Date
        ? row.domainVerifiedAt.toISOString()
        : row.domainVerifiedAt,
  };
}

/* ========================================
   CREATE TENANT
======================================== */

export async function createTenantRecord(
  name: string,
  slug: string,
  websiteUrl: string
): Promise<TenantRecord> {
  const id = randomUUID();

  const schemaName =
    createSchemaName(id);

  const verificationToken =
    randomBytes(16).toString("hex");

  const result =
    await pool.query<TenantRecord>(
      `
        INSERT INTO platform.tenants (
          id,
          slug,
          name,
          website_url,
          schema_name,
          status,
          plan,
          verification_token
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          'provisioning',
          'starter',
          $6
        )
        RETURNING
          id,
          slug,
          name,
          website_url AS "websiteUrl",
          schema_name AS "schemaName",
          status,
          plan,
          verification_token AS "verificationToken",
          domain_verified_at AS "domainVerifiedAt"
      `,
      [
        id,
        slug,
        name,
        websiteUrl,
        schemaName,
        verificationToken,
      ]
    );

  const tenant =
    result.rows[0];

  if (!tenant) {
    throw new Error(
      "Tenant record was not created."
    );
  }

  return normalizeTenantRecord(tenant);
}

/* ========================================
   GET TENANT
======================================== */

export async function getTenantById(
  tenantId: string
): Promise<TenantRecord | null> {
  const result =
    await pool.query<TenantRecord>(
      `
        SELECT
          id,
          slug,
          name,
          website_url AS "websiteUrl",
          schema_name AS "schemaName",
          status,
          plan,
          verification_token AS "verificationToken",
          domain_verified_at AS "domainVerifiedAt"
        FROM platform.tenants
        WHERE id = $1
        LIMIT 1
      `,
      [tenantId]
    );

  const tenant =
    result.rows[0];

  return tenant
    ? normalizeTenantRecord(tenant)
    : null;
}

/* ========================================
   VERIFY TENANT DOMAIN
======================================== */

export async function markDomainVerified(
  tenantId: string
): Promise<void> {
  await pool.query(
    `
      UPDATE platform.tenants
      SET
        domain_verified_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
    `,
    [tenantId]
  );
}

/* ========================================
   SET SCAN STATUS

   Tracks the automatic Stage 1 + Stage 2
   scan that runs right after a tenant's
   domain is verified, so the Overview page
   can show a progress state without a job
   queue - just a status column it polls.
======================================== */

export async function setScanStatus(
  tenantId: string,
  status: ScanStatus,
  error?: string | null
): Promise<void> {
  await pool.query(
    `
      UPDATE platform.tenants
      SET
        scan_status = $2,
        scan_error = $3,
        updated_at = NOW()
      WHERE id = $1
    `,
    [tenantId, status, error ?? null]
  );
}

/* ========================================
   ACTIVATE TENANT
======================================== */

export async function activateTenant(
  tenantId: string
): Promise<void> {
  await pool.query(
    `
      UPDATE platform.tenants
      SET
        status = 'active',
        updated_at = NOW()
      WHERE id = $1
    `,
    [tenantId]
  );
}

/* ========================================
   FAIL TENANT
======================================== */

export async function failTenant(
  tenantId: string
): Promise<void> {
  await pool.query(
    `
      UPDATE platform.tenants
      SET
        status = 'failed',
        updated_at = NOW()
      WHERE id = $1
    `,
    [tenantId]
  );
}