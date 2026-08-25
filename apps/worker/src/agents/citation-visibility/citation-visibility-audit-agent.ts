import {
  validateTenantContext,
  type Agent,
  type AgentInput,
  type AgentOutput,
} from "agent-contracts";

import {
  citationVisibilityAuditInputSchema,
  type CitationVisibilityAuditInput,
} from "./citation-visibility-audit-input.js";

import type {
  CitationVisibilityAuditResult,
  CitationVisibilityFinding,
  CitationVisibilityQueryResult,
} from "./citation-visibility-audit-result.js";

import {
  runOpenRouter,
} from "../shared/openrouter-provider.js";

import {
  saveCitationVisibilityAudit,
} from "../../database/postgres/citation-visibility/citation-visibility-audit-repository.js";

function normalizeText(
  value: string
): string {
  return value
    .toLowerCase()
    .replace(/[“”‘’]/g, '"')
    .replace(/[‐-‒–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(
  value: string
): string {
  return value.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}

function buildBrandVariants(
  brandName: string
): string[] {
  const original =
    brandName.trim();

  const variants =
    new Set<string>();

  if (original) {
    const normalized =
      normalizeText(original);

    variants.add(normalized);

    variants.add(
      normalized.replace(
        /[\s-_]+/g,
        ""
      )
    );

    variants.add(
      normalized.replace(
        /[-_]+/g,
        " "
      )
    );

    variants.add(
      normalized.replace(
        /[\s_]+/g,
        "-"
      )
    );
  }

  return Array.from(
    variants
  ).filter(Boolean);
}

function containsBrand(
  text: string,
  variants: string[]
): boolean {
  const normalized =
    normalizeText(text);

  return variants.some(
    (variant) => {
      const pattern =
        new RegExp(
          `(^|[^a-z0-9])${escapeRegExp(
            variant
          )}([^a-z0-9]|$)`,
          "i"
        );

      return (
        pattern.test(normalized) ||
        (
          variant.length >= 5 &&
          normalized.includes(
            variant
          )
        )
      );
    }
  );
}

function detectPosition(
  response: string,
  variants: string[]
): number | null {
  const lines =
    response.split(/\r?\n/);

  for (
    let index = 0;
    index < lines.length;
    index++
  ) {
    const line =
      lines[index].trim();

    if (!line) {
      continue;
    }

    const numbered =
      line.match(
        /^(\d+)\s*[\.\)\-:]\s*(.+)$/i
      );

    if (
      numbered &&
      containsBrand(
        numbered[2],
        variants
      )
    ) {
      return Number(
        numbered[1]
      );
    }

    if (
      containsBrand(
        line,
        variants
      )
    ) {
      const rank =
        line.match(
          /(?:rank(?:ed)?|position|number|#)\s*#?\s*(\d+)/i
        );

      if (rank) {
        return Number(
          rank[1]
        );
      }

      const ordinal =
        line.match(
          /\b(\d+)(?:st|nd|rd|th)\b/i
        );

      if (ordinal) {
        return Number(
          ordinal[1]
        );
      }
    }
  }

  return null;
}

function extractCitations(
  response: string
): Array<{
  url: string;
  title: string;
}> {
  const citations:
    Array<{
      url: string;
      title: string;
    }> = [];

  const urls =
    response.match(
      /https?:\/\/[^\s)\]>"']+/gi
    ) ?? [];

  for (
    const rawUrl of urls
  ) {
    const url =
      rawUrl.replace(
        /[.,;:!?]+$/,
        ""
      );

    if (!url) {
      continue;
    }

    citations.push({
      url,
      title: url,
    });
  }

  const markdownRegex =
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gi;

  let match:
    RegExpExecArray | null;

  while (
    (match =
      markdownRegex.exec(
        response
      )) !== null
  ) {
    citations.push({
      url: match[2],
      title: match[1],
    });
  }

  const unique =
    new Map<
      string,
      {
        url: string;
        title: string;
      }
    >();

  for (
    const citation of citations
  ) {
    if (
      !unique.has(
        citation.url
      )
    ) {
      unique.set(
        citation.url,
        citation
      );
    }
  }

  return Array.from(
    unique.values()
  );
}

function detectCompetitors(
  response: string,
  brandName: string
): string[] {
  const normalized =
    normalizeText(response);

  const brand =
    normalizeText(
      brandName
    );

  const knownCompetitors = [
    "G2",
    "Capterra",
    "GetApp",
    "TrustRadius",
    "GoodFirms",
    "Clutch",
    "DesignRush",
    "Upwork",
    "Toptal",
    "Fiverr",
    "Accenture",
    "Infosys",
    "Wipro",
    "Capgemini",
    "Cognizant",
    "IBM",
    "Microsoft",
    "Google",
    "Amazon",
    "Oracle",
    "Deloitte",
    "PwC",
    "EPAM",
    "BairesDev",
  ];

  return knownCompetitors.filter(
    (competitor) => {
      if (
        normalizeText(
          competitor
        ) === brand
      ) {
        return false;
      }

      return normalized.includes(
        normalizeText(
          competitor
        )
      );
    }
  );
}

async function runQuery(
  query: string,
  category: string | null,
  brandName: string
): Promise<CitationVisibilityQueryResult> {
  const aiResponse =
    await runOpenRouter(
      query
    );

  const variants =
    buildBrandVariants(
      brandName
    );

  const brandMentioned =
    containsBrand(
      aiResponse.response,
      variants
    );

  const brandPosition =
    brandMentioned
      ? detectPosition(
          aiResponse.response,
          variants
        )
      : null;

  const citations =
    extractCitations(
      aiResponse.response
    );

  const competitors =
    detectCompetitors(
      aiResponse.response,
      brandName
    );

  return {
    query,
    category,

    provider:
      aiResponse.provider,

    model:
      aiResponse.model,

    response:
      aiResponse.response,

    brandMentioned,

    brandPosition,

    citations,

    competitors,
  };
}

export class CitationVisibilityAuditAgent
  implements Agent<
    CitationVisibilityAuditInput,
    CitationVisibilityAuditResult
  >
{
  readonly name =
    "citation-visibility-audit";

  async execute(
    input: AgentInput<CitationVisibilityAuditInput>
  ): Promise<
    AgentOutput<CitationVisibilityAuditResult>
  > {
    try {
      const tenantContext =
        validateTenantContext(
          input.tenantContext
        );

      const auditInput =
        citationVisibilityAuditInputSchema.parse(
          input.payload
        );

      if (
        tenantContext.tenantId !==
        auditInput.tenantId
      ) {
        throw new Error(
          "Tenant context does not match citation visibility audit input."
        );
      }

      const queryResults:
        CitationVisibilityQueryResult[] =
        [];

      for (
        const query of auditInput.queries
      ) {
        const result =
          await runQuery(
            query.query,
            query.category ?? null,
            auditInput.brandName
          );

        queryResults.push(
          result
        );
      }

      const allCitations =
        queryResults.flatMap(
          (result) =>
            result.citations.map(
              (citation) => ({
                ...citation,
                query:
                  result.query,
              })
            )
        );

      const mentionedCount =
        queryResults.filter(
          (result) =>
            result.brandMentioned
        ).length;

      const citationCount =
        allCitations.length;

      const zeroCitationQueries =
        queryResults.filter(
          (result) =>
            result.citations.length === 0
        );

      const zeroMentionQueries =
        queryResults.filter(
          (result) =>
            !result.brandMentioned
        );

      const visibilityFindings:
        CitationVisibilityFinding[] =
        [];

      if (
        zeroMentionQueries.length > 0
      ) {
        visibilityFindings.push({
          category:
            "brand-visibility",

          severity:
            "high",

          title:
            "Brand is missing from AI answers",

          description:
            `${zeroMentionQueries.length} of ${queryResults.length} tested queries did not mention the tracked brand.`,

          recommendation:
            "Prioritize topics where the brand is absent and create or restructure authoritative content around those topics.",
        });
      }

      if (
        zeroCitationQueries.length > 0
      ) {
        visibilityFindings.push({
          category:
            "citation-visibility",

          severity:
            "high",

          title:
            "Zero-citation topics detected",

          description:
            `${zeroCitationQueries.length} tested queries produced no detectable citation.`,

          recommendation:
            "Create citation-ready passages that directly answer high-value questions and strengthen the supporting evidence and entity context.",
        });
      }

      if (
        citationCount === 0
      ) {
        visibilityFindings.push({
          category:
            "citation-coverage",

          severity:
            "critical",

          title:
            "No citations detected",

          description:
            "The tested AI responses contained no detectable URLs or markdown citations.",

          recommendation:
            "Improve source discoverability and create authoritative, directly citable content for the tracked topics.",
        });
      }

      const mentionRate =
        queryResults.length > 0
          ? mentionedCount /
            queryResults.length
          : 0;

      const citationRate =
        queryResults.length > 0
          ? queryResults.filter(
              (result) =>
                result.citations
                  .length > 0
            ).length /
            queryResults.length
          : 0;

      let score =
        (
          mentionRate * 60
        ) +
        (
          citationRate * 40
        );

      if (
        score < 0
      ) {
        score = 0;
      }

      if (
        score > 100
      ) {
        score = 100;
      }

      score =
        Math.round(
          score * 100
        ) / 100;

      const recommendations =
        visibilityFindings
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

      const summary =
        queryResults.length === 0
          ? "Citation and visibility audit could not run because no queries were supplied."
          : `Citation and visibility audit completed across ${queryResults.length} AI query(ies). The brand was mentioned in ${mentionedCount} query(ies) and ${citationCount} citation(s) were detected.`;

      const saved =
        await saveCitationVisibilityAudit(
          tenantContext.schema,
          {
            websiteUrl:
              auditInput.websiteUrl,

            score,

            summary,

            queries:
              queryResults,

            citations:
              allCitations,

            visibilityFindings,

            recommendations,
          }
        );

      const result:
        CitationVisibilityAuditResult =
        {
          tenantId:
            tenantContext.tenantId,

          schemaName:
            tenantContext.schema,

          id:
            saved.id,

          websiteUrl:
            auditInput.websiteUrl,

          status:
            "completed",

          score,

          summary,

          queries:
            queryResults,

          citations:
            allCitations,

          visibilityFindings,

          recommendations,

          createdAt:
            saved.createdAt,
        };

      return {
        success: true,

        data:
          result,

        metadata: {
          agent:
            this.name,

          operation:
            "citation-visibility-audit",
        },
      };
    } catch (error) {
      return {
        success: false,

        error:
          error instanceof Error
            ? error.message
            : "Citation visibility audit failed.",

        metadata: {
          agent:
            this.name,

          operation:
            "citation-visibility-audit",
        },
      };
    }
  }
}