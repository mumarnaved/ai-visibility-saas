import { randomUUID } from "node:crypto";

import { pool } from "../connection.js";

export interface SaveTechnicalAuditInput {
  websiteUrl: string;
  finalUrl: string;
  score: number;
  summary: string;
  findings: unknown[];
  crawlData: Record<string, unknown>;
  seoData: Record<string, unknown>;
}

export interface SavedTechnicalAudit {
  id: string;
  createdAt: string;
}

function quoteIdentifier(
  identifier: string
): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export async function saveTechnicalAudit(
  schemaName: string,
  input: SaveTechnicalAuditInput
): Promise<SavedTechnicalAudit> {
  const id = randomUUID();

  const schema = quoteIdentifier(
    schemaName
  );

  const result = await pool.query(
    `
      INSERT INTO ${schema}.technical_audits (
        id,
        website_url,
        final_url,
        status,
        score,
        summary,
        findings,
        crawl_data,
        seo_data
      )
      VALUES (
        $1,
        $2,
        $3,
        'completed',
        $4,
        $5,
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
      input.finalUrl,
      input.score,
      input.summary,
      JSON.stringify(input.findings),
      JSON.stringify(input.crawlData),
      JSON.stringify(input.seoData),
    ]
  );

  return {
    id: result.rows[0].id,
    createdAt:
      result.rows[0].created_at instanceof Date
        ? result.rows[0].created_at.toISOString()
        : String(result.rows[0].created_at),
  };
}

export async function getLatestTechnicalAudit(
  schemaName: string
): Promise<Record<string, unknown> | null> {
  const schema = quoteIdentifier(
    schemaName
  );

  const result = await pool.query(
    `
      SELECT
        id,
        website_url,
        final_url,
        status,
        score,
        summary,
        findings,
        crawl_data,
        seo_data,
        created_at,
        updated_at
      FROM ${schema}.technical_audits
      ORDER BY created_at DESC
      LIMIT 1
    `
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0];
}