import { randomUUID } from "node:crypto";

import { pool } from "../connection.js";

/* ========================================
   TYPES
======================================== */

export type ExecutionTaskType =
  | "content_draft"
  | "entity_fix"
  | "technical_fix";

export type ExecutionTaskStatus =
  | "pending"
  | "completed"
  | "failed"
  | "published";

export type ExecutionTaskApprovalStatus =
  | "pending"
  | "approved";

export interface SaveExecutionTaskInput {
  contentPlanId?: string | null;

  taskType: ExecutionTaskType;

  title: string;

  description?: string | null;

  status?: ExecutionTaskStatus;

  approvalStatus?: ExecutionTaskApprovalStatus;

  payload: unknown;

  result: unknown;
}

export interface ExecutionTaskRecord {
  id: string;

  contentPlanId: string | null;

  taskType: string;

  title: string;

  description: string | null;

  status: string;

  approvalStatus: string;

  payload: unknown;

  result: unknown;

  createdAt: string;

  updatedAt: string;
}

interface ExecutionTaskRow {
  id: string;
  content_plan_id: string | null;
  task_type: string;
  title: string;
  description: string | null;
  status: string;
  approval_status: string;
  payload: unknown;
  result: unknown;
  created_at: Date;
  updated_at: Date;
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
  row: ExecutionTaskRow
): ExecutionTaskRecord {
  return {
    id: row.id,

    contentPlanId:
      row.content_plan_id,

    taskType: row.task_type,

    title: row.title,

    description: row.description,

    status: row.status,

    approvalStatus:
      row.approval_status,

    payload: row.payload,

    result: row.result,

    createdAt:
      row.created_at.toISOString(),

    updatedAt:
      row.updated_at.toISOString(),
  };
}

const SELECT_COLUMNS = `
  id,
  content_plan_id,
  task_type,
  title,
  description,
  status,
  approval_status,
  payload,
  result,
  created_at,
  updated_at
`;

/* ========================================
   SAVE EXECUTION TASK
======================================== */

export async function saveExecutionTask(
  schemaName: string,
  input: SaveExecutionTaskInput
): Promise<ExecutionTaskRecord> {
  const schema =
    quoteIdentifier(schemaName);

  const id = randomUUID();

  const result =
    await pool.query<ExecutionTaskRow>(
      `
        INSERT INTO ${schema}.execution_tasks (
          id,
          content_plan_id,
          task_type,
          title,
          description,
          status,
          approval_status,
          payload,
          result
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb
        )
        RETURNING ${SELECT_COLUMNS}
      `,
      [
        id,
        input.contentPlanId ?? null,
        input.taskType,
        input.title,
        input.description ?? null,
        input.status ?? "pending",
        input.approvalStatus ?? "pending",
        JSON.stringify(input.payload),
        JSON.stringify(input.result),
      ]
    );

  const row = result.rows[0];

  if (!row) {
    throw new Error(
      "Failed to save execution task."
    );
  }

  return mapRow(row);
}

/* ========================================
   GET EXECUTION TASK BY ID
======================================== */

export async function getExecutionTaskById(
  schemaName: string,
  taskId: string
): Promise<ExecutionTaskRecord | null> {
  const schema =
    quoteIdentifier(schemaName);

  const result =
    await pool.query<ExecutionTaskRow>(
      `
        SELECT ${SELECT_COLUMNS}
        FROM ${schema}.execution_tasks
        WHERE id = $1
      `,
      [taskId]
    );

  const row = result.rows[0];

  return row ? mapRow(row) : null;
}

/* ========================================
   LIST EXECUTION TASKS
======================================== */

export async function listExecutionTasks(
  schemaName: string,
  limit: number = 50
): Promise<ExecutionTaskRecord[]> {
  const schema =
    quoteIdentifier(schemaName);

  const result =
    await pool.query<ExecutionTaskRow>(
      `
        SELECT ${SELECT_COLUMNS}
        FROM ${schema}.execution_tasks
        ORDER BY created_at DESC
        LIMIT $1
      `,
      [limit]
    );

  return result.rows.map(mapRow);
}

/* ========================================
   APPROVE EXECUTION TASK
======================================== */

export async function approveExecutionTask(
  schemaName: string,
  taskId: string
): Promise<ExecutionTaskRecord | null> {
  const schema =
    quoteIdentifier(schemaName);

  const result =
    await pool.query<ExecutionTaskRow>(
      `
        UPDATE ${schema}.execution_tasks
        SET
          approval_status = 'approved',
          updated_at = NOW()
        WHERE id = $1
        RETURNING ${SELECT_COLUMNS}
      `,
      [taskId]
    );

  const row = result.rows[0];

  return row ? mapRow(row) : null;
}

/* ========================================
   MARK EXECUTION TASK PUBLISHED
======================================== */

export async function markExecutionTaskPublished(
  schemaName: string,
  taskId: string
): Promise<ExecutionTaskRecord | null> {
  const schema =
    quoteIdentifier(schemaName);

  const result =
    await pool.query<ExecutionTaskRow>(
      `
        UPDATE ${schema}.execution_tasks
        SET
          status = 'published',
          updated_at = NOW()
        WHERE id = $1
        RETURNING ${SELECT_COLUMNS}
      `,
      [taskId]
    );

  const row = result.rows[0];

  return row ? mapRow(row) : null;
}
