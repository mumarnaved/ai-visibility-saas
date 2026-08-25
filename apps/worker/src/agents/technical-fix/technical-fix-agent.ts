import {
  validateTenantContext,
  type Agent,
  type AgentInput,
  type AgentOutput,
} from "agent-contracts";

import {
  technicalFixInputSchema,
  type TechnicalFixInput,
} from "./technical-fix-input.js";

import type {
  AppliedFixSummary,
  TechnicalFixAgentResult,
} from "./technical-fix-result.js";

import {
  MockCmsAdapter,
  type CmsAdapter,
} from "../shared/cms-adapter.js";

import {
  getLatestContentPlan,
} from "../../database/postgres/content-plan/content-plan-repository.js";

import {
  saveExecutionTask,
} from "../../database/postgres/execution-tasks/execution-tasks-repository.js";

/* ========================================
   PLAN ITEM SHAPES

   Mirrors EntitySchemaPlanItem (area, plan)
   and PrioritizedFixItem (category,
   summary) from the content-plan agent -
   read back here as unknown JSONB, so each
   is re-parsed defensively.
======================================== */

interface FixItem {
  title: string;
  description: string;
}

function readEntityPlanItems(
  value: unknown
): FixItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const items: FixItem[] = [];

  for (const entry of value) {
    if (
      !entry ||
      typeof entry !== "object" ||
      Array.isArray(entry)
    ) {
      continue;
    }

    const record =
      entry as Record<string, unknown>;

    const area =
      typeof record.area === "string"
        ? record.area
        : null;

    const plan =
      typeof record.plan === "string"
        ? record.plan
        : null;

    if (area && plan) {
      items.push({
        title: area,
        description: plan,
      });
    }
  }

  return items;
}

function readTechnicalPlanItems(
  value: unknown
): FixItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const items: FixItem[] = [];

  for (const entry of value) {
    if (
      !entry ||
      typeof entry !== "object" ||
      Array.isArray(entry)
    ) {
      continue;
    }

    const record =
      entry as Record<string, unknown>;

    const category =
      typeof record.category === "string"
        ? record.category
        : null;

    const summary =
      typeof record.summary === "string"
        ? record.summary
        : null;

    if (category && summary) {
      items.push({
        title: category,
        description: summary,
      });
    }
  }

  return items;
}

/* ========================================
   TECHNICAL FIX AGENT
======================================== */

export class TechnicalFixAgent
  implements Agent<
    TechnicalFixInput,
    TechnicalFixAgentResult
  >
{
  readonly name = "technical-fix";

  constructor(
    private readonly cmsAdapter: CmsAdapter = new MockCmsAdapter()
  ) {}

  async execute(
    input: AgentInput<TechnicalFixInput>
  ): Promise<
    AgentOutput<TechnicalFixAgentResult>
  > {
    try {
      const tenantContext =
        validateTenantContext(
          input.tenantContext
        );

      const parsedInput =
        technicalFixInputSchema.parse(
          input.payload
        );

      if (
        tenantContext.tenantId !==
        parsedInput.tenantId
      ) {
        throw new Error(
          "Tenant context does not match technical fix input."
        );
      }

      const plan =
        await getLatestContentPlan(
          tenantContext.schema
        );

      if (!plan) {
        throw new Error(
          "No content plan found. Generate and approve a Stage 2 content plan before running technical fixes."
        );
      }

      if (
        plan.approvalStatus !== "approved"
      ) {
        throw new Error(
          "The latest content plan has not been approved yet."
        );
      }

      const entityItems =
        readEntityPlanItems(
          plan.entityPlan
        );

      const technicalItems =
        readTechnicalPlanItems(
          plan.technicalPlan
        );

      if (
        entityItems.length === 0 &&
        technicalItems.length === 0
      ) {
        throw new Error(
          "The approved content plan has no entity or technical plan items to apply."
        );
      }

      const fixes: AppliedFixSummary[] =
        [];

      const applyGroup = async (
        items: FixItem[],
        taskType:
          | "entity_fix"
          | "technical_fix"
      ) => {
        for (const item of items) {
          const fixResult =
            await this.cmsAdapter.applyFix(
              {
                type: taskType,
                title: item.title,
                description:
                  item.description,
              }
            );

          const savedTask =
            await saveExecutionTask(
              tenantContext.schema,
              {
                contentPlanId: plan.id,

                taskType,

                title: item.title,

                description:
                  item.description,

                status: fixResult.success
                  ? "completed"
                  : "failed",

                approvalStatus: "pending",

                payload: {
                  source:
                    taskType ===
                    "entity_fix"
                      ? "entity_plan"
                      : "technical_plan",
                },

                result: fixResult,
              }
            );

          fixes.push({
            executionTaskId:
              savedTask.id,
            taskType,
            title: item.title,
            success: fixResult.success,
          });
        }
      };

      await applyGroup(
        entityItems,
        "entity_fix"
      );

      await applyGroup(
        technicalItems,
        "technical_fix"
      );

      const result: TechnicalFixAgentResult =
        {
          tenantId:
            tenantContext.tenantId,

          schemaName:
            tenantContext.schema,

          contentPlanId: plan.id,

          fixes,

          generatedAt:
            new Date().toISOString(),
        };

      return {
        success: true,
        data: result,
        metadata: {
          agent: this.name,
          operation: "technical-fix",
        },
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Technical fix run failed.",
        metadata: {
          agent: this.name,
          operation: "technical-fix",
        },
      };
    }
  }
}
