import { randomUUID } from "node:crypto";

import { pool } from "../connection.js";

/* ========================================
   TYPES
======================================== */

export interface SaveReportInput {
  periodStart: string;
  periodEnd: string;

  summary: string;

  auditDeltas: unknown;
  planProgress: unknown;
  trafficTrend: unknown;
  recommendations: string[];
}

export interface ReportRecord {
  id: string;

  periodStart: string;
  periodEnd: string;

  summary: string | null;

  auditDeltas: unknown;
  planProgress: unknown;
  trafficTrend: unknown;
  recommendations: unknown;

  createdAt: string;
}

interface ReportRow {
  id: string;
  /*
   * DATE columns come back from pg as JS Date
   * objects, not strings.
   */
  period_start: Date;
  period_end: Date;
  summary: string | null;
  audit_deltas: unknown;
  plan_progress: unknown;
  traffic_trend: unknown;
  recommendations: unknown;
  created_at: Date;
}

function toDateString(
  value: Date
): string {
  return value
    .toISOString()
    .slice(0, 10);
}

/* ========================================
   HELPERS
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

function mapRow(
  row: ReportRow
): ReportRecord {
  return {
    id: row.id,

    periodStart: toDateString(
      row.period_start
    ),
    periodEnd: toDateString(
      row.period_end
    ),

    summary: row.summary,

    auditDeltas: row.audit_deltas,
    planProgress: row.plan_progress,
    trafficTrend: row.traffic_trend,
    recommendations:
      row.recommendations,

    createdAt:
      row.created_at.toISOString(),
  };
}

const SELECT_COLUMNS = `
  id,
  period_start,
  period_end,
  summary,
  audit_deltas,
  plan_progress,
  traffic_trend,
  recommendations,
  created_at
`;

/* ========================================
   SAVE REPORT
======================================== */

export async function saveReport(
  schemaName: string,
  input: SaveReportInput
): Promise<ReportRecord> {
  const schema =
    quoteIdentifier(schemaName);

  const id = randomUUID();

  const result =
    await pool.query<ReportRow>(
      `
        INSERT INTO ${schema}.reports (
          id,
          period_start,
          period_end,
          summary,
          audit_deltas,
          plan_progress,
          traffic_trend,
          recommendations
        )
        VALUES (
          $1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb
        )
        RETURNING ${SELECT_COLUMNS}
      `,
      [
        id,
        input.periodStart,
        input.periodEnd,
        input.summary,
        JSON.stringify(
          input.auditDeltas
        ),
        JSON.stringify(
          input.planProgress
        ),
        JSON.stringify(
          input.trafficTrend
        ),
        JSON.stringify(
          input.recommendations
        ),
      ]
    );

  const row = result.rows[0];

  if (!row) {
    throw new Error(
      "Failed to save report."
    );
  }

  return mapRow(row);
}

/* ========================================
   GET LATEST REPORT
======================================== */

export async function getLatestReport(
  schemaName: string
): Promise<ReportRecord | null> {
  const schema =
    quoteIdentifier(schemaName);

  const result =
    await pool.query<ReportRow>(
      `
        SELECT ${SELECT_COLUMNS}
        FROM ${schema}.reports
        ORDER BY created_at DESC
        LIMIT 1
      `
    );

  const row = result.rows[0];

  return row ? mapRow(row) : null;
}
