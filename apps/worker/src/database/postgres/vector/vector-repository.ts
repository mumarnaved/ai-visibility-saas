import { randomUUID } from "node:crypto";

import { pool } from "../connection.js";

/* ========================================
   TYPES
======================================== */

export interface SaveEmbeddingInput {
  entityName: string;
  entityType: string;
  embedding: number[];
  metadata?: Record<string, unknown>;
}

export interface SavedEmbedding {
  id: string;
  createdAt: string;
}

export interface SimilarEntity {
  id: string;
  entityName: string;
  entityType: string;
  metadata: unknown;
  distance: number;
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
   TO PGVECTOR LITERAL
======================================== */

function toVectorLiteral(
  embedding: number[]
): string {
  return `[${embedding.join(",")}]`;
}

/* ========================================
   SAVE EMBEDDING
======================================== */

export async function saveEmbedding(
  schemaName: string,
  input: SaveEmbeddingInput
): Promise<SavedEmbedding> {
  const schema =
    quoteIdentifier(schemaName);

  const id =
    randomUUID();

  const result =
    await pool.query(
      `
        INSERT INTO ${schema}.entity_embeddings (
          id,
          entity_name,
          entity_type,
          embedding,
          metadata
        )
        VALUES (
          $1,
          $2,
          $3,
          $4::vector,
          $5::jsonb
        )
        RETURNING
          id,
          created_at
      `,
      [
        id,
        input.entityName,
        input.entityType,
        toVectorLiteral(
          input.embedding
        ),
        JSON.stringify(
          input.metadata ?? {}
        ),
      ]
    );

  const row =
    result.rows[0];

  if (!row) {
    throw new Error(
      "Failed to save entity embedding."
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
   SEARCH SIMILAR ENTITIES
======================================== */

export async function searchSimilarEntities(
  schemaName: string,
  embedding: number[],
  limit = 10
): Promise<SimilarEntity[]> {
  const schema =
    quoteIdentifier(schemaName);

  const result =
    await pool.query(
      `
        SELECT
          id,
          entity_name,
          entity_type,
          metadata,
          embedding <=> $1::vector AS distance,
          created_at
        FROM ${schema}.entity_embeddings
        ORDER BY embedding <=> $1::vector
        LIMIT $2
      `,
      [
        toVectorLiteral(embedding),
        limit,
      ]
    );

  return result.rows.map(
    (row) => ({
      id: row.id,
      entityName: row.entity_name,
      entityType: row.entity_type,
      metadata: row.metadata,
      distance: Number(row.distance),
      createdAt:
        new Date(
          row.created_at
        ).toISOString(),
    })
  );
}
