import type {
  Agent,
  AgentInput,
  AgentOutput,
} from "agent-contracts";

/* ========================================
   AUDIT AGGREGATOR TYPES
======================================== */

interface AuditCategory {
  score: number;
  status: "good" | "warning" | "critical";
  summary: string;
}

interface AuditAggregatorPayload {
  tenantId: string;

  technicalAudit?: {
    score?: number;
    summary?: string;
    [key: string]: unknown;
  } | null;

  contentEntityAudit?: {
    score?: number;
    summary?: string;
    [key: string]: unknown;
  } | null;

  citationAudit?: {
    score?: number;
    summary?: string;
    [key: string]: unknown;
  } | null;

  competitorBenchmark?: {
    score?: number;
    summary?: string;
    [key: string]: unknown;
  } | null;
}

export interface AuditReport {
  tenantId: string;

  generatedAt: string;

  overallScore: number;

  categories: {
    technicalSEO: AuditCategory;
    contentQuality: AuditCategory;
    aioReadiness: AuditCategory;
    geoCitationStatus: AuditCategory;

    /*
     * null when no competitors were
     * supplied - competitor benchmarking
     * is optional, so this category is
     * simply omitted rather than scored
     * as 0/critical.
     */
    competitorGap: AuditCategory | null;
  };

  summary: string;

  priorities: string[];
}

/* ========================================
   SCORE HELPERS
======================================== */

function normalizeScore(
  value: unknown
): number {
  if (
    typeof value !== "number" ||
    Number.isNaN(value)
  ) {
    return 0;
  }

  return Math.max(
    0,
    Math.min(100, value)
  );
}

function getStatus(
  score: number
): "good" | "warning" | "critical" {
  if (score >= 80) {
    return "good";
  }

  if (score >= 60) {
    return "warning";
  }

  return "critical";
}

function buildCategory(
  score: number,
  summary: string
): AuditCategory {
  const normalizedScore =
    normalizeScore(score);

  return {
    score: normalizedScore,

    status:
      getStatus(
        normalizedScore
      ),

    summary:
      summary ||
      "No detailed audit summary was provided.",
  };
}

/* ========================================
   PRIORITY BUILDER
======================================== */

function buildPriorities(
  categories: AuditReport["categories"]
): string[] {
  const priorities: Array<{
    name: string;
    score: number;
  }> = [
    {
      name: "Technical SEO",
      score:
        categories.technicalSEO.score,
    },

    {
      name: "Content Quality",
      score:
        categories.contentQuality.score,
    },

    {
      name: "AIO Readiness",
      score:
        categories.aioReadiness.score,
    },

    {
      name: "GEO Citation Status",
      score:
        categories.geoCitationStatus.score,
    },

    /*
     * Only ranked when competitor
     * benchmarking actually ran - a
     * skipped category has nothing to
     * prioritize.
     */
    ...(categories.competitorGap
      ? [
          {
            name: "Competitor Gap",
            score:
              categories.competitorGap
                .score,
          },
        ]
      : []),
  ];

  return priorities
    .sort(
      (a, b) =>
        a.score - b.score
    )
    .slice(0, 3)
    .map(
      (item) =>
        `${item.name} requires attention (score: ${item.score}/100).`
    );
}

/* ========================================
   SUMMARY BUILDER
======================================== */

function buildSummary(
  overallScore: number,
  categories: AuditReport["categories"]
): string {
  const weakest =
    Object.entries(categories)
      .filter(
        (
          entry
        ): entry is [
          string,
          AuditCategory
        ] => entry[1] !== null
      )
      .sort(
        ([, a], [, b]) =>
          a.score - b.score
      )[0];

  if (!weakest) {
    return `The audit produced an overall score of ${overallScore}/100.`;
  }

  const weakestName =
    weakest[0];

  const weakestScore =
    weakest[1].score;

  return (
    `The tenant received an overall audit score of ${overallScore}/100. ` +
    `The highest-priority area is ${weakestName} with a score of ${weakestScore}/100.`
  );
}

