import {
  validateTenantContext,
  type Agent,
  type AgentInput,
  type AgentOutput,
} from "agent-contracts";

import {
  contentPlanInputSchema,
  type ContentPlanInput,
} from "./content-plan-input.js";

import type {
  ContentGapItem,
  ContentPlanAgentResult,
  ContentPlanRoadmap,
  ContentPlanUrgency,
  EntitySchemaPlanItem,
  PrioritizedFixItem,
} from "./content-plan-result.js";

import {
  getLatestAuditReport,
} from "../../database/postgres/audit-report/audit-report-repository.js";

/* ========================================
   CATEGORY BLOB HELPERS

   audit_reports stores each Stage 1
   category as a JSONB blob shaped like
   { score, status, summary } (the
   AuditCategory produced by the audit
   aggregator) - except aioReadiness,
   which has no source-audit column and
   therefore no blob at all, only a score.

   These blobs are summaries, not the raw
   itemized findings that live in the
   technical_audits / content_entity_audits
   tables - so the content gap map and
   entity/schema plan below currently
   contain one summarized item per
   category rather than a fully itemized
   list. Read directly from those tables
   in a follow-up if per-finding detail is
   needed.
======================================== */

interface CategoryBlob {
  status: ContentPlanUrgency | null;
  summary: string | null;
}

function readCategoryBlob(
  blob: unknown
): CategoryBlob {
  if (
    !blob ||
    typeof blob !== "object" ||
    Array.isArray(blob)
  ) {
    return { status: null, summary: null };
  }

  const record =
    blob as Record<string, unknown>;

  const status =
    record.status === "critical" ||
    record.status === "warning" ||
    record.status === "good"
      ? record.status
      : null;

  const summary =
    typeof record.summary === "string"
      ? record.summary
      : null;

  return { status, summary };
}

function getStatusFromScore(
  score: number
): ContentPlanUrgency {
  if (score >= 80) {
    return "good";
  }

  if (score >= 60) {
    return "warning";
  }

  return "critical";
}

/* ========================================
   CATEGORY MODEL
======================================== */

interface CategorySnapshot {
  key: string;
  label: string;
  score: number;
  status: ContentPlanUrgency;
  summary: string;
}

function buildCategorySnapshot(
  label: string,
  score: number | null,
  blob: unknown
): CategorySnapshot {
  const normalizedScore =
    score ?? 0;

  const { status, summary } =
    readCategoryBlob(blob);

  return {
    key: label,
    label,
    score: normalizedScore,
    status:
      status ??
      getStatusFromScore(
        normalizedScore
      ),
    summary:
      summary ??
      `${label} score: ${normalizedScore}/100.`,
  };
}

/* ========================================
   CONTENT PLAN AGENT
======================================== */

