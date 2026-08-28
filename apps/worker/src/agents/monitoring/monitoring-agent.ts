import {
  validateTenantContext,
  type Agent,
  type AgentInput,
  type AgentOutput,
} from "agent-contracts";

import {
  monitoringInputSchema,
  type MonitoringInput,
} from "./monitoring-input.js";

import type {
  MonitoringAgentResult,
  MonitoringInsight,
} from "./monitoring-result.js";

import {
  MockAnalyticsAdapter,
  type AnalyticsAdapter,
} from "../shared/analytics-adapter.js";

import {
  createGoogleAnalyticsAdapter,
} from "../shared/google-analytics-adapter.js";

import {
  getLatestAuditReport,
} from "../../database/postgres/audit-report/audit-report-repository.js";

import {
  getLatestCitationVisibilityAudit,
  deriveQueryRecords,
} from "../../database/postgres/citation-visibility/citation-visibility-audit-repository.js";

import {
  listExecutionTasks,
} from "../../database/postgres/execution-tasks/execution-tasks-repository.js";

import {
  getLatestMonitoringSnapshot,
  saveMonitoringSnapshot,
} from "../../database/postgres/monitoring/monitoring-snapshots-repository.js";

import {
  getTenantById,
} from "../../database/postgres/tenant-registry.js";

import {
  getBrandNameFromWebsite,
} from "../../lib/brand-name.js";

const PERIOD_DAYS = 30;

/* ========================================
   RANKING MOVEMENT THRESHOLDS

   Positions are 1-indexed page ranks - lower
   is better. A drop of 2+ positions counts as
   "improved." Session movement of less than
   5% of the previous period counts as "flat."
======================================== */

const RANKING_IMPROVED_THRESHOLD = 2;
const TRAFFIC_FLAT_THRESHOLD_RATIO = 0.05;

function averagePosition(
  rankings: {
    position: number;
  }[]
): number | null {
  if (rankings.length === 0) {
    return null;
  }

  const sum = rankings.reduce(
    (total, item) =>
      total + item.position,
    0
  );

  return sum / rankings.length;
}

function averagePreviousPosition(
  rankings: {
    previousPosition: number | null;
  }[]
): number | null {
  const known = rankings
    .map(
      (item) => item.previousPosition
    )
    .filter(
      (value): value is number =>
        value !== null
    );

  if (known.length === 0) {
    return null;
  }

  return (
    known.reduce(
      (total, value) => total + value,
      0
    ) / known.length
  );
}

/* ========================================
   MONITORING AGENT
======================================== */

