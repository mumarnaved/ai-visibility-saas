import { randomUUID } from "node:crypto";

import { pool } from "../connection.js";

import type {
  AuditReport,
} from "../../../agents/audit-aggregator/index.js";

/* ========================================
   TYPES
======================================== */

export interface AuditReportRecord {
  id: string;

  /*
   * Not a column on audit_reports (the table
   * is already scoped to one tenant's schema) -
   * passed through from the function argument
   * for the caller's convenience.
   */
  tenantId: string;

  websiteUrl: string;
  status: string;

  overallScore: number | null;
  technicalSeoScore: number | null;
  contentQualityScore: number | null;
  aioReadinessScore: number | null;
  geoCitationScore: number | null;
  competitorGapScore: number | null;

  summary: string | null;

  technicalAudit: unknown;
  contentEntityAudit: unknown;
  citationAudit: unknown;
  competitorBenchmark: unknown;

  priorities: unknown;
  recommendations: unknown;

  createdAt: string;
}

interface AuditReportRow {
  id: string;
  website_url: string;
  status: string;
  overall_score: string | null;
  technical_seo_score: string | null;
  content_quality_score: string | null;
  aio_readiness_score: string | null;
  geo_citation_score: string | null;
  competitor_gap_score: string | null;
  summary: string | null;
  technical_audit: unknown;
  content_entity_audit: unknown;
  citation_audit: unknown;
  competitor_benchmark: unknown;
  priorities: unknown;
  recommendations: unknown;
  created_at: Date;
}

/* ========================================
   SCHEMA NAME
======================================== */

function getTenantSchema(
  tenantId: string
): string {
  const normalized =
    tenantId
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "");

  if (!normalized) {
    throw new Error(
      "Invalid tenantId."
    );
  }

  return `tenant_${normalized}`;
}

/* ========================================
   NUMERIC COLUMN HELPER

   NUMERIC columns come back from pg as
   strings, not numbers.
======================================== */

function toNumberOrNull(
  value: string | null
): number | null {
  return value === null
    ? null
    : Number(value);
}

/* ========================================
   MAP ROW
======================================== */

function mapRow(
  row: AuditReportRow,
  tenantId: string
): AuditReportRecord {
  return {
    id: row.id,

    tenantId,

    websiteUrl: row.website_url,
    status: row.status,

    overallScore:
      toNumberOrNull(
        row.overall_score
      ),

    technicalSeoScore:
      toNumberOrNull(
        row.technical_seo_score
      ),

    contentQualityScore:
      toNumberOrNull(
        row.content_quality_score
      ),

    aioReadinessScore:
      toNumberOrNull(
        row.aio_readiness_score
      ),

    geoCitationScore:
      toNumberOrNull(
        row.geo_citation_score
      ),

    competitorGapScore:
      toNumberOrNull(
        row.competitor_gap_score
      ),

    summary: row.summary,

    technicalAudit:
      row.technical_audit,

    contentEntityAudit:
      row.content_entity_audit,

    citationAudit:
      row.citation_audit,

    competitorBenchmark:
      row.competitor_benchmark,

    priorities: row.priorities,

    recommendations:
      row.recommendations,

    createdAt:
      row.created_at.toISOString(),
  };
}

/* ========================================
   GET TENANT WEBSITE URL

   audit_reports.website_url is NOT NULL,
   but AuditReport (from the aggregator)
   doesn't carry the website URL itself -
   only the platform tenant record does.
======================================== */

async function getTenantWebsiteUrl(
  tenantId: string
): Promise<string> {
  const result =
    await pool.query<{
      website_url: string | null;
    }>(
      `
        SELECT website_url
        FROM platform.tenants
        WHERE id = $1
        LIMIT 1
      `,
      [tenantId]
    );

  return (
    result.rows[0]?.website_url ?? ""
  );
}

/* ========================================
   SAVE AUDIT REPORT

   Maps each AuditReport field to its
   matching audit_reports column:

     overallScore              -> overall_score
     categories.technicalSEO   -> technical_seo_score, technical_audit
     categories.contentQuality -> content_quality_score, content_entity_audit
     categories.aioReadiness   -> aio_readiness_score
       (no source-audit column exists for
       this derived category)
     categories.geoCitationStatus -> geo_citation_score, citation_audit
     categories.competitorGap  -> competitor_gap_score, competitor_benchmark
     summary                   -> summary
     priorities                -> priorities

   AuditReport has no "recommendations"
   field, so that column is left to its
   table default ('[]'::jsonb).
======================================== */

