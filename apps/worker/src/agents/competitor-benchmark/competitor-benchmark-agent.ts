import {
  validateTenantContext,
  type Agent,
  type AgentInput,
  type AgentOutput,
} from "agent-contracts";

import {
  competitorBenchmarkInputSchema,
  type CompetitorBenchmarkInput,
} from "./competitor-benchmark-input.js";

import type {
  CompetitorBenchmarkMetric,
  CompetitorBenchmarkResult,
} from "./competitor-benchmark-result.js";

import {
  saveCompetitorBenchmark,
} from "../../database/postgres/competitor-benchmark/competitor-benchmark-repository.js";

/* ========================================
   COMPETITOR BENCHMARK AGENT
======================================== */

export class CompetitorBenchmarkAgent
  implements
    Agent<
      CompetitorBenchmarkInput,
      CompetitorBenchmarkResult
    >
{
  readonly name = "competitor-benchmark";

  readonly stage = 1;

  readonly description =
    "Benchmarks the tenant against 3–5 real competitors and identifies competitive gaps for Stage 1 prioritization.";

  /* ========================================
     EXECUTE
  ======================================== */

  async execute(
    input: AgentInput<CompetitorBenchmarkInput>
  ): Promise<
    AgentOutput<CompetitorBenchmarkResult>
  > {
    try {
      /*
       * Every Stage 1 agent receives an explicit
       * tenant context from the orchestrator.
       */
      const tenantContext =
        validateTenantContext(
          input.tenantContext
        );

      /*
       * Validate the payload using the existing
       * competitor benchmark schema.
       */
      const auditInput =
        competitorBenchmarkInputSchema.parse(
          input.payload
        );

      /*
       * Prevent tenant confusion between the
       * payload and execution context.
       */
      if (
        tenantContext.tenantId !==
        auditInput.tenantId
      ) {
        throw new Error(
          "Tenant context does not match competitor benchmark input."
        );
      }

      /*
       * Tenant isolation:
       *
       * Every benchmark execution is associated
       * with exactly one tenant.
       *
       * The agent does not accept a list of
       * tenants or perform cross-tenant queries.
       */

      const competitors =
        await this.benchmarkCompetitors(
          auditInput
        );

      const tenantBaseline =
        await this.buildTenantBaseline(
          auditInput
        );

      const priorityGaps =
        this.identifyPriorityGaps(
          tenantBaseline,
          competitors
        );

      const summary =
        this.buildSummary(
          auditInput,
          tenantBaseline,
          competitors,
          priorityGaps
        );

      const score =
        this.computeScore(
          tenantBaseline
        );

      const recommendations =
        this.buildRecommendations(
          priorityGaps
        );

      /*
       * Persist inside the tenant schema, the
       * same way the other Stage 1 agents do.
       */
      const saved =
        await saveCompetitorBenchmark(
          tenantContext.schema,
          {
            websiteUrl:
              auditInput.websiteUrl,

            score,

            summary,

            competitors,

            comparison: {
              tenantBaseline,
              competitors,
            },

            gaps: priorityGaps,

            recommendations,
          }
        );

      const result:
        CompetitorBenchmarkResult = {
        tenantId:
          auditInput.tenantId,

        schemaName:
          tenantContext.schema,

        id:
          saved.id,

        status:
          "completed",

        score,

        websiteUrl:
          auditInput.websiteUrl,

        brandName:
          auditInput.brandName,

        competitors,

        tenantBaseline,

        priorityGaps,

        recommendations,

        summary,

        generatedAt:
          new Date().toISOString(),

        createdAt:
          saved.createdAt,
      };

      return {
        success: true,

        data: result,

        metadata: {
          agent: this.name,

          operation:
            "competitor-benchmark",
        },
      };
    } catch (error) {
      return {
        success: false,

        error:
          error instanceof Error
            ? error.message
            : "Competitor benchmark failed.",

        metadata: {
          agent: this.name,

          operation:
            "competitor-benchmark",
        },
      };
    }
  }

  /* ========================================
     BENCHMARK COMPETITORS
  ======================================== */

  private async benchmarkCompetitors(
    input: CompetitorBenchmarkInput
  ): Promise<
    CompetitorBenchmarkMetric[]
  > {
    const results:
      CompetitorBenchmarkMetric[] =
      [];

    for (
      const competitor
      of input.competitors
    ) {
      /*
       * The external-data integrations described
       * by the specification are intentionally
       * isolated behind this method.
       *
       * This allows DataForSEO, Ubersuggest,
       * Screaming Frog, and Firecrawl adapters
       * to be connected without changing the
       * Stage 1 agent contract.
       */

      const structuralScore =
        await this.getStructuralScore(
          competitor.websiteUrl
        );

      const contentScore =
        await this.getContentScore(
          competitor.websiteUrl
        );

      results.push({
        competitor:
          competitor.name,

        websiteUrl:
          competitor.websiteUrl ?? null,

        domainAuthority:
          null,

        organicKeywords:
          null,

        estimatedTraffic:
          null,

        backlinks:
          null,

        structuralScore,

        contentScore,

        strengths:
          this.buildStrengths(
            structuralScore,
            contentScore
          ),

        gaps:
          this.buildGaps(
            structuralScore,
            contentScore
          ),
      });
    }

    return results;
  }

  /* ========================================
     TENANT BASELINE
  ======================================== */

  private async buildTenantBaseline(
    input: CompetitorBenchmarkInput
  ) {
    const structuralScore =
      await this.getStructuralScore(
        input.websiteUrl
      );

    const contentScore =
      await this.getContentScore(
        input.websiteUrl
      );

    return {
      /*
       * These fields become populated when
       * DataForSEO/Ubersuggest adapters are
       * connected.
       */

      domainAuthority:
        null as number | null,

      organicKeywords:
        null as number | null,

      estimatedTraffic:
        null as number | null,

      backlinks:
        null as number | null,

      structuralScore,

      contentScore,
    };
  }

  /* ========================================
     STRUCTURAL ANALYSIS
  ======================================== */

  private async getStructuralScore(
    websiteUrl?: string
  ): Promise<number | null> {
    if (!websiteUrl) {
      return null;
    }

    try {
      const response =
        await fetch(
          websiteUrl,
          {
            method: "GET",

            headers: {
              "User-Agent":
                "AI-Visibility-Competitor-Benchmark/1.0",
            },

            redirect: "follow",
          }
        );

      if (!response.ok) {
        return null;
      }

      const html =
        await response.text();

      if (!html.trim()) {
        return null;
      }

      let score = 100;

      /*
       * Basic structural signals.
       *
       * This is the local baseline adapter.
       * A production Screaming Frog/Firecrawl
       * adapter can replace this without
       * changing the agent contract.
       */

      const titleMatch =
        html.match(
          /<title[^>]*>([\s\S]*?)<\/title>/i
        );

      if (
        !titleMatch ||
        !titleMatch[1].trim()
      ) {
        score -= 15;
      }

      const descriptionMatch =
        html.match(
          /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i
        );

      if (
        !descriptionMatch ||
        !descriptionMatch[1].trim()
      ) {
        score -= 10;
      }

      const h1Matches =
        html.match(
          /<h1\b[^>]*>/gi
        ) ?? [];

      if (
        h1Matches.length === 0
      ) {
        score -= 15;
      }

      if (
        h1Matches.length > 1
      ) {
        score -= 5;
      }

      const canonicalMatch =
        html.match(
          /<link[^>]+rel=["']canonical["'][^>]*>/i
        );

      if (!canonicalMatch) {
        score -= 5;
      }

      const viewportMatch =
        html.match(
          /<meta[^>]+name=["']viewport["'][^>]*>/i
        );

      if (!viewportMatch) {
        score -= 5;
      }

      const robotsMatch =
        html.match(
          /<meta[^>]+name=["']robots["'][^>]*>/i
        );

      if (!robotsMatch) {
        score -= 3;
      }

      const sitemapReference =
        html.match(
          /sitemap\.xml/i
        );

      if (!sitemapReference) {
        score -= 2;
      }

      return Math.max(
        0,
        Math.min(
          100,
          score
        )
      );
    } catch {
      return null;
    }
  }

  /* ========================================
     CONTENT ANALYSIS
  ======================================== */

  private async getContentScore(
    websiteUrl?: string
  ): Promise<number | null> {
    if (!websiteUrl) {
      return null;
    }

    try {
      const response =
        await fetch(
          websiteUrl,
          {
            method: "GET",

            headers: {
              "User-Agent":
                "AI-Visibility-Competitor-Benchmark/1.0",
            },

            redirect: "follow",
          }
        );

      if (!response.ok) {
        return null;
      }

      const html =
        await response.text();

      if (!html.trim()) {
        return null;
      }

      let score = 100;

      const text =
        html
          .replace(
            /<script[\s\S]*?<\/script>/gi,
            " "
          )
          .replace(
            /<style[\s\S]*?<\/style>/gi,
            " "
          )
          .replace(
            /<[^>]+>/g,
            " "
          )
          .replace(
            /\s+/g,
            " "
          )
          .trim();

      /*
       * Very small content pages are generally
       * weaker for extraction and citation.
       */

      if (
        text.length < 500
      ) {
        score -= 30;
      } else if (
        text.length < 1000
      ) {
        score -= 15;
      }

      const h2Count =
        (
          html.match(
            /<h2\b[^>]*>/gi
          ) ?? []
        ).length;

      if (
        h2Count === 0
      ) {
        score -= 10;
      }

      const paragraphCount =
        (
          html.match(
            /<p\b[^>]*>/gi
          ) ?? []
        ).length;

      if (
        paragraphCount < 3
      ) {
        score -= 10;
      }

      const schemaCount =
        (
          html.match(
            /application\/ld\+json/gi
          ) ?? []
        ).length;

      if (
        schemaCount === 0
      ) {
        score -= 10;
      }

      const faqSignals =
        /faq|frequently asked questions/i.test(
          text
        );

      if (
        !faqSignals
      ) {
        score -= 5;
      }

      return Math.max(
        0,
        Math.min(
          100,
          score
        )
      );
    } catch {
      return null;
    }
  }

  /* ========================================
     STRENGTHS
  ======================================== */

  private buildStrengths(
    structuralScore:
      number | null,

    contentScore:
      number | null
  ): string[] {
    const strengths: string[] =
      [];

    if (
      structuralScore !== null &&
      structuralScore >= 80
    ) {
      strengths.push(
        "Strong technical site structure."
      );
    }

    if (
      contentScore !== null &&
      contentScore >= 80
    ) {
      strengths.push(
        "Strong content structure and extraction signals."
      );
    }

    if (
      strengths.length === 0
    ) {
      strengths.push(
        "No major strength could be established from the available baseline data."
      );
    }

    return strengths;
  }

  /* ========================================
     GAPS
  ======================================== */

  private buildGaps(
    structuralScore:
      number | null,

    contentScore:
      number | null
  ): string[] {
    const gaps: string[] =
      [];

    if (
      structuralScore !== null &&
      structuralScore < 70
    ) {
      gaps.push(
        "Technical structure has identifiable weaknesses."
      );
    }

    if (
      contentScore !== null &&
      contentScore < 70
    ) {
      gaps.push(
        "Content structure may limit search and AI extraction."
      );
    }

    if (
      gaps.length === 0
    ) {
      gaps.push(
        "No major baseline gap identified."
      );
    }

    return gaps;
  }

  /* ========================================
     PRIORITY GAPS
  ======================================== */

  private identifyPriorityGaps(
    tenantBaseline: {
      structuralScore:
        number | null;

      contentScore:
        number | null;
    },

    competitors:
      CompetitorBenchmarkMetric[]
  ): string[] {
    const gaps: string[] =
      [];

    const competitorStructuralScores =
      competitors
        .map(
          (competitor) =>
            competitor.structuralScore
        )
        .filter(
          (
            score
          ): score is number =>
            score !== null
        );

    const competitorContentScores =
      competitors
        .map(
          (competitor) =>
            competitor.contentScore
        )
        .filter(
          (
            score
          ): score is number =>
            score !== null
        );

    const averageStructuralScore =
      this.average(
        competitorStructuralScores
      );

    const averageContentScore =
      this.average(
        competitorContentScores
      );

    if (
      tenantBaseline.structuralScore !==
        null &&
      averageStructuralScore !== null &&
      tenantBaseline.structuralScore <
        averageStructuralScore
    ) {
      gaps.push(
        "Technical structure is behind the competitor benchmark."
      );
    }

    if (
      tenantBaseline.contentScore !==
        null &&
      averageContentScore !== null &&
      tenantBaseline.contentScore <
        averageContentScore
    ) {
      gaps.push(
        "Content structure is behind the competitor benchmark."
      );
    }

    if (
      gaps.length === 0
    ) {
      gaps.push(
        "No benchmark gap was established from the available data."
      );
    }

    return gaps;
  }

  /* ========================================
     SUMMARY
  ======================================== */

  private buildSummary(
    input: CompetitorBenchmarkInput,

    tenantBaseline: {
      structuralScore:
        number | null;

      contentScore:
        number | null;
    },

    competitors:
      CompetitorBenchmarkMetric[],

    priorityGaps:
      string[]
  ): string {
    const competitorCount =
      competitors.length;

    const structural =
      tenantBaseline.structuralScore !==
      null
        ? `${tenantBaseline.structuralScore}/100`
        : "unavailable";

    const content =
      tenantBaseline.contentScore !==
      null
        ? `${tenantBaseline.contentScore}/100`
        : "unavailable";

    return (
      `${input.brandName} was benchmarked against ` +
      `${competitorCount} competitor(s). ` +
      `The tenant baseline shows a structural score of ` +
      `${structural} and a content score of ${content}. ` +
      `Priority gaps: ${priorityGaps.join(" ")}`
    );
  }

  /* ========================================
     COMPUTE SCORE
  ======================================== */

  private computeScore(
    tenantBaseline: {
      structuralScore:
        number | null;

      contentScore:
        number | null;
    }
  ): number {
    const scores =
      [
        tenantBaseline.structuralScore,
        tenantBaseline.contentScore,
      ].filter(
        (
          score
        ): score is number =>
          score !== null
      );

    const average =
      this.average(
        scores
      );

    return average === null
      ? 0
      : Math.round(
          average
        );
  }

  /* ========================================
     BUILD RECOMMENDATIONS
  ======================================== */

  private buildRecommendations(
    priorityGaps: string[]
  ): string[] {
    return priorityGaps.map(
      (gap) =>
        `Address benchmark gap: ${gap}`
    );
  }

  /* ========================================
     AVERAGE
  ======================================== */

  private average(
    values: number[]
  ): number | null {
    if (
      values.length === 0
    ) {
      return null;
    }

    return (
      values.reduce(
        (
          total,
          value
        ) =>
          total + value,
        0
      ) /
      values.length
    );
  }
}