/* ========================================
   AUDIT AGGREGATOR AGENT
======================================== */

export class AuditAggregatorAgent
  implements Agent
{
  readonly name =
    "audit-aggregator";

  async execute(
    input: AgentInput
  ): Promise<AgentOutput> {
    const payload =
      input.payload as AuditAggregatorPayload;

    const tenantId =
      payload?.tenantId ||
      input.tenantContext.tenantId;

    if (!tenantId) {
      throw new Error(
        "Audit Aggregator requires tenantId."
      );
    }

    /* ========================================
       1. READ STAGE 1 AGENT RESULTS
    ======================================== */

    const technicalScore =
      normalizeScore(
        payload.technicalAudit?.score
      );

    const contentScore =
      normalizeScore(
        payload.contentEntityAudit?.score
      );

    const citationScore =
      normalizeScore(
        payload.citationAudit?.score
      );

    const hasCompetitorData =
      payload.competitorBenchmark !=
      null;

    const competitorScore =
      normalizeScore(
        payload.competitorBenchmark?.score
      );

    /*
     * AIO readiness is derived from
     * content + citation readiness.
     */

    const aioReadiness =
      Math.round(
        (
          contentScore +
          citationScore
        ) / 2
      );

    /* ========================================
       2. BUILD CATEGORY SCORES
    ======================================== */

    const categories = {
      technicalSEO:
        buildCategory(
          technicalScore,

          payload.technicalAudit
            ?.summary ??
            "Technical audit results are ready for review."
        ),

      contentQuality:
        buildCategory(
          contentScore,

          payload.contentEntityAudit
            ?.summary ??
            "Content and entity audit results are ready for review."
        ),

      aioReadiness:
        buildCategory(
          aioReadiness,

          "AIO readiness is derived from content quality and citation visibility."
        ),

      geoCitationStatus:
        buildCategory(
          citationScore,

          payload.citationAudit
            ?.summary ??
            "Citation and AI visibility audit results are ready for review."
        ),

      competitorGap:
        hasCompetitorData
          ? buildCategory(
              competitorScore,

              payload.competitorBenchmark
                ?.summary ??
                "Competitor benchmark results are ready for review."
            )
          : null,
    };

    /* ========================================
       3. CALCULATE OVERALL SCORE

       Averaged only across categories that
       actually ran - a skipped competitor
       benchmark is omitted rather than
       counted as a 0, so it doesn't
       unfairly drag the overall score down.
    ======================================== */

    const scoredCategories = [
      categories.technicalSEO.score,
      categories.contentQuality.score,
      categories.aioReadiness.score,
      categories.geoCitationStatus.score,

      ...(categories.competitorGap
        ? [
            categories.competitorGap
              .score,
          ]
        : []),
    ];

    const overallScore =
      Math.round(
        scoredCategories.reduce(
          (sum, score) => sum + score,
          0
        ) / scoredCategories.length
      );

    /* ========================================
       4. BUILD PRIORITIES
    ======================================== */

    const priorities =
      buildPriorities(
        categories
      );

    /* ========================================
       5. BUILD SUMMARY
    ======================================== */

    const summary =
      buildSummary(
        overallScore,
        categories
      );

    /* ========================================
       6. FINAL AUDIT REPORT
    ======================================== */

    const report: AuditReport = {
      tenantId,

      generatedAt:
        new Date().toISOString(),

      overallScore,

      categories,

      summary,

      priorities,
    };

    /* ========================================
       7. RETURN TENANT-SCOPED RESULT
    ======================================== */

    return {
      success: true,

      agent:
        this.name,

      tenantId,

      data: report,
    } as AgentOutput;
  }
}

/* ========================================
   FACTORY
======================================== */

export function createAuditAggregatorAgent() {
  return new AuditAggregatorAgent();
}