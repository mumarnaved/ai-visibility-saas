import {
  validateTenantContext,
  type Agent,
  type AgentInput,
  type AgentOutput,
} from "agent-contracts";

import {
  contentEntityAuditInputSchema,
  type ContentEntityAuditInput,
} from "./content-entity-audit-input.js";

import type {
  ContentEntityAuditResult,
  ContentEntityFinding,
} from "./content-entity-audit-result.js";

import {
  getWebsiteAnalysis,
} from "../../services/firecrawl-website-analyzer.js";

import {
  saveContentEntityAudit,
} from "../../database/postgres/content-entity/content-entity-audit-repository.js";

export class ContentEntityAuditAgent
  implements Agent<
    ContentEntityAuditInput,
    ContentEntityAuditResult
  >
{
  readonly name =
    "content-entity-audit";

  async execute(
    input: AgentInput<ContentEntityAuditInput>
  ): Promise<
    AgentOutput<ContentEntityAuditResult>
  > {
    try {
      /*
       * Validate tenant execution context.
       */
      const tenantContext =
        validateTenantContext(
          input.tenantContext
        );

      /*
       * Validate audit payload.
       */
      const auditInput =
        contentEntityAuditInputSchema.parse(
          input.payload
        );

      /*
       * Prevent tenant mismatch.
       */
      if (
        tenantContext.tenantId !==
        auditInput.tenantId
      ) {
        throw new Error(
          "Tenant context does not match content/entity audit input."
        );
      }

      /*
       * Firecrawl first (handles JS-rendered
       * pages, real markdown/metadata
       * extraction), falling back to the
       * regex analyzer on any failure.
       */
      const analysis =
        await getWebsiteAnalysis(
          auditInput.websiteUrl
        );

      const contentFindings:
        ContentEntityFinding[] = [];

      const entityFindings:
        ContentEntityFinding[] = [];

      /*
       * CONTENT QUALITY CHECKS
       */

      if (
        analysis.content.wordCount <
        300
      ) {
        contentFindings.push({
          category:
            "content-depth",
          severity:
            "medium",
          title:
            "Low content depth detected",
          description:
            `The page contains approximately ${analysis.content.wordCount} words of visible text.`,
          recommendation:
            "Expand the page with useful, original information that directly satisfies the intended user search intent.",
        });
      }

      if (
        analysis.content.wordCount <
        150
      ) {
        contentFindings.push({
          category:
            "content-depth",
          severity:
            "high",
          title:
            "Very limited visible content",
          description:
            `Only approximately ${analysis.content.wordCount} words of visible text were detected.`,
          recommendation:
            "Add substantial useful content covering the page's main topic, questions, entities and supporting information.",
        });
      }

      if (
        analysis.headings.h1.length ===
        0
      ) {
        contentFindings.push({
          category:
            "content-structure",
          severity:
            "high",
          title:
            "No primary content heading",
          description:
            "The page does not contain an H1 heading that clearly identifies the primary topic.",
          recommendation:
            "Add one descriptive H1 representing the main topic of the page.",
        });
      }

      if (
        analysis.headings.h2.length ===
        0
      ) {
        contentFindings.push({
          category:
            "content-structure",
          severity:
            "medium",
          title:
            "Limited section structure",
          description:
            "No H2 headings were detected on the page.",
          recommendation:
            "Organize substantial sections with descriptive H2 headings where appropriate.",
        });
      }

      if (
        analysis.headings.h3.length ===
        0 &&
        analysis.headings.h2.length >
          2
      ) {
        contentFindings.push({
          category:
            "content-structure",
          severity:
            "low",
          title:
            "Subsection structure could be improved",
          description:
            "Multiple H2 sections exist without any detected H3 subsections.",
          recommendation:
            "Consider using H3 headings for meaningful subsections where they improve content organization.",
        });
      }

      if (
        !analysis.title
      ) {
        contentFindings.push({
          category:
            "content-discoverability",
          severity:
            "high",
          title:
            "Missing title signal",
          description:
            "No usable HTML title was detected.",
          recommendation:
            "Create a clear title that communicates the primary subject of the page.",
        });
      }

      if (
        !analysis.description
      ) {
        contentFindings.push({
          category:
            "content-discoverability",
          severity:
            "medium",
          title:
            "Missing description signal",
          description:
            "No meta description was detected.",
          recommendation:
            "Add a concise description explaining the page's purpose and primary topic.",
        });
      }

      /*
       * ENTITY SIGNALS
       *
       * These are deterministic signals derived
       * from existing page content. We do not
       * invent entities or call an AI provider.
       */

      const titleSignals =
        analysis.title
          ? [analysis.title]
          : [];

      const headingSignals = [
        ...analysis.headings.h1,
        ...analysis.headings.h2,
        ...analysis.headings.h3,
      ];

      const topicSignals =
        headingSignals.slice(
          0,
          20
        );

      if (
        titleSignals.length ===
          0 &&
        headingSignals.length ===
          0
      ) {
        entityFindings.push({
          category:
            "entity-signals",
          severity:
            "high",
          title:
            "Weak entity and topic signals",
          description:
            "The page does not expose a usable title or heading structure from which the primary topic can be identified.",
          recommendation:
            "Clearly identify the main subject, organization, product, service or topic through descriptive page titles and headings.",
        });
      }

      if (
        headingSignals.length <
        3
      ) {
        entityFindings.push({
          category:
            "topic-coverage",
          severity:
            "medium",
          title:
            "Limited topic signals",
          description:
            `Only ${headingSignals.length} heading signal(s) were detected.`,
          recommendation:
            "Expand the page structure with meaningful headings covering important subtopics and user questions.",
        });
      }

      if (
        analysis.links.internal <
        3
      ) {
        entityFindings.push({
          category:
            "entity-context",
          severity:
            "low",
          title:
            "Limited internal contextual linking",
          description:
            `Only ${analysis.links.internal} internal link(s) were detected.`,
          recommendation:
            "Add relevant internal links to related pages so important topics and entities have stronger contextual relationships.",
        });
      }

      /*
       * SCORE
       *
       * Start at 100 and deduct based on
       * content/entity findings.
       */
      let score = 100;

      for (
        const finding of [
          ...contentFindings,
          ...entityFindings,
        ]
      ) {
        if (
          finding.severity ===
          "critical"
        ) {
          score -= 20;
        } else if (
          finding.severity ===
          "high"
        ) {
          score -= 15;
        } else if (
          finding.severity ===
          "medium"
        ) {
          score -= 8;
        } else if (
          finding.severity ===
          "low"
        ) {
          score -= 3;
        }
      }

      score =
        Math.max(
          0,
          Math.min(
            100,
            score
          )
        );

      /*
       * Recommendations
       */
      const recommendations =
        [
          ...contentFindings,
          ...entityFindings,
        ]
          .map(
            (finding) =>
              finding.recommendation
          )
          .filter(
            (
              recommendation,
              index,
              values
            ) =>
              values.indexOf(
                recommendation
              ) === index
          );

      /*
       * Summary
       */
      const totalFindings =
        contentFindings.length +
        entityFindings.length;

      let summary =
        "Content and entity audit completed successfully.";

      if (
        totalFindings === 0
      ) {
        summary =
          "The website passed the initial content and entity audit checks with no significant findings.";
      } else {
        summary =
          `Content and entity audit completed with ${totalFindings} improvement opportunity(ies).`;
      }

      /*
       * Persist audit.
       */
      const saved =
        await saveContentEntityAudit(
          tenantContext.schema,
          {
            websiteUrl:
              analysis.url,

            score,

            summary,

            contentFindings,

            entityFindings,

            recommendations,

            contentData: {
              title:
                analysis.title,

              description:
                analysis.description,

              headings:
                analysis.headings,

              wordCount:
                analysis.content
                  .wordCount,

              links:
                analysis.links,
            },

            entityData: {
              titleSignals,

              headingSignals,

              topicSignals,
            },
          }
        );

      /*
       * Build result.
       */
      const result:
        ContentEntityAuditResult =
        {
          tenantId:
            tenantContext.tenantId,

          schemaName:
            tenantContext.schema,

          id:
            saved.id,

          websiteUrl:
            analysis.url,

          status:
            "completed",

          score,

          summary,

          contentFindings,

          entityFindings,

          recommendations,

          contentData: {
            title:
              analysis.title,

            description:
              analysis.description,

            headings:
              analysis.headings,

            wordCount:
              analysis.content
                .wordCount,

            links:
              analysis.links,
          },

          entityData: {
            titleSignals,

            headingSignals,

            topicSignals,
          },

          createdAt:
            saved.createdAt,
        };

      return {
        success: true,

        data: result,

        metadata: {
          agent: this.name,
          operation:
            "content-entity-audit",
        },
      };
    } catch (error) {
      return {
        success: false,

        error:
          error instanceof Error
            ? error.message
            : "Content and entity audit failed.",

        metadata: {
          agent: this.name,
          operation:
            "content-entity-audit",
        },
      };
    }
  }
}