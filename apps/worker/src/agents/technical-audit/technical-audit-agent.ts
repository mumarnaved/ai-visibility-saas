import {
  validateTenantContext,
  type Agent,
  type AgentInput,
  type AgentOutput,
} from "agent-contracts";

import {
  technicalAuditInputSchema,
  type TechnicalAuditInput,
} from "./technical-audit-input.js";

import type {
  TechnicalAuditResult,
  TechnicalAuditFinding,
} from "./technical-audit-result.js";

import {
  analyzeWebsite,
} from "../../services/website-analyzer.js";

import {
  saveTechnicalAudit,
} from "../../database/postgres/technical-audit/technical-audit-repository.js";

export class TechnicalAuditAgent
  implements Agent<
    TechnicalAuditInput,
    TechnicalAuditResult
  >
{
  readonly name = "technical-audit";

  async execute(
    input: AgentInput<TechnicalAuditInput>
  ): Promise<AgentOutput<TechnicalAuditResult>> {
    try {
      /*
       * Every Stage 1 agent must have an
       * explicit tenant context.
       */
      const tenantContext =
        validateTenantContext(
          input.tenantContext
        );

      const auditInput =
        technicalAuditInputSchema.parse(
          input.payload
        );

      /*
       * Prevent tenant confusion between
       * the payload and execution context.
       */
      if (
        tenantContext.tenantId !==
        auditInput.tenantId
      ) {
        throw new Error(
          "Tenant context does not match technical audit input."
        );
      }

      /*
       * Run the existing website analyzer.
       *
       * We reuse the existing implementation
       * instead of replacing working code.
       */
      const analysis =
        await analyzeWebsite(
          auditInput.websiteUrl
        );

      /*
       * Fetch the final page once more so that
       * the technical audit can inspect HTTP
       * status and response headers.
       */
      const response =
        await fetch(
          analysis.finalUrl,
          {
            headers: {
              "User-Agent":
                "AI-Visibility-Technical-Audit/1.0",
              Accept:
                "text/html,application/xhtml+xml",
            },
            redirect: "follow",
          }
        );

      const serverHeaders: Record<
        string,
        string
      > = {};

      response.headers.forEach(
        (value, key) => {
          serverHeaders[key] = value;
        }
      );

      /*
       * Check robots.txt.
       */
      const robotsUrl =
        new URL(
          "/robots.txt",
          analysis.finalUrl
        );

      const robotsResponse =
        await fetch(
          robotsUrl,
          {
            headers: {
              "User-Agent":
                "AI-Visibility-Technical-Audit/1.0",
            },
            redirect: "follow",
          }
        );

      const robotsTxtAvailable =
        robotsResponse.ok &&
        (
          robotsResponse.headers.get(
            "content-type"
          ) ?? ""
        ).toLowerCase().includes(
          "text"
        );

      /*
       * Check sitemap.xml.
       */
      const sitemapUrl =
        new URL(
          "/sitemap.xml",
          analysis.finalUrl
        );

      const sitemapResponse =
        await fetch(
          sitemapUrl,
          {
            headers: {
              "User-Agent":
                "AI-Visibility-Technical-Audit/1.0",
            },
            redirect: "follow",
          }
        );

      const sitemapAvailable =
        sitemapResponse.ok;

      const findings:
        TechnicalAuditFinding[] = [];

      /*
       * HTTPS
       */
      if (
        !analysis.finalUrl
          .toLowerCase()
          .startsWith("https://")
      ) {
        findings.push({
          category: "security",
          severity: "high",
          title:
            "Website is not using HTTPS",
          description:
            "The audited URL does not resolve to an HTTPS URL.",
          recommendation:
            "Serve the website over HTTPS and redirect HTTP traffic to HTTPS.",
        });
      }

      /*
       * Redirect
       */
      if (
        analysis.url !==
        analysis.finalUrl
      ) {
        findings.push({
          category: "crawlability",
          severity: "low",
          title:
            "Website redirects to another URL",
          description:
            `The requested URL redirects to ${analysis.finalUrl}.`,
          recommendation:
            "Use the canonical destination URL consistently in internal links, sitemaps and canonical tags.",
        });
      }

      /*
       * Title
       */
      if (!analysis.seo.hasTitle) {
        findings.push({
          category: "on-page-seo",
          severity: "high",
          title:
            "Missing page title",
          description:
            "The page does not contain a usable title element.",
          recommendation:
            "Add a unique, descriptive HTML title to the page.",
        });
      } else if (
        analysis.title &&
        (
          analysis.title.length < 10 ||
          analysis.title.length > 70
        )
      ) {
        findings.push({
          category: "on-page-seo",
          severity: "medium",
          title:
            "Page title length should be reviewed",
          description:
            `The page title contains ${analysis.title.length} characters.`,
          recommendation:
            "Use a concise, descriptive title that accurately represents the page.",
        });
      }

      /*
       * Meta description
       */
      if (
        !analysis.seo.hasDescription
      ) {
        findings.push({
          category: "on-page-seo",
          severity: "high",
          title:
            "Missing meta description",
          description:
            "The page does not contain a meta description.",
          recommendation:
            "Add a unique and useful meta description for the page.",
        });
      } else if (
        analysis.description &&
        (
          analysis.description.length < 50 ||
          analysis.description.length > 170
        )
      ) {
        findings.push({
          category: "on-page-seo",
          severity: "low",
          title:
            "Meta description length should be reviewed",
          description:
            `The meta description contains ${analysis.description.length} characters.`,
          recommendation:
            "Review the description so it clearly summarizes the page without unnecessary length.",
        });
      }

      /*
       * H1
       */
      if (
        analysis.headings.h1.length === 0
      ) {
        findings.push({
          category: "content-structure",
          severity: "high",
          title:
            "Missing H1 heading",
          description:
            "The page does not contain an H1 heading.",
          recommendation:
            "Add one clear primary heading describing the main topic of the page.",
        });
      } else if (
        analysis.headings.h1.length > 1
      ) {
        findings.push({
          category: "content-structure",
          severity: "medium",
          title:
            "Multiple H1 headings detected",
          description:
            `The page contains ${analysis.headings.h1.length} H1 headings.`,
          recommendation:
            "Review the heading hierarchy and ensure the primary page topic is represented clearly.",
        });
      }

      /*
       * Images
       */
      if (
        analysis.images.withoutAlt > 0
      ) {
        findings.push({
          category: "accessibility",
          severity: "medium",
          title:
            "Images are missing alt text",
          description:
            `${analysis.images.withoutAlt} of ${analysis.images.total} images do not have useful alt text.`,
          recommendation:
            "Add descriptive alt text to meaningful images and use empty alt text only for decorative images.",
        });
      }

      /*
       * Content depth
       */
      if (
        analysis.content.wordCount < 300
      ) {
        findings.push({
          category: "content",
          severity: "medium",
          title:
            "Low visible text content",
          description:
            `The page contains approximately ${analysis.content.wordCount} words of visible text.`,
          recommendation:
            "Review whether the page provides enough useful information for its intended search intent.",
        });
      }

      /*
       * Robots
       */
      if (
        !robotsTxtAvailable
      ) {
        findings.push({
          category: "crawlability",
          severity: "medium",
          title:
            "robots.txt was not detected",
          description:
            "A usable robots.txt file was not found at the site's root.",
          recommendation:
            "Create and validate a robots.txt file that clearly communicates crawl rules.",
        });
      }

      /*
       * Sitemap
       */
      if (
        !sitemapAvailable
      ) {
        findings.push({
          category: "indexability",
          severity: "medium",
          title:
            "XML sitemap was not detected",
          description:
            "The expected /sitemap.xml endpoint was not available.",
          recommendation:
            "Publish an XML sitemap and submit it to relevant search platforms.",
        });
      }

      /*
       * Calculate score.
       *
       * Start from the existing basic SEO
       * score and apply deductions for
       * additional technical findings.
       */
      let score =
        analysis.seo.score;

      for (
        const finding of findings
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
          score -= 10;
        } else if (
          finding.severity ===
          "medium"
        ) {
          score -= 5;
        } else if (
          finding.severity ===
          "low"
        ) {
          score -= 2;
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
       * Generate a simple human-readable
       * summary.
       */
      let summary =
        "Technical audit completed successfully.";

      if (
        findings.length === 0
      ) {
        summary =
          "The website passed the initial technical audit checks with no significant findings.";
      } else {
        const highPriorityCount =
          findings.filter(
            (finding) =>
              finding.severity ===
                "critical" ||
              finding.severity ===
                "high"
          ).length;

        if (
          highPriorityCount > 0
        ) {
          summary =
            `Technical audit completed with ${findings.length} findings, including ${highPriorityCount} high-priority issue(s) that should be addressed first.`;
        } else {
          summary =
            `Technical audit completed with ${findings.length} improvement opportunity(ies).`;
        }
      }

      /*
       * Persist inside the tenant schema.
       */
      const saved =
        await saveTechnicalAudit(
          tenantContext.schema,
          {
            websiteUrl:
              analysis.url,
            finalUrl:
              analysis.finalUrl,
            score,
            summary,
            findings,
            crawlData: {
              finalUrl:
                analysis.finalUrl,

              statusCode:
                response.status,

              contentType:
                response.headers.get(
                  "content-type"
                ) ?? "",

              https:
                analysis.finalUrl
                  .toLowerCase()
                  .startsWith(
                    "https://"
                  ),

              redirected:
                analysis.url !==
                analysis.finalUrl,

              title:
                analysis.title,

              description:
                analysis.description,

              headings:
                analysis.headings,

              links:
                analysis.links,

              images:
                analysis.images,

              wordCount:
                analysis.content
                  .wordCount,
            },

            seoData: {
              hasTitle:
                analysis.seo
                  .hasTitle,

              titleLength:
                analysis.title
                  ?.length ?? 0,

              hasDescription:
                analysis.seo
                  .hasDescription,

              descriptionLength:
                analysis.description
                  ?.length ?? 0,

              h1Count:
                analysis.headings
                  .h1.length,

              imagesWithoutAlt:
                analysis.images
                  .withoutAlt,

              robotsTxtAvailable,

              sitemapAvailable,

              serverHeaders,
            },
          }
        );

      const result:
        TechnicalAuditResult = {
        tenantId:
          tenantContext.tenantId,

        schemaName:
          tenantContext.schema,

        id:
          saved.id,

        websiteUrl:
          analysis.url,

        finalUrl:
          analysis.finalUrl,

        status:
          "completed",

        score,

        summary,

        findings,

        crawlData: {
          finalUrl:
            analysis.finalUrl,

          statusCode:
            response.status,

          contentType:
            response.headers.get(
              "content-type"
            ) ?? "",

          https:
            analysis.finalUrl
              .toLowerCase()
              .startsWith(
                "https://"
              ),

          redirected:
            analysis.url !==
            analysis.finalUrl,

          title:
            analysis.title,

          description:
            analysis.description,

          headings:
            analysis.headings,

          links:
            analysis.links,

          images:
            analysis.images,

          wordCount:
            analysis.content
              .wordCount,
        },

        seoData: {
          hasTitle:
            analysis.seo
              .hasTitle,

          titleLength:
            analysis.title
              ?.length ?? 0,

          hasDescription:
            analysis.seo
              .hasDescription,

          descriptionLength:
            analysis.description
              ?.length ?? 0,

          h1Count:
            analysis.headings
              .h1.length,

          imagesWithoutAlt:
            analysis.images
              .withoutAlt,

          robotsTxtAvailable,

          sitemapAvailable,

          serverHeaders,
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
            "technical-audit",
        },
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Technical audit failed.",
        metadata: {
          agent: this.name,
          operation:
            "technical-audit",
        },
      };
    }
  }
}