import type express from "express";

import { pool } from "../database/postgres/connection.js";
import { scheduleTenantDeprovisioning } from "../database/postgres/tenant-deprovisioning.js";
import type { AuthenticatedRequest } from "../auth/auth-middleware.js";
import { isDeletedTenantStatus } from "../lib/tenant-status.js";

/* ========================================
   DELETE WORKSPACE

   DELETE /api/tenants/:tenantId

   Runs behind requireAuth and requireTenantAccess
   (a caller who is not a member of a live workspace
   gets 404 before this runs). It then requires:

   - the caller to be the workspace OWNER (403
     otherwise), and
   - the workspace SLUG in the body as confirmation
     ({ "confirmSlug": "..." }). The slug is unique
     per tenant, so unlike the name it cannot
     confirm the wrong one of two same-named
     workspaces.

   It does not delete anything itself. It starts the
   existing deprovisioning flow
   (scheduleTenantDeprovisioning): the tenant becomes
   'deprovisioning' now and its schema, storage and
   credentials are only purged by the cron after
   TENANT_RETENTION_DAYS, so the data is recoverable
   until then. A deprovisioning tenant is hidden from
   the workspace list, ignored by the website-limit
   count, and 404s on every tenant route.
======================================== */

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  schema_name: string;
  status: string;
  role: string;
}

function retentionDays(): string {
  return process.env.TENANT_RETENTION_DAYS ?? "30";
}

export async function deleteWorkspace(
  req: AuthenticatedRequest,
  res: express.Response
): Promise<express.Response> {
  try {
    const userId = req.auth?.user.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required.",
      });
    }

    const tenantId =
      typeof req.params.tenantId === "string"
        ? req.params.tenantId.trim()
        : "";

    /* The caller's own membership, with their role. */
    const found = await pool.query<TenantRow>(
      `
        SELECT
          t.id,
          t.name,
          t.slug,
          t.schema_name,
          t.status,
          wm.role
        FROM platform.tenants t
        JOIN platform.workspaces w
          ON w.tenant_id = t.id
        JOIN platform.workspace_members wm
          ON wm.workspace_id = w.id
        WHERE t.id::text = $1
          AND wm.user_id = $2
        LIMIT 1
      `,
      [tenantId, userId]
    );

    const tenant = found.rows[0];

    if (!tenant || isDeletedTenantStatus(tenant.status)) {
      return res.status(404).json({
        success: false,
        error: "Tenant not found.",
      });
    }

    if (tenant.role !== "owner") {
      return res.status(403).json({
        success: false,
        error: "Only the workspace owner can delete it.",
      });
    }

    const confirmSlug =
      typeof req.body?.confirmSlug === "string"
        ? req.body.confirmSlug.trim()
        : "";

    if (confirmSlug !== tenant.slug) {
      return res.status(400).json({
        success: false,
        code: "confirmation_mismatch",
        error:
          "Type the workspace slug exactly to confirm deletion.",
      });
    }

    /* The existing deprovisioning flow: nothing is purged here. */
    await scheduleTenantDeprovisioning(tenant.id);

    const scheduled = await pool.query<{
      deprovision_at: Date | string | null;
    }>(
      `
        SELECT deprovision_at
        FROM platform.tenants
        WHERE id = $1
        LIMIT 1
      `,
      [tenant.id]
    );

    const deprovisionAt =
      scheduled.rows[0]?.deprovision_at ?? null;

    await writeAuditLine({
      actorId: userId,
      actorEmail: req.auth?.user.email ?? null,
      tenant,
      deprovisionAt,
    });

    return res.json({
      success: true,
      data: {
        tenantId: tenant.id,
        status: "deprovisioning",
        deprovisionAt,
        retentionDays: Number(retentionDays()),
      },
      metadata: {
        operation: "delete-workspace",
      },
    });
  } catch (error) {
    console.error("Failed to delete workspace:", error);

    return res.status(500).json({
      success: false,
      error: "Failed to delete workspace.",
    });
  }
}

/* ========================================
   AUDIT LOG

   One structured line in the function logs (always),
   and a row in the tenant's own audit_logs table
   (best effort: it lives in the tenant schema, which
   stays until the purge, and it must never block or
   fail the deletion).
======================================== */

async function writeAuditLine(entry: {
  actorId: string;
  actorEmail: string | null;
  tenant: TenantRow;
  deprovisionAt: Date | string | null;
}): Promise<void> {
  const metadata = {
    tenantId: entry.tenant.id,
    slug: entry.tenant.slug,
    name: entry.tenant.name,
    previousStatus: entry.tenant.status,
    actorEmail: entry.actorEmail,
    retentionDays: Number(retentionDays()),
    deprovisionAt: entry.deprovisionAt,
  };

  console.log(
    JSON.stringify({
      audit: "workspace.delete_requested",
      actorId: entry.actorId,
      at: new Date().toISOString(),
      ...metadata,
    })
  );

  try {
    if (!/^[a-z_][a-z0-9_]*$/.test(entry.tenant.schema_name)) {
      return;
    }

    await pool.query(
      `
        INSERT INTO "${entry.tenant.schema_name}".audit_logs
          (id, actor_id, action, metadata)
        VALUES
          (gen_random_uuid(), $1, 'workspace.delete_requested', $2::jsonb)
      `,
      [entry.actorId, JSON.stringify(metadata)]
    );
  } catch (error) {
    console.warn(
      "Could not write the tenant audit_logs row for the workspace deletion:",
      error instanceof Error ? error.message : error
    );
  }
}
