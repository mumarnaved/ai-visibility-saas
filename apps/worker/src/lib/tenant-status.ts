/* ========================================
   TENANT STATUS: DELETED vs LIVE

   Deleting a workspace schedules the existing
   deprovisioning flow: status becomes
   'deprovisioning' immediately (data stays
   recoverable until the purge cron drops it after
   TENANT_RETENTION_DAYS) and 'deprovisioned' once
   purged. From the user's side both mean "gone":
   they are hidden from the workspace list, do not
   count toward the plan's website limit, cannot be
   logged into, and every /api/tenants/:tenantId/*
   route answers 404 for them.

   Every query that lists, counts or authorises
   tenants for a user shares this one definition.
======================================== */

export const DELETED_TENANT_STATUSES = [
  "deprovisioning",
  "deprovisioned",
] as const;

export const isDeletedTenantStatus = (
  status: string
): boolean =>
  (DELETED_TENANT_STATUSES as readonly string[]).includes(
    status
  );

/* SQL predicate for a tenants row aliased as `t`. */
export const LIVE_TENANT_SQL =
  "t.status NOT IN ('deprovisioning', 'deprovisioned')";
