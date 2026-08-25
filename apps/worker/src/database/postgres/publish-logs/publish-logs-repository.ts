import { randomUUID } from "node:crypto";

import { pool } from "../connection.js";

/* ========================================
   TYPES
======================================== */

export type PublishLogStatus =
  | "pending"
  | "published"
  | "failed";

export type PublishLogApprovalStatus =
  | "pending"
  | "approved";

export interface SavePublishLogInput {
  executionTaskId?: string | null;

  destination?: string | null;

  status: PublishLogStatus;

  approvalStatus: PublishLogApprovalStatus;

  payload: unknown;

  response: unknown;

  publishedAt?: string | null;
}

export interface PublishLogRecord {
  id: string;

  executionTaskId: string | null;

  destination: string | null;

  status: string;

  approvalStatus: string;

  payload: unknown;

  response: unknown;

  publishedAt: string | null;

  createdAt: string;
}

interface PublishLogRow {
  id: string;
  execution_task_id: string | null;
  destination: string | null;
  status: string;
  approval_status: string;
  payload: unknown;
  response: unknown;
  published_at: Date | null;
  created_at: Date;
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
   MAP ROW
======================================== */

function mapRow(
  row: PublishLogRow
): PublishLogRecord {
  return {
    id: row.id,

    executionTaskId:
      row.execution_task_id,

    destination: row.destination,

    status: row.status,

    approvalStatus:
      row.approval_status,

    payload: row.payload,

    response: row.response,

    publishedAt:
      row.published_at
        ? row.published_at.toISOString()
        : null,

    createdAt:
      row.created_at.toISOString(),
  };
}

/* ========================================
   SAVE PUBLISH LOG
======================================== */

export async function savePublishLog(
  schemaName: string,
  input: SavePublishLogInput
): Promise<PublishLogRecord> {
  const schema =
    quoteIdentifier(schemaName);

  const id = randomUUID();

  const result =
    await pool.query<PublishLogRow>(
      `
        INSERT INTO ${schema}.publish_logs (
          id,
          execution_task_id,
          destination,
          status,
          approval_status,
          payload,
          response,
          published_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8
        )
        RETURNING
          id,
          execution_task_id,
          destination,
          status,
          approval_status,
          payload,
          response,
          published_at,
          created_at
      `,
      [
        id,
        input.executionTaskId ?? null,
        input.destination ?? null,
        input.status,
        input.approvalStatus,
        JSON.stringify(input.payload),
        JSON.stringify(input.response),
        input.publishedAt ?? null,
      ]
    );

  const row = result.rows[0];

  if (!row) {
    throw new Error(
      "Failed to save publish log."
    );
  }

  return mapRow(row);
}

/* ========================================
   LIST PUBLISH LOGS FOR EXECUTION TASK
======================================== */

export async function listPublishLogsForTask(
  schemaName: string,
  executionTaskId: string
): Promise<PublishLogRecord[]> {
  const schema =
    quoteIdentifier(schemaName);

  const result =
    await pool.query<PublishLogRow>(
      `
        SELECT
          id,
          execution_task_id,
          destination,
          status,
          approval_status,
          payload,
          response,
          published_at,
          created_at
        FROM ${schema}.publish_logs
        WHERE execution_task_id = $1
        ORDER BY created_at DESC
      `,
      [executionTaskId]
    );

  return result.rows.map(mapRow);
}
