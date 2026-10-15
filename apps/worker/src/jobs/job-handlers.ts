import {
  Stage1AuditPipeline,
  AgentStepFailedError,
} from "../agents/stage-1-audit-pipeline.js";

import { saveContentPlan } from "../database/postgres/content-plan/content-plan-repository.js";

import {
  TenantNotUsableError,
  type TenantRuntime,
} from "../context/build-tenant-context.js";
import { buildTenantContext } from "../context/tenant-context-instance.js";

import {
  OrchestratorError,
  type Orchestrator,
} from "../orchestrator/orchestrator.js";
import { orchestrator as sharedOrchestrator } from "../orchestrator/orchestrator-instance.js";

import type { JobRow } from "./job-queue.js";
import {
  NonRetryableJobError,
  type JobRegistry,
} from "./job-runner.js";

/* ========================================
   JOB TYPES

   One handler per Stage 1-4 operation. Each builds the
   tenant's context with buildTenantContext() and runs its
   agent(s) through the orchestrator, which guards the
   tenant, records every run, retries transient failures and
   checkpoints finished steps under this job's id.

   What a handler throws decides what the job runner does:
   - NonRetryableJobError: the job fails now (bad input, a
     deleted tenant, an agent failure that would repeat);
   - RateLimitError / StepBudgetExceededError (from the
     orchestrator): the runner defers the job; steps already
     done are checkpointed and are not run or paid for again;
   - anything else: retried with backoff.

   Length: Stage 1 is five steps and may not fit one
   300s invocation. The orchestrator refuses to start a step
   it cannot finish (StepBudgetExceededError), the job is
   parked without using an attempt, and the next invocation
   resumes from the checkpoints. That is the split into
   smaller pieces, with no extra job rows to manage.
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

export interface JobHandlerDeps {
  orchestrator: Orchestrator;
  buildContext: (tenantId: string) => Promise<TenantRuntime>;
}

/* ---------------------------------------- */

function makeHelpers(deps: JobHandlerDeps) {
  async function contextFor(job: JobRow): Promise<TenantRuntime> {
    try {
      return await deps.buildContext(job.tenant_id);
    } catch (error) {
      if (error instanceof TenantNotUsableError) {
        throw new NonRetryableJobError(error.message);
      }

      throw error;
    }
  }

  /* Runs one agent as a checkpointed step of this job and unwraps its data. */
  async function step(
    job: JobRow,
    context: TenantRuntime,
    agentName: string,
    failureMessage: string
  ): Promise<unknown> {
    let output;

    try {
      output = await deps.orchestrator.run(
        context,
        agentName,
        { tenantId: job.tenant_id },
        { jobId: job.id }
      );
    } catch (error) {
      if (
        error instanceof OrchestratorError ||
        error instanceof TenantNotUsableError
      ) {
        throw new NonRetryableJobError(error.message);
      }

      throw error;
    }

    if (!output.success || !output.data) {
      throw new NonRetryableJobError(output.error || failureMessage);
    }

    return output.data;
  }

  return { contextFor, step };
}

/* ========================================
   REGISTRY
======================================== */

export function createJobHandlers(deps: JobHandlerDeps): JobRegistry {
  const { contextFor, step } = makeHelpers(deps);

  return {
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

      const context = await contextFor(job);

      try {
        return await new Stage1AuditPipeline().execute({
          tenantContext: context,
          runAgent: deps.orchestrator.runner(context, {
            jobId: job.id,
          }),
          websiteUrl,
          brandName,
          queries: queries as never,
          competitors: competitors ?? [],
        });
      } catch (error) {
        /* A step that fails the same way every time must not burn the job's retries. */
        if (
          error instanceof AgentStepFailedError &&
          (error.kind === "permanent" || error.kind === "validation")
        ) {
          throw new NonRetryableJobError(error.message);
        }

        if (
          error instanceof OrchestratorError ||
          error instanceof TenantNotUsableError
        ) {
          throw new NonRetryableJobError(error.message);
        }

        throw error;
      }
    },

    "stage2-plan": async (job) => {
      const context = await contextFor(job);

      const generated = (await step(
        job,
        context,
        "content-plan",
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

    "stage3-produce": async (job) =>
      step(
        job,
        await contextFor(job),
        "content-production",
        "Content production failed."
      ),

    "stage3-fix": async (job) =>
      step(
        job,
        await contextFor(job),
        "technical-fix",
        "Technical fix run failed."
      ),

    "stage4-monitor": async (job) =>
      step(
        job,
        await contextFor(job),
        "monitoring",
        "Monitoring run failed."
      ),

    "stage4-report": async (job) =>
      step(
        job,
        await contextFor(job),
        "report-generation",
        "Report generation failed."
      ),
  };
}

/* The registry the server uses: real tenant context, shared orchestrator. */
export const jobHandlers: JobRegistry = createJobHandlers({
  orchestrator: sharedOrchestrator,
  buildContext: (tenantId) => buildTenantContext(tenantId),
});
