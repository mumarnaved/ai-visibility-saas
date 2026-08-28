import {
  Stage1AuditPipeline,
} from "../agents/stage-1-audit-pipeline.js";

import {
  ContentPlanAgent,
} from "../agents/content-plan/index.js";

import {
  saveContentPlan,
} from "../database/postgres/content-plan/content-plan-repository.js";

import {
  setScanStatus,
} from "../database/postgres/tenant-registry.js";

import {
  getBrandNameFromWebsite,
} from "../lib/brand-name.js";

/* ========================================
   DEFAULT QUERIES

   A brand-new tenant has no queries
   configured yet, but Stage 1 requires at
   least one. These two generic ones give a
   real first result immediately; the user
   can add more specific queries later via
   the Queries page. Kept deliberately simple
   - no industry classification, just the
   brand name in two common query shapes.
======================================== */

function buildDefaultQueries(
  brandName: string
): Array<{
  query: string;
  category: string;
}> {
  return [
    {
      query: `What is ${brandName}?`,
      category: "brand",
    },
    {
      query: `Best alternatives to ${brandName}`,
      category: "competitive",
    },
  ];
}

function buildTenantContext(
  tenantId: string,
  schemaName: string
) {
  return {
    tenantId,
    schema: schemaName,
    storagePrefix: `tenant-${tenantId}`,
    credentialNamespace: `credentials/tenant-${tenantId}`,
    vectorNamespace: `vector-tenant-${tenantId}`,
  };
}

/* ========================================
   RUN AUTOMATIC SCAN

   Stage 1 (default queries, no competitors)
   then Stage 2 (content plan) - fired once
   right after a tenant's domain is verified.
   Not awaited by the caller: this updates
   scan_status as it progresses so the
   Overview page can poll and show progress.

   Stage 3 is intentionally never triggered
   here - it requires the human-reviewed
   content plan to be explicitly approved
   first, which this leaves untouched
   (approval_status stays 'pending').
======================================== */

export async function runAutomaticScan(
  tenantId: string,
  websiteUrl: string,
  schemaName: string
): Promise<void> {
  const tenantContext =
    buildTenantContext(
      tenantId,
      schemaName
    );

  try {
    await setScanStatus(
      tenantId,
      "auditing"
    );

    const brandName =
      getBrandNameFromWebsite(
        websiteUrl
      ) || websiteUrl;

    const pipeline =
      new Stage1AuditPipeline();

    await pipeline.execute({
      tenantContext,
      websiteUrl,
      brandName,
      queries:
        buildDefaultQueries(
          brandName
        ),
      competitors: [],
    });

    await setScanStatus(
      tenantId,
      "planning"
    );

    const contentPlanAgent =
      new ContentPlanAgent();

    const planOutput =
      await contentPlanAgent.execute({
        tenantContext,
        payload: { tenantId },
      });

    if (
      !planOutput.success ||
      !planOutput.data
    ) {
      throw new Error(
        planOutput.error ||
          "Content plan generation failed."
      );
    }

    const generated =
      planOutput.data;

    await saveContentPlan(
      schemaName,
      {
        auditReportId:
          generated.auditReportId,

        summary: generated.summary,

        contentGaps:
          generated.contentGapMap,

        entityPlan:
          generated.entitySchemaPlan,

        technicalPlan:
          generated.prioritizedFixList,

        roadmap: generated.roadmap,
      }
    );

    await setScanStatus(
      tenantId,
      "ready"
    );
  } catch (error) {
    console.error(
      `Automatic scan failed for tenant ${tenantId}:`,
      error
    );

    await setScanStatus(
      tenantId,
      "failed",
      error instanceof Error
        ? error.message
        : "Automatic scan failed."
    ).catch(() => {
      // Best effort - don't let a status-write
      // failure mask the original error above.
    });
  }
}
