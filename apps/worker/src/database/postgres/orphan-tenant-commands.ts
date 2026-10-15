/* ========================================
   ORPHAN TENANT CLEANUP (logic)

   One-off tooling for tenants nobody can reach or
   use any more. Two phases, kept apart on purpose:

   1. findOrphanCandidates(): READ ONLY. Lists what
      looks abandoned, with the reason and a flag when
      the tenant belongs to another account.
   2. deprovisionApproved(): runs the EXISTING
      deprovisioning flow (scheduleTenantDeprovisioning:
      status 'deprovisioning', purged by the cron only
      after TENANT_RETENTION_DAYS, recoverable until
      then) on exactly the ids a human approved. Every
      approved id is re-checked against the live
      candidate list first, so a typo or a real
      workspace's id is refused, and nothing is touched
      if any id is refused.

   Free of the database connection module so it can be
   tested with a fake db; cleanup-orphan-tenants.ts
   wires in the real pool, flags and output.
======================================== */

export interface OrphanQueryable {
  query(
    sql: string,
    params?: unknown[]
  ): Promise<{ rows: any[] }>;
}

export type OrphanReason =
  | "no-workspace-no-members"
  | "workspace-without-members"
  | "stuck-provisioning"
  | "test-account";

export interface OrphanCandidate {
  id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: Date;
  workspaceCount: number;
  members: string[];
  reasons: OrphanReason[];
  /* Has at least one member, so an account owns it. */
  belongsToAnotherAccount: boolean;
}

/* A tenant still "provisioning" after this long never finished. */
export const STUCK_PROVISIONING_HOURS = 24;

/*
 * Reserved example domains (RFC 2606) are never real
 * customers; an account on one is a test fixture.
 */
const TEST_EMAIL = /@example\.(com|org|net)$/i;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function findOrphanCandidates(
  db: OrphanQueryable,
  now: Date = new Date()
): Promise<OrphanCandidate[]> {
  /* Only live tenants: anything already deprovisioning/deprovisioned is excluded. */
  const result = await db.query(
    `
      /* orphans.list */
      SELECT
        t.id,
        t.name,
        t.slug,
        t.status,
        t.created_at,
        (
          SELECT COUNT(*)::int
          FROM platform.workspaces w
          WHERE w.tenant_id = t.id
        ) AS workspace_count,
        COALESCE(
          (
            SELECT array_agg(u.email ORDER BY u.email)
            FROM platform.workspaces w
            JOIN platform.workspace_members wm
              ON wm.workspace_id = w.id
            JOIN platform.users u
              ON u.id = wm.user_id
            WHERE w.tenant_id = t.id
          ),
          ARRAY[]::text[]
        ) AS members
      FROM platform.tenants t
      WHERE t.status NOT IN ('deprovisioning', 'deprovisioned')
      ORDER BY t.created_at ASC
    `
  );

  const stuckBefore =
    now.getTime() -
    STUCK_PROVISIONING_HOURS * 60 * 60 * 1000;

  const candidates: OrphanCandidate[] = [];

  for (const row of result.rows) {
    const members: string[] = row.members ?? [];
    const workspaceCount = Number(row.workspace_count);
    const createdAt = new Date(row.created_at);
    const reasons: OrphanReason[] = [];

    if (members.length === 0) {
      reasons.push(
        workspaceCount === 0
          ? "no-workspace-no-members"
          : "workspace-without-members"
      );
    }

    if (
      row.status === "provisioning" &&
      createdAt.getTime() < stuckBefore
    ) {
      reasons.push("stuck-provisioning");
    }

    if (
      members.length > 0 &&
      members.every((email) => TEST_EMAIL.test(email))
    ) {
      reasons.push("test-account");
    }

    if (reasons.length === 0) {
      continue;
    }

    candidates.push({
      id: row.id,
      name: row.name,
      slug: row.slug,
      status: row.status,
      createdAt,
      workspaceCount,
      members,
      reasons,
      belongsToAnotherAccount: members.length > 0,
    });
  }

  return candidates;
}

export interface DeprovisionOutcome {
  scheduled: OrphanCandidate[];
  refused: { id: string; why: string }[];
  dryRun: boolean;
}

export async function deprovisionApproved(
  db: OrphanQueryable,
  approvedIds: string[],
  options: {
    /* The existing flow: scheduleTenantDeprovisioning. */
    schedule: (tenantId: string) => Promise<void>;
    dryRun: boolean;
    now?: Date;
    log?: (line: string) => void;
  }
): Promise<DeprovisionOutcome> {
  const log = options.log ?? (() => undefined);

  const ids = [
    ...new Set(approvedIds.map((id) => id.trim().toLowerCase())),
  ].filter(Boolean);

  if (ids.length === 0) {
    throw new Error("No tenant ids were given.");
  }

  const candidates = await findOrphanCandidates(db, options.now);

  const byId = new Map(
    candidates.map((c) => [c.id.toLowerCase(), c])
  );

  const refused: { id: string; why: string }[] = [];

  for (const id of ids) {
    if (!UUID.test(id)) {
      refused.push({ id, why: "not a valid tenant id" });
    } else if (!byId.has(id)) {
      refused.push({
        id,
        why: "not an orphan candidate right now (it may be a real workspace, or already deleted)",
      });
    }
  }

  /* All or nothing: one bad id means no tenant is touched. */
  if (refused.length > 0) {
    return { scheduled: [], refused, dryRun: options.dryRun };
  }

  const scheduled: OrphanCandidate[] = [];

  for (const id of ids) {
    const candidate = byId.get(id)!;

    if (options.dryRun) {
      log(
        `DRY-RUN would schedule deprovisioning: ${candidate.name} (${candidate.slug}) ${candidate.id}`
      );
    } else {
      await options.schedule(candidate.id);

      log(
        `SCHEDULED deprovisioning: ${candidate.name} (${candidate.slug}) ${candidate.id}`
      );
    }

    scheduled.push(candidate);
  }

  return { scheduled, refused: [], dryRun: options.dryRun };
}
