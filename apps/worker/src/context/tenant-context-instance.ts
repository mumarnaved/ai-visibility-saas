import { pool } from "../database/postgres/connection.js";
import { getEffectivePlanForTenant } from "../database/postgres/billing/billing-repository.js";
import { scrapeWithFirecrawl } from "../agents/shared/firecrawl-client.js";
import { getSiteIndexSignals } from "../agents/shared/serpapi-client.js";
import { runOpenRouter } from "../agents/shared/openrouter-provider.js";
import { storageService } from "../services/storage/storage-service.js";

import {
  assertTenantUsable,
  buildTenantContextWith,
  type BuildTenantContextDeps,
  type TenantRow,
  type TenantRuntime,
} from "./build-tenant-context.js";

/* ========================================
   THE REAL buildTenantContext

   build-tenant-context.ts holds the logic with injected
   dependencies (so it is testable); this wires in the real
   pool, storage, billing and the metered provider clients.
   Import buildTenantContext from here.
======================================== */

export async function loadTenantRow(
  tenantId: string
): Promise<TenantRow | null> {
  const result = await pool.query(
    `
      SELECT
        id, name, slug, website_url, schema_name, status, plan
      FROM platform.tenants
      WHERE id::text = $1
      LIMIT 1
    `,
    [tenantId]
  );

  return (result.rows[0] as TenantRow | undefined) ?? null;
}

const realDeps: BuildTenantContextDeps = {
  loadTenant: loadTenantRow,

  pool: pool as unknown as BuildTenantContextDeps["pool"],

  rawStorage: storageService,

  providers: {
    firecrawl: { scrape: scrapeWithFirecrawl },
    serpapi: { siteIndexSignals: getSiteIndexSignals },
    openrouter: { run: runOpenRouter },
  },

  /* The plan belongs to the workspace owner, whoever is acting. */
  loadPlan: async (tenantId) => {
    const plan = await getEffectivePlanForTenant(tenantId);

    return {
      planTier: plan.planTier,
      status: plan.status,
      websiteLimit: plan.websiteLimit,
    };
  },
};

export function buildTenantContext(
  tenantId: string,
  userId: string | null = null
): Promise<TenantRuntime> {
  return buildTenantContextWith(realDeps, tenantId, userId);
}

/* Cheap re-check used by the orchestrator right before a run. */
export async function assertTenantStillUsable(
  tenantId: string
): Promise<void> {
  await assertTenantUsable(loadTenantRow, tenantId);
}
