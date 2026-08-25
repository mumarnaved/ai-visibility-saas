import { randomUUID } from "node:crypto";

import { pool } from "../connection.js";

/* ========================================
   TYPES
======================================== */

export interface SaveCompetitorBenchmarkInput {
  websiteUrl: string;

  score: number;

  summary: string;

  competitors: unknown[];

  comparison: unknown;

  gaps: string[];

  recommendations: string[];
}

export interface SavedCompetitorBenchmark {
  id: string;
  createdAt: string;
}

/* ========================================
   QUOTE IDENTIFIER
======================================== */

function quoteIdentifier(
  identifier: string
): string {
  if (
    !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(
      identifier
    )
  ) {
    throw new Error(
      "Invalid PostgreSQL identifier."
    );
  }

  return `"${identifier}"`;
}

/* ========================================
   SAVE COMPETITOR BENCHMARK
======================================== */

export async function saveCompetitorBenchmark(
  schemaName: string,
  input: SaveCompetitorBenchmarkInput
): Promise<SavedCompetitorBenchmark> {
  const schema =
    quoteIdentifier(schemaName);

  const id =
    randomUUID();

  const result =
    await pool.query(
      `
        INSERT INTO ${schema}.competitor_benchmarks (
          id,
          website_url,
          status,
          score,
          summary,
          competitors,
          comparison,
          gaps,
          recommendations
        )
        VALUES (
          $1,
          $2,
          'completed',
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
        id,
        input.websiteUrl,
        input.score,
        input.summary,
        JSON.stringify(
          input.competitors
        ),
        JSON.stringify(
          input.comparison
        ),
        JSON.stringify(
          input.gaps
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
      "Failed to save competitor benchmark."
    );
  }

  return {
    id: row.id,
    createdAt:
      new Date(
        row.created_at
      ).toISOString(),
  };
}

/* ========================================
   GET LATEST COMPETITOR BENCHMARK
======================================== */

export async function getLatestCompetitorBenchmark(
  schemaName: string
): Promise<{
  id: string;
  websiteUrl: string;
  score: number | null;
  summary: string | null;
  competitors: unknown;
  comparison: unknown;
  gaps: unknown;
  recommendations: unknown;
  createdAt: string;
} | null> {
  const schema =
    quoteIdentifier(schemaName);

  const result =
    await pool.query(
      `
        SELECT
          id,
          website_url,
          score,
          summary,
          competitors,
          comparison,
          gaps,
          recommendations,
          created_at
        FROM ${schema}.competitor_benchmarks
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
    websiteUrl: row.website_url,
    score: row.score,
    summary: row.summary,
    competitors: row.competitors,
    comparison: row.comparison,
    gaps: row.gaps,
    recommendations: row.recommendations,
    createdAt:
      new Date(
        row.created_at
      ).toISOString(),
  };
}
