import {
  validateTenantContext,
  type Agent,
  type AgentInput,
  type AgentOutput,
} from "agent-contracts";

import {
  contentProductionInputSchema,
  type ContentProductionInput,
} from "./content-production-input.js";

import type {
  ContentDraft,
  ContentProductionAgentResult,
  ContentProductionTaskSummary,
} from "./content-production-result.js";

import {
  runOpenRouter,
} from "../shared/openrouter-provider.js";

import {
  getLatestContentPlan,
} from "../../database/postgres/content-plan/content-plan-repository.js";

import {
  saveExecutionTask,
} from "../../database/postgres/execution-tasks/execution-tasks-repository.js";

import {
  getTenantById,
} from "../../database/postgres/tenant-registry.js";

/* ========================================
   CONTENT GAP ITEM

   Mirrors ContentGapItem from the content-plan
   agent (area, score, status, gap) - read back
   here as unknown JSONB, so it is re-parsed
   defensively rather than trusted.
======================================== */

interface ContentGapItem {
  area: string;
  gap: string;
}

function readContentGaps(
  value: unknown
): ContentGapItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const items: ContentGapItem[] = [];

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

    const gap =
      typeof record.gap === "string"
        ? record.gap
        : null;

    if (area && gap) {
      items.push({ area, gap });
    }
  }

  return items;
}

/* ========================================
   PROMPT
======================================== */

const SYSTEM_PROMPT =
  "You are an expert SEO content writer producing draft web content for a company's website. Respond with ONLY a single valid JSON object (no markdown code fences, no commentary) matching exactly this shape: " +
  '{"title": string, "body": string, "metaTitle": string, "metaDescription": string, "faq": [{"question": string, "answer": string}]}. ' +
  "The body must be well-structured markdown (headings, short paragraphs, and a bulleted or numbered list where useful) of roughly 300-600 words that directly closes the described content gap. " +
  "metaTitle must be 60 characters or fewer. metaDescription must be 155 characters or fewer. Include 3 to 5 FAQ entries relevant to the topic. " +
  "All newlines inside string values must be encoded as the two characters backslash and n, never a literal line break. Ensure the JSON is syntactically valid and parses with a strict JSON parser.";

function buildUserPrompt(
  brandName: string,
  websiteUrl: string,
  gap: ContentGapItem
): string {
  return `Company: ${brandName}\nWebsite: ${websiteUrl}\nContent gap area: ${gap.area}\nGap description: ${gap.gap}\n\nWrite a draft content page that closes this gap.`;
}

function extractJsonObject(
  raw: string
): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(
      /\{[\s\S]*\}/
    );

    if (!match) {
      throw new Error(
        "OpenRouter response did not contain a JSON object."
      );
    }

    return JSON.parse(match[0]);
  }
}

function parseContentDraft(
  raw: string,
  gap: ContentGapItem
): ContentDraft {
  try {
    const parsed = extractJsonObject(
      raw
    ) as Record<string, unknown>;

    const faqSource = Array.isArray(
      parsed.faq
    )
      ? parsed.faq
      : [];

    return {
      title:
        typeof parsed.title === "string" &&
        parsed.title.trim()
          ? parsed.title.trim()
          : gap.area,

      body:
        typeof parsed.body === "string" &&
        parsed.body.trim()
          ? parsed.body.trim()
          : raw.trim(),

      metaTitle:
        typeof parsed.metaTitle ===
          "string" &&
        parsed.metaTitle.trim()
          ? parsed.metaTitle
              .trim()
              .slice(0, 60)
          : gap.area.slice(0, 60),

      metaDescription:
        typeof parsed.metaDescription ===
          "string" &&
        parsed.metaDescription.trim()
          ? parsed.metaDescription
              .trim()
              .slice(0, 155)
          : gap.gap.slice(0, 155),

      faq: faqSource
        .filter(
          (
            item
          ): item is Record<
            string,
            unknown
          > =>
            !!item &&
            typeof item === "object"
        )
        .map((item) => ({
          question:
            typeof item.question ===
            "string"
              ? item.question
              : "",

          answer:
            typeof item.answer ===
            "string"
              ? item.answer
              : "",
        }))
        .filter(
          (item) =>
            item.question && item.answer
        ),
    };
  } catch {
    /*
     * The model did not return valid JSON.
     * Fall back to a plain-text draft
     * rather than failing the whole task -
     * a human still reviews every draft
     * before it can be approved/published.
     */
    return {
      title: gap.area,
      body: raw.trim(),
      metaTitle: gap.area.slice(0, 60),
      metaDescription: gap.gap.slice(
        0,
        155
      ),
      faq: [],
    };
  }
}

/* ========================================
   CONTENT PRODUCTION AGENT
======================================== */

export class ContentProductionAgent
  implements Agent<
    ContentProductionInput,
    ContentProductionAgentResult
  >
{
  readonly name = "content-production";

  async execute(
    input: AgentInput<ContentProductionInput>
  ): Promise<
    AgentOutput<ContentProductionAgentResult>
  > {
    try {
      const tenantContext =
        validateTenantContext(
          input.tenantContext
        );

      const parsedInput =
        contentProductionInputSchema.parse(
          input.payload
        );

      if (
        tenantContext.tenantId !==
        parsedInput.tenantId
      ) {
        throw new Error(
          "Tenant context does not match content production input."
        );
      }

      const tenant =
        await getTenantById(
          tenantContext.tenantId
        );

      if (!tenant) {
        throw new Error(
          "Tenant not found."
        );
      }

      const plan =
        await getLatestContentPlan(
          tenantContext.schema
        );

      if (!plan) {
        throw new Error(
          "No content plan found. Generate and approve a Stage 2 content plan before running content production."
        );
      }

      if (
        plan.approvalStatus !== "approved"
      ) {
        throw new Error(
          "The latest content plan has not been approved yet."
        );
      }

      const gaps = readContentGaps(
        plan.contentGaps
      );

      if (gaps.length === 0) {
        throw new Error(
          "The approved content plan has no content gaps to produce drafts for."
        );
      }

      const brandName =
        tenant.name || tenant.websiteUrl || "the brand";

      const websiteUrl =
        tenant.websiteUrl ?? "";

      const tasks: ContentProductionTaskSummary[] =
        [];

      for (const gap of gaps) {
        const aiResponse =
          await runOpenRouter(
            buildUserPrompt(
              brandName,
              websiteUrl,
              gap
            ),
            SYSTEM_PROMPT,
            2000,
            true
          );

        const draft =
          parseContentDraft(
            aiResponse.response,
            gap
          );

        const savedTask =
          await saveExecutionTask(
            tenantContext.schema,
            {
              contentPlanId: plan.id,

              taskType: "content_draft",

              title: draft.title,

              description: `Draft content for content gap: ${gap.area}`,

              status: "completed",

              approvalStatus: "pending",

              payload: {
                gapArea: gap.area,
                gapDescription: gap.gap,
                provider:
                  aiResponse.provider,
                model: aiResponse.model,
              },

              result: draft,
            }
          );

        tasks.push({
          executionTaskId: savedTask.id,
          gapArea: gap.area,
          title: draft.title,
        });
      }

      const result: ContentProductionAgentResult =
        {
          tenantId:
            tenantContext.tenantId,

          schemaName:
            tenantContext.schema,

          contentPlanId: plan.id,

          tasks,

          generatedAt:
            new Date().toISOString(),
        };

      return {
        success: true,
        data: result,
        metadata: {
          agent: this.name,
          operation: "content-production",
        },
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Content production failed.",
        metadata: {
          agent: this.name,
          operation: "content-production",
        },
      };
    }
  }
}
