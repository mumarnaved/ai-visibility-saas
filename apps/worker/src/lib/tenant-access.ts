import { pool } from "../database/postgres/connection.js";

import { LIVE_TENANT_SQL } from "./tenant-status.js";

/*
 * True when userId belongs to the tenant via
 * platform.workspace_members. tenant_id is compared
 * as text so a malformed ID matches nothing
 * instead of raising a uuid cast error. A deleted
 * (deprovisioning/deprovisioned) tenant has no
 * members as far as the API is concerned, so its
 * routes answer 404 like any tenant the caller
 * cannot see.
 */
export async function userHasTenantAccess(
  userId: string,
  tenantId: string
): Promise<boolean> {
  const membership = await pool.query(
    `
      SELECT 1
      FROM platform.workspaces w
      JOIN platform.tenants t
        ON t.id = w.tenant_id
      JOIN platform.workspace_members wm
        ON wm.workspace_id = w.id
      WHERE w.tenant_id::text = $1
        AND wm.user_id = $2
        AND ${LIVE_TENANT_SQL}
      LIMIT 1
    `,
    [tenantId, userId]
  );

  return membership.rows.length > 0;
}
