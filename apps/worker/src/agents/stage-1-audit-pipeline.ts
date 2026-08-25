import {
  TechnicalAuditAgent,
} from "./technical-audit/index.js";

import {
  ContentEntityAuditAgent,
} from "./content-entity/index.js";

import {
  CitationVisibilityAuditAgent,
} from "./citation-visibility/index.js";

import {
  CompetitorBenchmarkAgent,
} from "./competitor-benchmark/index.js";

import {
  AuditAggregatorAgent,
  type AuditReport,
} from "./audit-aggregator/index.js";

import type {
  AgentOutput,
  TenantContext,
} from "agent-contracts";

/*
 * NOTE: adjust this import path if your project's
 * audit-report repository folder is named
 * differently (e.g. "audit-reports" instead of
 * "audit-report"). The repository file itself is
 * unchanged from what already existed in the
 * project — this pipeline just wasn't calling it.
 */
import {
  saveAuditReport,
} from "../database/postgres/audit-report/audit-report-repository.js";

/* ========================================
   TYPES
======================================== */

export interface Stage1AuditPipelineInput {
  tenantContext: TenantContext;

  websiteUrl: string;

  brandName: string;

  queries: Array<{
    query: string;
    category?: string | null;
  }>;

  competitors?: Array<{
    name: string;
    websiteUrl?: string;
  }>;
}

export interface Stage1AuditPipelineResult {
  tenantId: string;

  websiteUrl: string;

  brandName: string;

  technicalAudit: unknown;

  contentEntityAudit: unknown;

  citationVisibilityAudit: unknown;

  competitorBenchmark: unknown;

  auditReport: AuditReport;

  /*
   * Populated once the aggregated report has
   * been persisted to the tenant schema's
   * audit_reports table.
   */
  auditReportRecordId: string;

  auditReportSavedAt: string;

  completedAt: string;
}

/* ========================================
   HELPERS
======================================== */

function extractAgentData(
  output: AgentOutput<unknown>,
  agentName: string
): Record<string, unknown> {
  if (!output.success) {
    throw new Error(
      `${agentName} failed: ${
        output.error ??
        "Unknown agent error."
      }`
    );
  }

  if (
    output.data === undefined ||
    output.data === null
  ) {
    throw new Error(
      `${agentName} completed without returning data.`
    );
  }

  if (
    typeof output.data !== "object" ||
    Array.isArray(output.data)
  ) {
    throw new Error(
      `${agentName} returned an invalid object payload.`
    );
  }

  return Object.fromEntries(
    Object.entries(output.data)
  );
}

/* ========================================
   STAGE 1 PIPELINE
======================================== */

export class Stage1AuditPipeline {
  private readonly technicalAuditAgent =
    new TechnicalAuditAgent();

  private readonly contentEntityAuditAgent =
    new ContentEntityAuditAgent();

  private readonly citationVisibilityAuditAgent =
    new CitationVisibilityAuditAgent();

  private readonly competitorBenchmarkAgent =
    new CompetitorBenchmarkAgent();

  private readonly auditAggregatorAgent =
    new AuditAggregatorAgent();

  /* ======================================
     EXECUTE
  ====================================== */

