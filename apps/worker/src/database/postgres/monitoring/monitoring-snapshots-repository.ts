import { randomUUID } from "node:crypto";

import { pool } from "../connection.js";

/* ========================================
   TYPES
======================================== */

export interface SaveMonitoringSnapshotInput {
  snapshotDate: string;

  visibilityScore: number | null;
  citationScore: number | null;
  technicalScore: number | null;
  contentScore: number | null;
  competitorScore: number | null;

  metrics: unknown;
}

export interface MonitoringSnapshotRecord {
  id: string;

  snapshotDate: string;

  visibilityScore: number | null;
  citationScore: number | null;
  technicalScore: number | null;
  contentScore: number | null;
  competitorScore: number | null;

  metrics: unknown;

  createdAt: string;
}

interface MonitoringSnapshotRow {
  id: string;
  /*
   * DATE columns come back from pg as JS Date
   * objects, not strings.
   */
  snapshot_date: Date;
  visibility_score: string | null;
  citation_score: string | null;
  technical_score: string | null;
  content_score: string | null;
  competitor_score: string | null;
  metrics: unknown;
  created_at: Date;
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

function toNumberOrNull(
  value: string | null
): number | null {
  return value === null
    ? null
    : Number(value);
}

function toDateString(
  value: Date
): string {
  return value
    .toISOString()
    .slice(0, 10);
}

function mapRow(
  row: MonitoringSnapshotRow
): MonitoringSnapshotRecord {
  return {
    id: row.id,

    snapshotDate: toDateString(
      row.snapshot_date
    ),

    visibilityScore:
      toNumberOrNull(
        row.visibility_score
      ),

    citationScore:
      toNumberOrNull(
        row.citation_score
      ),

    technicalScore:
      toNumberOrNull(
        row.technical_score
      ),

    contentScore:
      toNumberOrNull(
        row.content_score
      ),

    competitorScore:
      toNumberOrNull(
        row.competitor_score
      ),

    metrics: row.metrics,

    createdAt:
      row.created_at.toISOString(),
  };
}

const SELECT_COLUMNS = `
  id,
  snapshot_date,
  visibility_score,
  citation_score,
  technical_score,
  content_score,
  competitor_score,
  metrics,
  created_at
`;

/* ========================================
   SAVE MONITORING SNAPSHOT
======================================== */

export async function saveMonitoringSnapshot(
  schemaName: string,
  input: SaveMonitoringSnapshotInput
): Promise<MonitoringSnapshotRecord> {
  const schema =
    quoteIdentifier(schemaName);

  const id = randomUUID();

  const result =
    await pool.query<MonitoringSnapshotRow>(
      `
        INSERT INTO ${schema}.monitoring_snapshots (
          id,
          snapshot_date,
          visibility_score,
          citation_score,
          technical_score,
          content_score,
          competitor_score,
          metrics
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8::jsonb
        )
        RETURNING ${SELECT_COLUMNS}
      `,
      [
        id,
        input.snapshotDate,
        input.visibilityScore,
        input.citationScore,
        input.technicalScore,
        input.contentScore,
        input.competitorScore,
        JSON.stringify(input.metrics),
      ]
    );

  const row = result.rows[0];

  if (!row) {
    throw new Error(
      "Failed to save monitoring snapshot."
    );
  }

  return mapRow(row);
}

/* ========================================
   GET LATEST MONITORING SNAPSHOT
======================================== */

export async function getLatestMonitoringSnapshot(
  schemaName: string
): Promise<MonitoringSnapshotRecord | null> {
  const schema =
    quoteIdentifier(schemaName);

  const result =
    await pool.query<MonitoringSnapshotRow>(
      `
        SELECT ${SELECT_COLUMNS}
        FROM ${schema}.monitoring_snapshots
        ORDER BY created_at DESC
        LIMIT 1
      `
    );

  const row = result.rows[0];

  return row ? mapRow(row) : null;
}
