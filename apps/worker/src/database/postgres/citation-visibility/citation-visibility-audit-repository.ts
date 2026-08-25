import { pool } from "../connection.js";

/* ========================================
   QUOTE POSTGRES IDENTIFIER
======================================== */

function quoteIdentifier(
  identifier: string
): string {
  return `"${identifier.replaceAll(
    '"',
    '""'
  )}"`;
}

/* ========================================
   SAVE INPUT
======================================== */

export interface SaveCitationVisibilityAuditInput {
  websiteUrl: string;

  status?:
    | "pending"
    | "running"
    | "completed"
    | "failed";

  score: number;

  summary: string;

  queries: unknown[];

  citations: unknown[];

  visibilityFindings: unknown[];

  recommendations: unknown[];
}

/* ========================================
   SAVED RESULT
======================================== */

export interface SavedCitationVisibilityAudit {
  id: string;

  createdAt: string;
}

/* ========================================
   LATEST AUDIT ROW
======================================== */

export interface CitationVisibilityQueryRecord {
  query: string;

  category: string | null;

  provider: string;

  model: string | null;

  response: string;

  brandMentioned: boolean;

  brandPosition: number | null;

  citations: unknown;

  competitors: unknown;
}

export interface LatestCitationVisibilityAudit {
  id: string;

  websiteUrl: string;

  status: string;

  score: number | null;

  summary: string | null;

  queries: CitationVisibilityQueryRecord[];

  citations: unknown;

  visibilityFindings: unknown;

  recommendations: unknown;

  createdAt: string;
}

/* ========================================
   SAVE CITATION VISIBILITY AUDIT
======================================== */

export async function saveCitationVisibilityAudit(
  schemaName: string,
  input: SaveCitationVisibilityAuditInput
): Promise<SavedCitationVisibilityAudit> {
  const schema =
    quoteIdentifier(schemaName);

  await pool.query(
    `SET search_path TO ${schema}, public`
  );

  try {
    const result =
      await pool.query<{
        id: string;
        created_at: Date;
      }>(
        `
        INSERT INTO citation_audits (
          id,
          website_url,
          status,
          score,
          summary,
          queries,
          citations,
          visibility_findings,
          recommendations
        )
        VALUES (
          gen_random_uuid(),
          $1,
          $2,
          $3,
          $4,
          $5::jsonb,
          $6::jsonb,
          $7::jsonb,
          $8::jsonb
        )
        RETURNING
          id,
          created_at
        `,
        [
          input.websiteUrl,

          input.status ?? "completed",

          input.score,

          input.summary,

          JSON.stringify(
            input.queries
          ),

          JSON.stringify(
            input.citations
          ),

          JSON.stringify(
            input.visibilityFindings
          ),

          JSON.stringify(
            input.recommendations
          ),
        ]
      );

    const row =
      result.rows[0];

    if (!row) {
      throw new Error(
        "Citation visibility audit was not saved."
      );
    }

    return {
      id: row.id,

      createdAt:
        row.created_at.toISOString(),
    };
  } finally {
    await pool.query(
      `SET search_path TO public`
    );
  }
}

/* ========================================
   GET LATEST CITATION VISIBILITY AUDIT
======================================== */

export async function getLatestCitationVisibilityAudit(
  schemaName: string
): Promise<LatestCitationVisibilityAudit | null> {
  const schema =
    quoteIdentifier(schemaName);

  await pool.query(
    `SET search_path TO ${schema}, public`
  );

  try {
    const result =
      await pool.query(
        `
          SELECT
            id,
            website_url,
            status,
            score,
            summary,
            queries,
            citations,
            visibility_findings,
            recommendations,
            created_at
          FROM citation_audits
          ORDER BY created_at DESC
          LIMIT 1
        `
      );

    const row =
      result.rows[0];

    if (!row) {
      return null;
    }

    return {
      id: row.id,

      websiteUrl:
        row.website_url,

      status: row.status,

      score:
        row.score === null
          ? null
          : Number(row.score),

      summary: row.summary,

      queries: Array.isArray(row.queries)
        ? row.queries
        : [],

      citations: row.citations,

      visibilityFindings:
        row.visibility_findings,

      recommendations:
        row.recommendations,

      createdAt:
        row.created_at.toISOString(),
    };
  } finally {
    await pool.query(
      `SET search_path TO public`
    );
  }
}

/* ========================================
   DERIVED VIEWS

   The old ai_visibility_queries /
   ai_visibility_results tables stored each
   tracked query as its own row. Stage 1's
   citation_audits table stores the entire
   set of queries for one audit run as a
   single JSONB array instead.

   These helpers reshape that array into the
   same shapes the frontend previously
   consumed, so pages built against the old
   endpoints keep working with only their
   fetch URLs changed.
======================================== */

export interface DerivedQueryRecord {
  id: string;
  query: string;
  category: string | null;
  createdAt: string;
}

