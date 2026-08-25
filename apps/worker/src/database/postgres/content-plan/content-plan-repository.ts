import { randomUUID } from "node:crypto";

import { pool } from "../connection.js";

/* ========================================
   TYPES
======================================== */

export interface SaveContentPlanInput {
  auditReportId?: string | null;

  summary: string;

  contentGaps: unknown[];

  entityPlan: unknown[];

  technicalPlan: unknown[];

  roadmap: unknown;
}

export interface SavedContentPlan {
  id: string;
  createdAt: string;
}

export interface ContentPlanRecord {
  id: string;

  auditReportId: string | null;

  status: string;

  summary: string | null;

  contentGaps: unknown;

  entityPlan: unknown;

  technicalPlan: unknown;

  roadmap: unknown;

  approvalStatus: string;

  approvedAt: string | null;

  createdAt: string;

  updatedAt: string;
}

interface ContentPlanRow {
  id: string;
  audit_report_id: string | null;
  status: string;
  summary: string | null;
  content_gaps: unknown;
  entity_plan: unknown;
  technical_plan: unknown;
  roadmap: unknown;
  approval_status: string;
  approved_at: Date | null;
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
  row: ContentPlanRow
): ContentPlanRecord {
  return {
    id: row.id,

    auditReportId:
      row.audit_report_id,

    status: row.status,

    summary: row.summary,

    contentGaps:
      row.content_gaps,

    entityPlan:
      row.entity_plan,

    technicalPlan:
      row.technical_plan,

    roadmap: row.roadmap,

    approvalStatus:
      row.approval_status,

    approvedAt:
      row.approved_at
        ? row.approved_at.toISOString()
        : null,

    createdAt:
      row.created_at.toISOString(),

    updatedAt:
      row.updated_at.toISOString(),
  };
}

/* ========================================
   SAVE CONTENT PLAN
======================================== */

export async function saveContentPlan(
  schemaName: string,
  input: SaveContentPlanInput
): Promise<SavedContentPlan> {
  const schema =
    quoteIdentifier(schemaName);

  const id = randomUUID();

  const result =
    await pool.query(
      `
        INSERT INTO ${schema}.content_plans (
          id,
          audit_report_id,
          summary,
          content_gaps,
          entity_plan,
          technical_plan,
          roadmap
        )
        VALUES (
          $1,
          $2,
          $3,
          $4::jsonb,
          $5::jsonb,
          $6::jsonb,
          $7::jsonb
        )
        RETURNING
          id,
          created_at
      `,
      [
        id,
        input.auditReportId ?? null,
        input.summary,
        JSON.stringify(
          input.contentGaps
        ),
        JSON.stringify(
          input.entityPlan
        ),
        JSON.stringify(
          input.technicalPlan
        ),
        JSON.stringify(
          input.roadmap
        ),
      ]
    );

  const row = result.rows[0];

  if (!row) {
    throw new Error(
      "Failed to save content plan."
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
   GET LATEST CONTENT PLAN
======================================== */

export async function getLatestContentPlan(
  schemaName: string
): Promise<ContentPlanRecord | null> {
  const schema =
    quoteIdentifier(schemaName);

  const result =
    await pool.query<ContentPlanRow>(
      `
        SELECT
          id,
          audit_report_id,
          status,
          summary,
          content_gaps,
          entity_plan,
          technical_plan,
          roadmap,
          approval_status,
          approved_at,
          created_at,
          updated_at
        FROM ${schema}.content_plans
        ORDER BY created_at DESC
        LIMIT 1
      `
    );

  const row = result.rows[0];

  if (!row) {
    return null;
  }

  return mapRow(row);
}

/* ========================================
   APPROVE CONTENT PLAN
======================================== */

export async function approveContentPlan(
  schemaName: string,
  planId: string
): Promise<ContentPlanRecord | null> {
  const schema =
    quoteIdentifier(schemaName);

  const result =
    await pool.query<ContentPlanRow>(
      `
        UPDATE ${schema}.content_plans
        SET
          approval_status = 'approved',
          approved_at = NOW(),
          updated_at = NOW()
        WHERE id = $1
        RETURNING
          id,
          audit_report_id,
          status,
          summary,
          content_gaps,
          entity_plan,
          technical_plan,
          roadmap,
          approval_status,
          approved_at,
          created_at,
          updated_at
      `,
      [planId]
    );

  const row = result.rows[0];

  if (!row) {
    return null;
  }

  return mapRow(row);
}
