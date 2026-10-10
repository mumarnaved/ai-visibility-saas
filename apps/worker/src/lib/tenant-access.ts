import { pool } from "../database/postgres/connection.js";

/*
 * True when userId belongs to the tenant via
 * platform.workspace_members. tenant_id is compared
 * as text so a malformed ID matches nothing
 * instead of raising a uuid cast error.
 */
export async function userHasTenantAccess(
  userId: string,
  tenantId: string
): Promise<boolean> {
  const membership = await pool.query(
    `
      SELECT 1
      FROM platform.workspaces w
      JOIN platform.workspace_members wm
        ON wm.workspace_id = w.id
      WHERE w.tenant_id::text = $1
        AND wm.user_id = $2
      LIMIT 1
    `,
    [tenantId, userId]
  );

  return membership.rows.length > 0;
}