export interface DerivedResultRecord {
  id: string;
  queryId: string;
  provider: string;
  model: string | null;
  response: string;
  brandMentioned: boolean;
  brandPosition: number | null;
  citations: unknown;
  competitors: unknown;
  analyzedAt: string;
  createdAt: string;
}

export interface DerivedCitationAuditMetrics {
  totalQueries: number;
  mentionedQueries: number;
  mentionRate: number;
  positionedQueries: number;
  averagePosition: number | null;
  citationCount: number;
  visibilityScore: number;
  competitors: {
    name: string;
    count: number;
  }[];
  categories: {
    category: string;
    totalQueries: number;
    mentionedQueries: number;
    mentionRate: number;
  }[];
}

function deriveQueryId(
  auditId: string,
  index: number
): string {
  return `${auditId}:${index}`;
}

export function deriveQueryRecords(
  audit: LatestCitationVisibilityAudit | null
): DerivedQueryRecord[] {
  if (!audit) {
    return [];
  }

  return audit.queries.map(
    (item, index) => ({
      id: deriveQueryId(
        audit.id,
        index
      ),
      query: item.query,
      category: item.category,
      createdAt: audit.createdAt,
    })
  );
}

export function deriveResultRecords(
  audit: LatestCitationVisibilityAudit | null
): DerivedResultRecord[] {
  if (!audit) {
    return [];
  }

  return audit.queries.map(
    (item, index) => ({
      id: deriveQueryId(
        audit.id,
        index
      ),
      queryId: deriveQueryId(
        audit.id,
        index
      ),
      provider: item.provider,
      model: item.model,
      response: item.response,
      brandMentioned:
        item.brandMentioned,
      brandPosition:
        item.brandPosition,
      citations: item.citations,
      competitors: item.competitors,
      analyzedAt: audit.createdAt,
      createdAt: audit.createdAt,
    })
  );
}

export function deriveCitationAuditMetrics(
  audit: LatestCitationVisibilityAudit | null
): DerivedCitationAuditMetrics {
  const queries = audit?.queries ?? [];

  const totalQueries = queries.length;

  const mentionedQueries = queries.filter(
    (item) => item.brandMentioned
  ).length;

  const positioned = queries.filter(
    (item) => item.brandPosition !== null
  );

  const positionedQueries = positioned.length;

  const averagePosition =
    positionedQueries > 0
      ? Number(
          (
            positioned.reduce(
              (sum, item) =>
                sum +
                (item.brandPosition ?? 0),
              0
            ) / positionedQueries
          ).toFixed(2)
        )
      : null;

  const citationCount = queries.reduce(
    (sum, item) =>
      sum +
      (Array.isArray(item.citations)
        ? item.citations.length
        : 0),
    0
  );

  const mentionRate =
    totalQueries > 0
      ? Number(
          (
            (mentionedQueries /
              totalQueries) *
            100
          ).toFixed(2)
        )
      : 0;

  let positionScore = 0;

  if (
    positionedQueries > 0 &&
    averagePosition !== null
  ) {
    positionScore = Math.max(
      10,
      110 - averagePosition * 10
    );

    positionScore = Math.min(
      100,
      positionScore
    );
  }

  const visibilityScore =
    totalQueries > 0
      ? Number(
          (
            mentionRate * 0.6 +
            positionScore * 0.4
          ).toFixed(2)
        )
      : 0;

  const competitorCounts = new Map<
    string,
    number
  >();

  for (const item of queries) {
    const competitors = Array.isArray(
      item.competitors
    )
      ? item.competitors
      : [];

    for (const competitor of competitors) {
      const name = String(competitor);

      competitorCounts.set(
        name,
        (competitorCounts.get(name) ?? 0) + 1
      );
    }
  }

  const competitors = Array.from(
    competitorCounts.entries()
  )
    .map(([name, count]) => ({
      name,
      count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  const categoryMap = new Map<
    string,
    { total: number; mentioned: number }
  >();

  for (const item of queries) {
    const category =
      item.category ?? "uncategorized";

    const entry = categoryMap.get(
      category
    ) ?? { total: 0, mentioned: 0 };

    entry.total += 1;

    if (item.brandMentioned) {
      entry.mentioned += 1;
    }

    categoryMap.set(category, entry);
  }

  const categories = Array.from(
    categoryMap.entries()
  )
    .map(([category, entry]) => ({
      category,
      totalQueries: entry.total,
      mentionedQueries: entry.mentioned,
      mentionRate:
        entry.total > 0
          ? Number(
              (
                (entry.mentioned /
                  entry.total) *
                100
              ).toFixed(2)
            )
          : 0,
    }))
    .sort(
      (a, b) => b.totalQueries - a.totalQueries
    );

  return {
    totalQueries,
    mentionedQueries,
    mentionRate,
    positionedQueries,
    averagePosition,
    citationCount,
    visibilityScore,
    competitors,
    categories,
  };
}