export async function saveAuditReport(
  tenantId: string,
  report: AuditReport
): Promise<AuditReportRecord> {
  const schema =
    getTenantSchema(
      tenantId
    );

  const table =
    `"${schema}"."audit_reports"`;

  const id = randomUUID();

  const websiteUrl =
    await getTenantWebsiteUrl(
      tenantId
    );

  const result =
    await pool.query<AuditReportRow>(
      `
        INSERT INTO ${table}
        (
          id,
          website_url,
          status,
          overall_score,
          technical_seo_score,
          content_quality_score,
          aio_readiness_score,
          geo_citation_score,
          competitor_gap_score,
          summary,
          technical_audit,
          content_entity_audit,
          citation_audit,
          competitor_benchmark,
          priorities
        )
        VALUES
        (
          $1,
          $2,
          'completed',
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10::jsonb,
          $11::jsonb,
          $12::jsonb,
          $13::jsonb,
          $14::jsonb
        )
        RETURNING
          id,
          website_url,
          status,
          overall_score,
          technical_seo_score,
          content_quality_score,
          aio_readiness_score,
          geo_citation_score,
          competitor_gap_score,
          summary,
          technical_audit,
          content_entity_audit,
          citation_audit,
          competitor_benchmark,
          priorities,
          recommendations,
          created_at
      `,
      [
        id,
        websiteUrl,
        report.overallScore,
        report.categories.technicalSEO
          .score,
        report.categories.contentQuality
          .score,
        report.categories.aioReadiness
          .score,
        report.categories
          .geoCitationStatus.score,
        report.categories.competitorGap
          ?.score ?? null,
        report.summary,
        JSON.stringify(
          report.categories
            .technicalSEO
        ),
        JSON.stringify(
          report.categories
            .contentQuality
        ),
        JSON.stringify(
          report.categories
            .geoCitationStatus
        ),
        /*
         * competitor_benchmark is
         * NOT NULL DEFAULT '{}'::jsonb -
         * an empty object represents
         * "competitor benchmarking was
         * skipped" since SQL NULL isn't
         * allowed here.
         */
        JSON.stringify(
          report.categories
            .competitorGap ?? {}
        ),
        JSON.stringify(
          report.priorities
        ),
      ]
    );

  const row =
    result.rows[0];

  if (!row) {
    throw new Error(
      "Failed to save audit report."
    );
  }

  return mapRow(row, tenantId);
}

/* ========================================
   GET LATEST AUDIT REPORT
======================================== */

export async function getLatestAuditReport(
  tenantId: string
): Promise<AuditReportRecord | null> {
  const schema =
    getTenantSchema(
      tenantId
    );

  const table =
    `"${schema}"."audit_reports"`;

  const result =
    await pool.query<AuditReportRow>(
      `
        SELECT
          id,
          website_url,
          status,
          overall_score,
          technical_seo_score,
          content_quality_score,
          aio_readiness_score,
          geo_citation_score,
          competitor_gap_score,
          summary,
          technical_audit,
          content_entity_audit,
          citation_audit,
          competitor_benchmark,
          priorities,
          recommendations,
          created_at
        FROM ${table}
        ORDER BY created_at DESC
        LIMIT 1
      `
    );

  const row =
    result.rows[0];

  if (!row) {
    return null;
  }

  return mapRow(row, tenantId);
}

/* ========================================
   GET PREVIOUS AUDIT REPORT

   The second-most-recent report - used to
   compute score deltas for Stage 4 reports
   against the audit before this one.
======================================== */

export async function getPreviousAuditReport(
  tenantId: string
): Promise<AuditReportRecord | null> {
  const schema =
    getTenantSchema(
      tenantId
    );

  const table =
    `"${schema}"."audit_reports"`;

  const result =
    await pool.query<AuditReportRow>(
      `
        SELECT
          id,
          website_url,
          status,
          overall_score,
          technical_seo_score,
          content_quality_score,
          aio_readiness_score,
          geo_citation_score,
          competitor_gap_score,
          summary,
          technical_audit,
          content_entity_audit,
          citation_audit,
          competitor_benchmark,
          priorities,
          recommendations,
          created_at
        FROM ${table}
        ORDER BY created_at DESC
        LIMIT 1
        OFFSET 1
      `
    );

  const row =
    result.rows[0];

  if (!row) {
    return null;
  }

  return mapRow(row, tenantId);
}
