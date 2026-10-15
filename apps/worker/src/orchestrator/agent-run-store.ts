/* ========================================
   AGENT RUN STORE

   platform.agent_runs reads and writes. Takes any
   { query } so tests pass a fake and production passes
   the lazy pool adapter. Every statement carries an
   agent_runs.<name> marker comment, which the in-memory
   fake in the tests matches on.

   Stores a HASH of the input, never the input, and only
   redacted, truncated error text. result holds the output
   of a step that succeeded inside a job (the checkpoint)
   and is cleared when that job finishes.
======================================== */

import type { AgentOutput } from "agent-contracts";

export interface AgentRunQueryable {
  query(
    sql: string,
    params?: unknown[]
  ): Promise<{ rows: any[] }>;
}

export type AgentRunStatus = "running" | "succeeded" | "failed";

export interface StartRun {
  tenantId: string;
  jobId: string | null;
  agent: string;
  inputHash: string;
}

export interface FinishRun {
  status: Exclude<AgentRunStatus, "running">;
  attempts: number;
  error?: string | null;
  errorKind?: string | null;
  /* Set only for steps inside a job: the checkpoint. */
  result?: AgentOutput | null;
}

export interface AgentRunStore {
  findCheckpoint(
    tenantId: string,
    jobId: string,
    agent: string,
    inputHash: string
  ): Promise<AgentOutput | null>;

  start(run: StartRun): Promise<string>;

  recordAttempt(
    runId: string,
    attempts: number,
    error: string,
    errorKind: string
  ): Promise<void>;

  finish(runId: string, outcome: FinishRun): Promise<void>;

  releaseCheckpoints(jobId: string): Promise<void>;
}

export function createAgentRunStore(
  db: AgentRunQueryable
): AgentRunStore {
  return {
    async findCheckpoint(tenantId, jobId, agent, inputHash) {
      const result = await db.query(
        `
          /* agent_runs.find_checkpoint */
          SELECT result
          FROM platform.agent_runs
          WHERE tenant_id = $1::uuid
            AND job_id = $2::uuid
            AND agent = $3
            AND input_hash = $4
            AND status = 'succeeded'
            AND result IS NOT NULL
          ORDER BY finished_at DESC
          LIMIT 1
        `,
        [tenantId, jobId, agent, inputHash]
      );

      return (
        (result.rows[0]?.result as AgentOutput | undefined) ??
        null
      );
    },

    async start(run) {
      const result = await db.query(
        `
          /* agent_runs.start */
          INSERT INTO platform.agent_runs
            (tenant_id, job_id, agent, input_hash)
          VALUES
            ($1::uuid, $2::uuid, $3, $4)
          RETURNING id
        `,
        [run.tenantId, run.jobId, run.agent, run.inputHash]
      );

      return result.rows[0].id as string;
    },

    async recordAttempt(runId, attempts, error, errorKind) {
      await db.query(
        `
          /* agent_runs.attempt */
          UPDATE platform.agent_runs
          SET
            attempts = $2,
            error = $3,
            error_kind = $4
          WHERE id = $1::uuid
        `,
        [runId, attempts, error, errorKind]
      );
    },

    async finish(runId, outcome) {
      await db.query(
        `
          /* agent_runs.finish */
          UPDATE platform.agent_runs
          SET
            status = $2,
            attempts = $3,
            error = $4,
            error_kind = $5,
            result = $6::jsonb,
            finished_at = NOW()
          WHERE id = $1::uuid
        `,
        [
          runId,
          outcome.status,
          outcome.attempts,
          outcome.error ?? null,
          outcome.errorKind ?? null,
          outcome.result ? JSON.stringify(outcome.result) : null,
        ]
      );
    },

    async releaseCheckpoints(jobId) {
      await db.query(
        `
          /* agent_runs.release */
          UPDATE platform.agent_runs
          SET result = NULL
          WHERE job_id = $1::uuid
            AND result IS NOT NULL
        `,
        [jobId]
      );
    },
  };
}
