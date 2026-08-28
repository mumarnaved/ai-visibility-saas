import {
  validateTenantContext,
  type Agent,
  type AgentInput,
  type AgentOutput,
} from "agent-contracts";

import {
  reportGenerationInputSchema,
  type ReportGenerationInput,
} from "./report-generation-input.js";

import type {
  AuditDeltas,
  PlanProgress,
  ReportGenerationAgentResult,
  ScoreDelta,
} from "./report-generation-result.js";

import {
  getLatestAuditReport,
  getPreviousAuditReport,
  type AuditReportRecord,
} from "../../database/postgres/audit-report/audit-report-repository.js";

import {
  getLatestMonitoringSnapshot,
} from "../../database/postgres/monitoring/monitoring-snapshots-repository.js";

import {
  getLatestContentPlan,
} from "../../database/postgres/content-plan/content-plan-repository.js";

import {
  listExecutionTasks,
} from "../../database/postgres/execution-tasks/execution-tasks-repository.js";

import {
  saveReport,
} from "../../database/postgres/reports/reports-repository.js";

/* ========================================
   HELPERS
======================================== */

function buildScoreDelta(
  current: number | null,
  previous: number | null
): ScoreDelta {
  return {
    current,
    previous,
    delta:
      current !== null &&
      previous !== null
        ? Number(
            (
              current - previous
            ).toFixed(2)
          )
        : null,
  };
}

function buildAuditDeltas(
  current: AuditReportRecord,
  previous: AuditReportRecord | null
): AuditDeltas {
  return {
    overallScore: buildScoreDelta(
      current.overallScore,
      previous?.overallScore ?? null
    ),

    technicalSeoScore: buildScoreDelta(
      current.technicalSeoScore,
      previous?.technicalSeoScore ??
        null
    ),

    contentQualityScore: buildScoreDelta(
      current.contentQualityScore,
      previous?.contentQualityScore ??
        null
    ),

    aioReadinessScore: buildScoreDelta(
      current.aioReadinessScore,
      previous?.aioReadinessScore ??
        null
    ),

    geoCitationScore: buildScoreDelta(
      current.geoCitationScore,
      previous?.geoCitationScore ??
        null
    ),

    competitorGapScore: buildScoreDelta(
      current.competitorGapScore,
      previous?.competitorGapScore ??
        null
    ),
  };
}

function countBy(
  values: string[]
): Record<string, number> {
  const counts: Record<
    string,
    number
  > = {};

  for (const value of values) {
    counts[value] =
      (counts[value] ?? 0) + 1;
  }

  return counts;
}

/* ========================================
   SUMMARY + RECOMMENDATIONS (TEMPLATED)

   No LLM call - this is arithmetic and
   phrasing over data the agent already has,
   so a template keeps report generation
   fast and immune to AI-provider flakiness.
======================================== */

function describeDelta(
  label: string,
  delta: ScoreDelta
): string | null {
  if (
    delta.current === null ||
    delta.delta === null
  ) {
    return null;
  }

  if (delta.delta === 0) {
    return `${label} held steady at ${delta.current}/100.`;
  }

  const direction =
    delta.delta > 0
      ? "improved"
      : "declined";

  return `${label} ${direction} by ${Math.abs(
    delta.delta
  )} point(s) to ${delta.current}/100.`;
}

function buildSummary(
  auditDeltas: AuditDeltas,
  planProgress: PlanProgress,
  publishedTaskCount: number,
  insights: Array<{
    type: string;
    message: string;
  }>
): string {
  const parts: string[] = [];

  const overallLine = describeDelta(
    "Overall visibility",
    auditDeltas.overallScore
  );

  parts.push(
    overallLine ??
      `Current overall visibility score: ${
        auditDeltas.overallScore
          .current ?? "N/A"
      }/100.`
  );

  if (planProgress.hasPlan) {
    parts.push(
      `Content plan is ${
        planProgress.approvalStatus ===
        "approved"
          ? "approved"
          : "pending approval"
      }, with ${
        planProgress.totalTasks
      } execution task(s) generated (${
        publishedTaskCount
      } published).`
    );
  } else {
    parts.push(
      "No content plan has been generated yet."
    );
  }

  const trafficInsight = insights.find(
    (insight) =>
      insight.type ===
      "ranking_up_traffic_flat"
  );

  if (trafficInsight) {
    parts.push(trafficInsight.message);
  }

  return parts.join(" ");
}

function buildRecommendations(
  auditDeltas: AuditDeltas,
  planProgress: PlanProgress,
  publishedTaskCount: number,
  insights: Array<{
    type: string;
    message: string;
  }>
): string[] {
  const recommendations: string[] =
    [];

  const weakCategories: Array<{
    label: string;
    delta: ScoreDelta;
  }> = [
    {
      label: "Technical SEO",
      delta: auditDeltas.technicalSeoScore,
    },
    {
      label: "Content quality",
      delta:
        auditDeltas.contentQualityScore,
    },
    {
      label: "AIO readiness",
      delta:
        auditDeltas.aioReadinessScore,
    },
    {
      label: "GEO/citation status",
      delta: auditDeltas.geoCitationScore,
    },
  ];

  for (const category of weakCategories) {
    if (
      category.delta.current !==
        null &&
      category.delta.current < 60
    ) {
      recommendations.push(
        `${category.label} is still below 60/100 (${category.delta.current}) - prioritize this in the next content plan.`
      );
    }
  }

  if (!planProgress.hasPlan) {
    recommendations.push(
      "Generate a Stage 2 content plan to turn this audit into concrete next steps."
    );
  } else if (
    planProgress.approvalStatus !==
    "approved"
  ) {
    recommendations.push(
      "Approve the pending content plan so Stage 3 execution can begin."
    );
  }

  if (
    planProgress.totalTasks > 0 &&
    publishedTaskCount === 0
  ) {
    recommendations.push(
      "Execution tasks exist but nothing has been published yet - review and publish approved tasks to start seeing their impact."
    );
  }

  if (
    insights.some(
      (insight) =>
        insight.type ===
        "ranking_up_traffic_flat"
    )
  ) {
    recommendations.push(
      "Rankings are improving faster than traffic - consider expanding tracked queries to higher-intent, higher-volume terms."
    );
  }

  if (recommendations.length === 0) {
    recommendations.push(
      "No urgent issues detected - continue the current cadence and re-check next period."
    );
  }

  return recommendations;
}

