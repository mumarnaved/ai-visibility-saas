import { pool } from "../database/postgres/connection.js";

import { tenantNamespaces } from "../context/tenant-manifest.js";

import { Stage1AuditPipeline } from "../agents/stage-1-audit-pipeline.js";
import { ContentPlanAgent } from "../agents/content-plan/index.js";
import { ContentProductionAgent } from "../agents/content-production/index.js";
import { TechnicalFixAgent } from "../agents/technical-fix/index.js";
import { MonitoringAgent } from "../agents/monitoring/index.js";
import { ReportGenerationAgent } from "../agents/report-generation/index.js";

import { saveContentPlan } from "../database/postgres/content-plan/content-plan-repository.js";

import type { JobRow } from "./job-queue.js";
import {
  NonRetryableJobError,
  type JobRegistry,
} from "./job-runner.js";

/* ========================================
   JOB TYPES

   One handler per Stage 1-4 operation. These
   are the bodies the stage routes used to run
   inline; the routes now validate, enqueue and
   return 202, and the runner calls these.

   A handler throws to fail the attempt. An agent
   that reports success=false has already used
   its own retries and fallback model, so that is
   a NonRetryableJobError; anything else (a
   database blip, a crash) is retried.
======================================== */

export const JOB_TYPES = [
  "stage1-audit",
  "stage2-plan",
  "stage3-produce",
  "stage3-fix",
  "stage4-monitor",
  "stage4-report",
] as const;

export type JobType = (typeof JOB_TYPES)[number];

export const isJobType = (value: string): value is JobType =>
  (JOB_TYPES as readonly string[]).includes(value);

async function tenantSchema(
  tenantId: string
): Promise<string> {
  const result = await pool.query(
    `
      SELECT schema_name
      FROM platform.tenants
      WHERE id = $1
      LIMIT 1
    `,
    [tenantId]
  );

  const schemaName = result.rows[0]?.schema_name;

  if (typeof schemaName !== "string") {
    throw new NonRetryableJobError("Tenant not found.");
  }

  return schemaName;
}

async function tenantContext(job: JobRow) {
  const tenantId = job.tenant_id;

  return {
    tenantId,
    schema: await tenantSchema(tenantId),
    ...tenantNamespaces(tenantId),
  };
}

/* Runs an agent and unwraps its output, or fails the job. */
async function runAgent(
  job: JobRow,
  agent: {
    execute(input: {
      tenantContext: Awaited<ReturnType<typeof tenantContext>>;
      payload: { tenantId: string };
    }): Promise<{ success: boolean; data?: unknown; error?: string }>;
  },
  failureMessage: string
): Promise<unknown> {
  const output = await agent.execute({
    tenantContext: await tenantContext(job),
    payload: { tenantId: job.tenant_id },
  });

  if (!output.success || !output.data) {
    throw new NonRetryableJobError(output.error || failureMessage);
  }

  return output.data;
}

/* ========================================
   REGISTRY
======================================== */

export const jobHandlers: JobRegistry = {
  "stage1-audit": async (job) => {
    const { websiteUrl, brandName, queries, competitors } =
      job.payload as {
        websiteUrl?: string;
        brandName?: string;
        queries?: unknown[];
        competitors?: Array<{ name: string; websiteUrl?: string }>;
      };

    if (
      typeof websiteUrl !== "string" ||
      typeof brandName !== "string" ||
      !Array.isArray(queries)
    ) {
      throw new NonRetryableJobError(
        "stage1-audit job payload is incomplete."
      );
    }

    return new Stage1AuditPipeline().execute({
      tenantContext: await tenantContext(job),
      websiteUrl,
      brandName,
      queries: queries as never,
      competitors: competitors ?? [],
    });
  },

  "stage2-plan": async (job) => {
    const context = await tenantContext(job);

    const generated = (await runAgent(
      job,
      new ContentPlanAgent() as never,
      "Content plan generation failed."
    )) as {
      auditReportId: string;
      summary: unknown;
      contentGapMap: unknown;
      entitySchemaPlan: unknown;
      prioritizedFixList: unknown;
      roadmap: unknown;
    };

    return saveContentPlan(context.schema, {
      auditReportId: generated.auditReportId,
      summary: generated.summary,
      contentGaps: generated.contentGapMap,
      entityPlan: generated.entitySchemaPlan,
      technicalPlan: generated.prioritizedFixList,
      roadmap: generated.roadmap,
    } as never);
  },

  "stage3-produce": (job) =>
    runAgent(
      job,
      new ContentProductionAgent() as never,
      "Content production failed."
    ),

  "stage3-fix": (job) =>
    runAgent(
      job,
      new TechnicalFixAgent() as never,
      "Technical fix run failed."
    ),

  "stage4-monitor": (job) =>
    runAgent(
      job,
      new MonitoringAgent() as never,
      "Monitoring run failed."
    ),

  "stage4-report": (job) =>
    runAgent(
      job,
      new ReportGenerationAgent() as never,
      "Report generation failed."
    ),
};