export class ContentPlanAgent
  implements Agent<
    ContentPlanInput,
    ContentPlanAgentResult
  >
{
  readonly name = "content-plan";

  async execute(
    input: AgentInput<ContentPlanInput>
  ): Promise<
    AgentOutput<ContentPlanAgentResult>
  > {
    try {
      const tenantContext =
        validateTenantContext(
          input.tenantContext
        );

      const planInput =
        contentPlanInputSchema.parse(
          input.payload
        );

      if (
        tenantContext.tenantId !==
        planInput.tenantId
      ) {
        throw new Error(
          "Tenant context does not match content plan input."
        );
      }

      /* ====================================
         1. READ LATEST STAGE 1 AUDIT REPORT
      ==================================== */

      const auditReport =
        await getLatestAuditReport(
          tenantContext.tenantId
        );

      if (!auditReport) {
        throw new Error(
          "No audit report found. Run a Stage 1 audit before generating a content plan."
        );
      }

      /* ====================================
         2. BUILD CATEGORY SNAPSHOTS
      ==================================== */

      const technicalSEO =
        buildCategorySnapshot(
          "Technical SEO",
          auditReport.technicalSeoScore,
          auditReport.technicalAudit
        );

      const contentQuality =
        buildCategorySnapshot(
          "Content Quality",
          auditReport.contentQualityScore,
          auditReport.contentEntityAudit
        );

      const aioReadiness =
        buildCategorySnapshot(
          "AIO Readiness",
          auditReport.aioReadinessScore,
          null
        );

      const geoCitationStatus =
        buildCategorySnapshot(
          "Geo/Citation Status",
          auditReport.geoCitationScore,
          auditReport.citationAudit
        );

      /*
       * competitorGapScore is null when
       * Stage 1 ran without competitors
       * (competitor benchmarking is
       * optional) - omit the category
       * entirely rather than scoring it
       * 0/critical, which would wrongly
       * flag it as the top priority.
       */
      const competitorGap =
        auditReport.competitorGapScore !==
        null
          ? buildCategorySnapshot(
              "Competitor Gap",
              auditReport.competitorGapScore,
              auditReport.competitorBenchmark
            )
          : null;

      const categories: CategorySnapshot[] =
        [
          technicalSEO,
          contentQuality,
          aioReadiness,
          geoCitationStatus,

          ...(competitorGap
            ? [competitorGap]
            : []),
        ];

      /* ====================================
         3. PRIORITIZED FIX LIST

         Ranked worst-score-first: the
         lowest-scoring categories need
         attention soonest.
      ==================================== */

      const prioritizedFixList: PrioritizedFixItem[] =
        [...categories]
          .sort(
            (a, b) => a.score - b.score
          )
          .map((category, index) => ({
            rank: index + 1,
            category: category.label,
            score: category.score,
            status: category.status,
            summary: category.summary,
          }));

      /* ====================================
         4. CONTENT GAP MAP

         Derived from the Content Quality
         category (the audit's
         content/entity findings summary).
      ==================================== */

      const contentGapMap: ContentGapItem[] =
        [
          {
            area: contentQuality.label,
            score: contentQuality.score,
            status: contentQuality.status,
            gap: contentQuality.summary,
          },
        ];

      /* ====================================
         5. ENTITY / SCHEMA PLAN

         Derived from the Technical SEO
         category (schema, structured data,
         and crawlability live there).
      ==================================== */

      const entitySchemaPlan: EntitySchemaPlanItem[] =
        [
          {
            area: technicalSEO.label,
            score: technicalSEO.score,
            status: technicalSEO.status,
            plan: technicalSEO.summary,
          },
        ];

      /* ====================================
         6. 30/60/90 ROADMAP

         Bucketed by urgency/impact:
         critical categories first (30
         days), warning categories next
         (60 days), and categories already
         in good shape last (90 days, for
         maintenance/monitoring). The
         audit's own top-level priorities
         are surfaced separately since they
         aren't tied to a single category.
      ==================================== */

      const roadmap: ContentPlanRoadmap = {
        day30: prioritizedFixList.filter(
          (item) =>
            item.status === "critical"
        ),

        day60: prioritizedFixList.filter(
          (item) =>
            item.status === "warning"
        ),

        day90: prioritizedFixList.filter(
          (item) => item.status === "good"
        ),

        immediatePriorities: Array.isArray(
          auditReport.priorities
        )
          ? (auditReport.priorities as unknown[]).filter(
              (
                item
              ): item is string =>
                typeof item === "string"
            )
          : [],
      };

      /* ====================================
         7. SUMMARY
      ==================================== */

      const summary =
        auditReport.summary ??
        `Content plan generated from the Stage 1 audit (overall score ${auditReport.overallScore ?? 0}/100).`;

      const result: ContentPlanAgentResult = {
        tenantId:
          tenantContext.tenantId,

        schemaName:
          tenantContext.schema,

        auditReportId: auditReport.id,

        auditReportGeneratedAt:
          auditReport.createdAt,

        summary,

        prioritizedFixList,

        contentGapMap,

        entitySchemaPlan,

        roadmap,

        generatedAt:
          new Date().toISOString(),
      };

      return {
        success: true,
        data: result,
        metadata: {
          agent: this.name,
          operation: "content-plan",
        },
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Content plan generation failed.",
        metadata: {
          agent: this.name,
          operation: "content-plan",
        },
      };
    }
  }
}
