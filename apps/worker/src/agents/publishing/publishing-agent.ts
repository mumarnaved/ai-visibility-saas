import {
  validateTenantContext,
  type Agent,
  type AgentInput,
  type AgentOutput,
} from "agent-contracts";

import {
  publishingInputSchema,
  type PublishingInput,
} from "./publishing-input.js";

import type {
  PublishingAgentResult,
} from "./publishing-result.js";

import {
  MockCmsAdapter,
  type CmsAdapter,
} from "../shared/cms-adapter.js";

import {
  getExecutionTaskById,
  markExecutionTaskPublished,
} from "../../database/postgres/execution-tasks/execution-tasks-repository.js";

import {
  savePublishLog,
} from "../../database/postgres/publish-logs/publish-logs-repository.js";

/* ========================================
   READ CONTENT DRAFT

   Mirrors ContentDraft from the
   content-production agent - read back
   here as unknown JSONB, so it is
   re-parsed defensively.
======================================== */

interface PublishableDraft {
  title: string;
  body: string;
  metaTitle: string | null;
  metaDescription: string | null;
}

function readContentDraft(
  value: unknown
): PublishableDraft {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error(
      "Execution task has no publishable draft content."
    );
  }

  const record =
    value as Record<string, unknown>;

  const title =
    typeof record.title === "string"
      ? record.title
      : null;

  const body =
    typeof record.body === "string"
      ? record.body
      : null;

  if (!title || !body) {
    throw new Error(
      "Execution task draft is missing a title or body."
    );
  }

  return {
    title,
    body,
    metaTitle:
      typeof record.metaTitle === "string"
        ? record.metaTitle
        : null,
    metaDescription:
      typeof record.metaDescription ===
      "string"
        ? record.metaDescription
        : null,
  };
}

/* ========================================
   PUBLISHING AGENT

   Every publish requires the target
   execution_tasks row to already be
   approval_status = 'approved' - set only
   via the separate
   /execution-tasks/:id/approve route. This
   agent never approves a task itself, so
   there is no path from "generated" to
   "published" that skips human approval.
======================================== */

export class PublishingAgent
  implements Agent<
    PublishingInput,
    PublishingAgentResult
  >
{
  readonly name = "publishing";

  constructor(
    private readonly cmsAdapter: CmsAdapter = new MockCmsAdapter()
  ) {}

  async execute(
    input: AgentInput<PublishingInput>
  ): Promise<
    AgentOutput<PublishingAgentResult>
  > {
    try {
      const tenantContext =
        validateTenantContext(
          input.tenantContext
        );

      const parsedInput =
        publishingInputSchema.parse(
          input.payload
        );

      if (
        tenantContext.tenantId !==
        parsedInput.tenantId
      ) {
        throw new Error(
          "Tenant context does not match publishing input."
        );
      }

      const task =
        await getExecutionTaskById(
          tenantContext.schema,
          parsedInput.executionTaskId
        );

      if (!task) {
        throw new Error(
          "Execution task not found."
        );
      }

      if (task.taskType !== "content_draft") {
        throw new Error(
          `Only content_draft tasks can be published (got "${task.taskType}").`
        );
      }

      if (task.approvalStatus !== "approved") {
        throw new Error(
          "Execution task has not been approved. Approve it via /execution-tasks/:id/approve before publishing."
        );
      }

      if (task.status === "published") {
        throw new Error(
          "Execution task has already been published."
        );
      }

      const draft = readContentDraft(
        task.result
      );

      const publishResult =
        await this.cmsAdapter.publish({
          title: draft.title,
          body: draft.body,
          metaTitle: draft.metaTitle,
          metaDescription:
            draft.metaDescription,
        });

      const publishLog =
        await savePublishLog(
          tenantContext.schema,
          {
            executionTaskId: task.id,

            destination: "mock-cms",

            status: publishResult.success
              ? "published"
              : "failed",

            approvalStatus: "approved",

            payload: {
              title: draft.title,
              metaTitle: draft.metaTitle,
              metaDescription:
                draft.metaDescription,
            },

            response: publishResult,

            publishedAt:
              publishResult.success
                ? publishResult.publishedAt
                : null,
          }
        );

      if (publishResult.success) {
        await markExecutionTaskPublished(
          tenantContext.schema,
          task.id
        );
      }

      if (!publishResult.success) {
        throw new Error(
          publishResult.message ||
            "CMS publish failed."
        );
      }

      const result: PublishingAgentResult =
        {
          tenantId:
            tenantContext.tenantId,

          schemaName:
            tenantContext.schema,

          executionTaskId: task.id,

          publishLogId: publishLog.id,

          success: publishResult.success,

          url: publishResult.url ?? null,

          externalId:
            publishResult.externalId ??
            null,

          publishedAt:
            publishResult.publishedAt,
        };

      return {
        success: true,
        data: result,
        metadata: {
          agent: this.name,
          operation: "publishing",
        },
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Publishing failed.",
        metadata: {
          agent: this.name,
          operation: "publishing",
        },
      };
    }
  }
}