/* ========================================
   REPORT GENERATION AGENT
======================================== */

export class ReportGenerationAgent
  implements Agent<
    ReportGenerationInput,
    ReportGenerationAgentResult
  >
{
  readonly name = "report-generation";

  async execute(
    input: AgentInput<ReportGenerationInput>
  ): Promise<
    AgentOutput<ReportGenerationAgentResult>
  > {
    try {
      const tenantContext =
        validateTenantContext(
          input.tenantContext
        );

      const parsedInput =
        reportGenerationInputSchema.parse(
          input.payload
        );

      if (
        tenantContext.tenantId !==
        parsedInput.tenantId
      ) {
        throw new Error(
          "Tenant context does not match report generation input."
        );
      }

      const auditReport =
        await getLatestAuditReport(
          tenantContext.tenantId
        );

      if (!auditReport) {
        throw new Error(
          "No audit report found. Run a Stage 1 audit before generating a report."
        );
      }

      const monitoringSnapshot =
        await getLatestMonitoringSnapshot(
          tenantContext.schema
        );

      if (!monitoringSnapshot) {
        throw new Error(
          "No monitoring data found. Run a Stage 4 monitoring check before generating a report."
        );
      }

      const previousAuditReport =
        await getPreviousAuditReport(
          tenantContext.tenantId
        );

      const contentPlan =
        await getLatestContentPlan(
          tenantContext.schema
        );

      const executionTasks =
        await listExecutionTasks(
          tenantContext.schema
        );

      const publishedTaskCount =
        executionTasks.filter(
          (task) =>
            task.status === "published"
        ).length;

      /* ====================================
         AUDIT DELTAS
      ==================================== */

      const auditDeltas =
        buildAuditDeltas(
          auditReport,
          previousAuditReport
        );

      /* ====================================
         PLAN PROGRESS
      ==================================== */

      const planProgress: PlanProgress =
        {
          hasPlan: !!contentPlan,

          approvalStatus:
            contentPlan?.approvalStatus ??
            null,

          totalTasks:
            executionTasks.length,

          tasksByStatus: countBy(
            executionTasks.map(
              (task) => task.status
            )
          ),

          tasksByApproval: countBy(
            executionTasks.map(
              (task) =>
                task.approvalStatus
            )
          ),
        };

      /* ====================================
         TRAFFIC TREND

         Passed straight through from the
         latest monitoring snapshot - Stage 4
         monitoring already computed this.
      ==================================== */

      const snapshotMetrics =
        (monitoringSnapshot.metrics as {
          insights?: Array<{
            type: string;
            message: string;
          }>;
        }) ?? {};

      const insights =
        snapshotMetrics.insights ?? [];

      const trafficTrend = {
        visibilityScore:
          monitoringSnapshot.visibilityScore,
        citationScore:
          monitoringSnapshot.citationScore,
        technicalScore:
          monitoringSnapshot.technicalScore,
        contentScore:
          monitoringSnapshot.contentScore,
        competitorScore:
          monitoringSnapshot.competitorScore,
        metrics:
          monitoringSnapshot.metrics,
      };

      /* ====================================
         SUMMARY + RECOMMENDATIONS
      ==================================== */

      const summary = buildSummary(
        auditDeltas,
        planProgress,
        publishedTaskCount,
        insights
      );

      const recommendations =
        buildRecommendations(
          auditDeltas,
          planProgress,
          publishedTaskCount,
          insights
        );

      /* ====================================
         PERIOD

         Mirrors the window the monitoring
         agent pulled analytics data for.
      ==================================== */

      const sessionsPeriod =
        (
          monitoringSnapshot.metrics as {
            sessions?: {
              periodStart?: string;
              periodEnd?: string;
            };
          }
        )?.sessions;

      const periodStart =
        sessionsPeriod?.periodStart ??
        monitoringSnapshot.snapshotDate;

      const periodEnd =
        sessionsPeriod?.periodEnd ??
        monitoringSnapshot.snapshotDate;

      /* ====================================
         SAVE REPORT
      ==================================== */

      const savedReport =
        await saveReport(
          tenantContext.schema,
          {
            periodStart,
            periodEnd,
            summary,
            auditDeltas,
            planProgress,
            trafficTrend,
            recommendations,
          }
        );

      const result: ReportGenerationAgentResult =
        {
          tenantId:
            tenantContext.tenantId,

          schemaName:
            tenantContext.schema,

          reportId: savedReport.id,

          periodStart:
            savedReport.periodStart,

          periodEnd:
            savedReport.periodEnd,

          summary,

          auditDeltas,
          planProgress,
          trafficTrend,

          recommendations,

          generatedAt:
            new Date().toISOString(),
        };

      return {
        success: true,
        data: result,
        metadata: {
          agent: this.name,
          operation: "report-generation",
        },
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Report generation failed.",
        metadata: {
          agent: this.name,
          operation: "report-generation",
        },
      };
    }
  }
}