export class MonitoringAgent
  implements Agent<
    MonitoringInput,
    MonitoringAgentResult
  >
{
  readonly name = "monitoring";

  /*
   * Optional override for tests / explicit
   * callers. Left undefined in normal use so
   * execute() can resolve the right adapter
   * per tenant - Google if connected, mock
   * otherwise - which isn't known until the
   * tenant is loaded.
   */
  constructor(
    private readonly analyticsAdapterOverride?: AnalyticsAdapter
  ) {}

  async execute(
    input: AgentInput<MonitoringInput>
  ): Promise<
    AgentOutput<MonitoringAgentResult>
  > {
    try {
      const tenantContext =
        validateTenantContext(
          input.tenantContext
        );

      const parsedInput =
        monitoringInputSchema.parse(
          input.payload
        );

      if (
        tenantContext.tenantId !==
        parsedInput.tenantId
      ) {
        throw new Error(
          "Tenant context does not match monitoring input."
        );
      }

      const auditReport =
        await getLatestAuditReport(
          tenantContext.tenantId
        );

      if (!auditReport) {
        throw new Error(
          "No audit report found. Run a Stage 1 audit before monitoring."
        );
      }

      const tenant =
        await getTenantById(
          tenantContext.tenantId
        );

      if (!tenant?.websiteUrl) {
        throw new Error(
          "Tenant has no website URL to monitor."
        );
      }

      const websiteUrl =
        tenant.websiteUrl;

      /* ====================================
         PUBLISHED CHANGES SINCE LAST CHECK
      ==================================== */

      const allTasks =
        await listExecutionTasks(
          tenantContext.schema
        );

      const publishedTasks =
        allTasks.filter(
          (task) =>
            task.status === "published"
        );

      /* ====================================
         KEYWORDS TO TRACK

         Reuses the queries already tracked
         for citation visibility, so ranking
         data is grounded in something the
         tenant actually cares about rather
         than an arbitrary keyword list.
      ==================================== */

      const latestCitationAudit =
        await getLatestCitationVisibilityAudit(
          tenantContext.schema
        );

      const trackedQueries =
        deriveQueryRecords(
          latestCitationAudit
        ).map(
          (record) => record.query
        );

      const keywords =
        trackedQueries.length > 0
          ? trackedQueries.slice(0, 5)
          : [
              getBrandNameFromWebsite(
                websiteUrl
              ) || websiteUrl,
            ];

      /* ====================================
         ANALYTICS (GOOGLE, WITH MOCK FALLBACK)

         Uses the tenant's connected Google
         account when available. If it isn't
         connected, or any real API call
         fails (expired/revoked token, GA4
         property or GSC site missing, API
         error), falls back to synthetic mock
         data rather than breaking the run -
         monitoring must never depend on an
         external integration staying healthy.
      ==================================== */

      const analyticsAdapter =
        this.analyticsAdapterOverride ??
        (await createGoogleAnalyticsAdapter(
          tenantContext.tenantId
        )) ??
        new MockAnalyticsAdapter();

      const isMockAdapter =
        analyticsAdapter instanceof
        MockAnalyticsAdapter;

      /*
       * Always visible in logs which adapter
       * a run actually used - not just on
       * failure - so "why is this mock data"
       * is answerable without reproducing the
       * failure first.
       */
      console.log(
        `[monitoring] Tenant ${
          tenantContext.tenantId
        }: using ${
          isMockAdapter
            ? "mock"
            : "Google"
        } analytics adapter.`
      );

      let sessions;
      let searchConsole;
      let rankings;

      try {
        [
          sessions,
          searchConsole,
          rankings,
        ] = await Promise.all([
          analyticsAdapter.getSessions(
            websiteUrl,
            PERIOD_DAYS
          ),

          analyticsAdapter.getSearchConsoleData(
            websiteUrl,
            PERIOD_DAYS
          ),

          analyticsAdapter.getRankings(
            websiteUrl,
            keywords
          ),
        ]);
      } catch (error) {
        if (isMockAdapter) {
          throw error;
        }

        console.warn(
          `[monitoring] Google Analytics adapter failed for tenant ${tenantContext.tenantId}, falling back to mock analytics:`,
          error
        );

        const fallbackAdapter =
          new MockAnalyticsAdapter();

        [
          sessions,
          searchConsole,
          rankings,
        ] = await Promise.all([
          fallbackAdapter.getSessions(
            websiteUrl,
            PERIOD_DAYS
          ),

          fallbackAdapter.getSearchConsoleData(
            websiteUrl,
            PERIOD_DAYS
          ),

          fallbackAdapter.getRankings(
            websiteUrl,
            keywords
          ),
        ]);
      }

      /* ====================================
         RECONCILE RANKING VS TRAFFIC

         Compares this run's average ranking
         position against the previous
         monitoring run's session count to
         flag mismatches a human should look
         at - e.g. rankings improving while
         traffic stays flat can mean the win
         isn't for a query anyone searches.
      ==================================== */

      const previousSnapshot =
        await getLatestMonitoringSnapshot(
          tenantContext.schema
        );

      const insights: MonitoringInsight[] =
        [];

      const currentAvgPosition =
        averagePosition(
          rankings.keywords
        );

      const priorAvgPosition =
        averagePreviousPosition(
          rankings.keywords
        );

      const rankingImproved =
        currentAvgPosition !== null &&
        priorAvgPosition !== null &&
        priorAvgPosition -
          currentAvgPosition >=
          RANKING_IMPROVED_THRESHOLD;

      if (previousSnapshot) {
        const previousMetrics =
          previousSnapshot.metrics as
            | {
                sessions?: {
                  totalSessions?: number;
                };
              }
            | null;

        const previousSessions =
          previousMetrics?.sessions
            ?.totalSessions ?? null;

        if (
          previousSessions !== null &&
          previousSessions > 0
        ) {
          const sessionChangeRatio =
            Math.abs(
              sessions.totalSessions -
                previousSessions
            ) / previousSessions;

          const trafficFlat =
            sessionChangeRatio <=
            TRAFFIC_FLAT_THRESHOLD_RATIO;

          if (
            rankingImproved &&
            trafficFlat
          ) {
            insights.push({
              type: "ranking_up_traffic_flat",
              message: `Average ranking improved by ${(
                priorAvgPosition! -
                currentAvgPosition!
              ).toFixed(
                1
              )} position(s), but sessions barely moved (${previousSessions} -> ${
                sessions.totalSessions
              }). The ranking gain may be for low-search-volume queries.`,
            });
          }
        }
      }

      if (rankingImproved) {
        insights.push({
          type: "ranking_improved",
          message: `Average keyword position improved from ${priorAvgPosition!.toFixed(
            1
          )} to ${currentAvgPosition!.toFixed(
            1
          )}.`,
        });
      }

      if (publishedTasks.length > 0) {
        insights.push({
          type: "changes_published",
          message: `${publishedTasks.length} change(s) have been published since the last check.`,
        });
      } else {
        insights.push({
          type: "no_changes_published",
          message:
            "No content or fixes have been published yet - run Execution and publish approved tasks to start seeing their impact here.",
        });
      }

      /* ====================================
         SAVE SNAPSHOT
      ==================================== */

      const snapshotDate =
        new Date()
          .toISOString()
          .slice(0, 10);

      const savedSnapshot =
        await saveMonitoringSnapshot(
          tenantContext.schema,
          {
            snapshotDate,

            visibilityScore:
              auditReport.overallScore,

            citationScore:
              auditReport.geoCitationScore,

            technicalScore:
              auditReport.technicalSeoScore,

            contentScore:
              auditReport.contentQualityScore,

            competitorScore:
              auditReport.competitorGapScore,

            metrics: {
              sessions,
              searchConsole,
              rankings,
              publishedTaskCount:
                publishedTasks.length,
              insights,
            },
          }
        );

      const result: MonitoringAgentResult =
        {
          tenantId:
            tenantContext.tenantId,

          schemaName:
            tenantContext.schema,

          snapshotId: savedSnapshot.id,

          snapshotDate:
            savedSnapshot.snapshotDate,

          visibilityScore:
            savedSnapshot.visibilityScore,

          citationScore:
            savedSnapshot.citationScore,

          technicalScore:
            savedSnapshot.technicalScore,

          contentScore:
            savedSnapshot.contentScore,

          competitorScore:
            savedSnapshot.competitorScore,

          publishedTaskCount:
            publishedTasks.length,

          insights,

          generatedAt:
            new Date().toISOString(),
        };

      return {
        success: true,
        data: result,
        metadata: {
          agent: this.name,
          operation: "monitoring",
        },
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Monitoring run failed.",
        metadata: {
          agent: this.name,
          operation: "monitoring",
        },
      };
    }
  }
}
