import { randomUUID } from "node:crypto";

import {
  pool,
} from "../connection.js";

export interface SaveContentEntityAuditInput {
  websiteUrl: string;

  score: number;

  summary: string;

  contentFindings: unknown[];

  entityFindings: unknown[];

  recommendations: string[];

  contentData: unknown;

  entityData: unknown;
}

export interface SavedContentEntityAudit {
  id: string;
  createdAt: string;
}

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

export async function saveContentEntityAudit(
  schemaName: string,
  input: SaveContentEntityAuditInput
): Promise<SavedContentEntityAudit> {
  const schema =
    quoteIdentifier(schemaName);

  const id =
    randomUUID();

  const result =
    await pool.query(
      `
        INSERT INTO ${schema}.content_entity_audits (
          id,
          website_url,
          status,
          score,
          summary,
          content_findings,
          entity_findings,
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
          $7::jsonb
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
          input.contentFindings
        ),
        JSON.stringify(
          input.entityFindings
        ),
        JSON.stringify(
          input.recommendations
        ),
      ]
    );

  const row =
    result.rows[0];

  return {
    id: row.id,
    createdAt:
      new Date(
        row.created_at
      ).toISOString(),
  };
}