  async execute(
    input: Stage1AuditPipelineInput
  ): Promise<Stage1AuditPipelineResult> {
    /* ====================================
       1. VALIDATE TENANT CONTEXT
    ==================================== */

    if (
      !input.tenantContext ||
      !input.tenantContext.tenantId
    ) {
      throw new Error(
        "Stage 1 requires a valid tenant context."
      );
    }

    if (!input.tenantContext.schema) {
      throw new Error(
        "Stage 1 requires a tenant schema."
      );
    }

    const tenantId =
      input.tenantContext.tenantId;

    const websiteUrl =
      input.websiteUrl.trim();

    const brandName =
      input.brandName.trim();

    if (!websiteUrl) {
      throw new Error(
        "websiteUrl is required."
      );
    }

    if (!brandName) {
      throw new Error(
        "brandName is required."
      );
    }

    if (
      !input.queries ||
      input.queries.length === 0
    ) {
      throw new Error(
        "At least one AI visibility query is required."
      );
    }

    /* ====================================
       2. TECHNICAL AUDIT
    ==================================== */

    const technicalAudit =
      await this.technicalAuditAgent.execute({
        tenantContext:
          input.tenantContext,

        payload: {
          tenantId,
          websiteUrl,
        },
      });

    /* ====================================
       3. CONTENT + ENTITY AUDIT
    ==================================== */

    const contentEntityAudit =
      await this.contentEntityAuditAgent.execute({
        tenantContext:
          input.tenantContext,

        payload: {
          tenantId,
          websiteUrl,
        },
      });

    /* ====================================
       4. CITATION / VISIBILITY AUDIT
    ==================================== */

    const citationVisibilityAudit =
      await this.citationVisibilityAuditAgent.execute({
        tenantContext:
          input.tenantContext,

        payload: {
          tenantId,
          websiteUrl,
          brandName,
          queries: input.queries,
        },
      });

    /* ====================================
       5. COMPETITOR BENCHMARK

       Optional: competitor names aren't
       always known up front, so this step
       is skipped (not thrown) when none
       are supplied. The aggregator already
       treats a missing competitorBenchmark
       as "not evaluated" rather than a 0.
    ==================================== */

    const competitors =
      input.competitors ?? [];

    const hasCompetitors =
      competitors.length > 0;

    const competitorBenchmark =
      hasCompetitors
        ? await this.competitorBenchmarkAgent.execute(
            {
              tenantContext:
                input.tenantContext,

              payload: {
                tenantId,
                websiteUrl,
                brandName,
                competitors,
              },
            }
          )
        : null;

    /* ====================================
       6. AGGREGATE STAGE 1
    ==================================== */

    const auditAggregatorResult =
      await this.auditAggregatorAgent.execute({
        tenantContext:
          input.tenantContext,

        payload: {
          tenantId,

          technicalAudit:
            extractAgentData(
              technicalAudit,
              "Technical audit"
            ),

          contentEntityAudit:
            extractAgentData(
              contentEntityAudit,
              "Content/entity audit"
            ),

          citationAudit:
            extractAgentData(
              citationVisibilityAudit,
              "Citation/visibility audit"
            ),

          competitorBenchmark:
            competitorBenchmark
              ? extractAgentData(
                  competitorBenchmark,
                  "Competitor benchmark"
                )
              : undefined,
        },
      });

    if (
      !auditAggregatorResult.success
    ) {
      throw new Error(
        `Audit aggregator failed: ${
          auditAggregatorResult.error ??
          "Unknown audit aggregator error."
        }`
      );
    }

    if (
      auditAggregatorResult.data ===
      undefined
    ) {
      throw new Error(
        "Audit aggregator completed without returning an audit report."
      );
    }

    const auditReport =
      auditAggregatorResult.data as AuditReport;

    /* ====================================
       7. PERSIST THE AGGREGATED REPORT

       This call was previously missing:
       audit-report-repository.ts existed
       in the project but nothing invoked it,
       so the final Stage 1 report was never
       saved to the tenant schema.
    ==================================== */

    const savedAuditReport =
      await saveAuditReport(
        tenantId,
        auditReport
      );

    /* ====================================
       8. RETURN COMPLETE STAGE 1 RESULT
    ==================================== */

    return {
      tenantId,

      websiteUrl,

      brandName,

      technicalAudit,

      contentEntityAudit,

      citationVisibilityAudit,

      competitorBenchmark,

      auditReport,

      auditReportRecordId:
        savedAuditReport.id,

      auditReportSavedAt:
        savedAuditReport.createdAt,

      completedAt:
        new Date().toISOString(),
    };
  }
}

/* ========================================
   FACTORY
======================================== */

export function createStage1AuditPipeline() {
  return new Stage1AuditPipeline();
}