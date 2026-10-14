/* ========================================
   POSTGRES JOB QUEUE

   A queue that needs no always-on process: any
   serverless invocation can claim and run jobs.
   claimNext() is one UPDATE ... WHERE id =
   (SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1),
   so concurrent runners never get the same row
   and never wait on each other.

   Every statement carries a jobs.<name> marker
   comment. The in-memory fake used by the unit
   tests matches on it, and the opt-in Postgres
   integration test runs the same SQL for real.
======================================== */

export type JobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed";

export interface JobRow {
  id: string;
  tenant_id: string;
  type: string;
  payload: Record<string, unknown>;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  run_at: Date;
  locked_at: Date | null;
  started_at: Date | null;
  finished_at: Date | null;
  result: unknown;
  error: string | null;
  created_at: Date;
}

export interface JobQueryable {
  query(
    sql: string,
    params?: unknown[]
  ): Promise<{ rows: any[] }>;
}

/* ========================================
   TUNING
======================================== */

/* The worker function has maxDuration 300s. */
export const FUNCTION_TIMEOUT_SECONDS = 300;

/*
 * A job still "running" this long after it was
 * claimed belongs to an invocation that was
 * killed at the function timeout (plus margin).
 */
export const STUCK_AFTER_SECONDS =
  FUNCTION_TIMEOUT_SECONDS + 60;

export const BACKOFF_BASE_SECONDS = 30;
export const BACKOFF_CAP_SECONDS = 60 * 60;

/* 30s, 60s, 120s, ... capped at one hour. */
export function backoffSeconds(
  attempts: number
): number {
  const exponent = Math.max(0, attempts - 1);

  return Math.min(
    BACKOFF_CAP_SECONDS,
    BACKOFF_BASE_SECONDS * 2 ** exponent
  );
}

const TABLE = /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isJobId = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value);

const COLUMNS = `
  id, tenant_id, type, payload, status, attempts,
  max_attempts, run_at, locked_at, started_at,
  finished_at, result, error, created_at
`;

export interface EnqueueOptions {
  maxAttempts?: number;
  runAt?: Date;
}

export function createJobQueue(
  db: JobQueryable,
  table = "platform.jobs"
) {
  if (!TABLE.test(table)) {
    throw new Error("Invalid job table name.");
  }

  /* ---------------------------------------- */

  async function enqueue(
    tenantId: string,
    type: string,
    payload: Record<string, unknown> = {},
    options: EnqueueOptions = {}
  ): Promise<string> {
    const result = await db.query(
      `
        /* jobs.enqueue */
        INSERT INTO ${table}
          (tenant_id, type, payload, max_attempts, run_at)
        VALUES
          ($1, $2, $3::jsonb, $4, COALESCE($5, NOW()))
        RETURNING id
      `,
      [
        tenantId,
        type,
        JSON.stringify(payload),
        options.maxAttempts ?? 3,
        options.runAt ?? null,
      ]
    );

    return result.rows[0].id as string;
  }

  /*
   * Like enqueue(), but if the same tenant already
   * has an identical job (same type and payload)
   * queued or running, returns that one instead of
   * queueing a second copy (a double click must
   * not pay for two audits).
   */
  async function enqueueOnce(
    tenantId: string,
    type: string,
    payload: Record<string, unknown> = {},
    options: EnqueueOptions = {}
  ): Promise<{ id: string; deduplicated: boolean }> {
    const existing = await db.query(
      `
        /* jobs.find_active */
        SELECT id
        FROM ${table}
        WHERE tenant_id = $1
          AND type = $2
          AND payload = $3::jsonb
          AND status IN ('queued', 'running')
        ORDER BY created_at ASC
        LIMIT 1
      `,
      [tenantId, type, JSON.stringify(payload)]
    );

    if (existing.rows.length > 0) {
      return {
        id: existing.rows[0].id as string,
        deduplicated: true,
      };
    }

    return {
      id: await enqueue(tenantId, type, payload, options),
      deduplicated: false,
    };
  }

  /* ---------------------------------------- */

  async function claimNext(): Promise<JobRow | null> {
    const result = await db.query(
      `
        /* jobs.claim */
        UPDATE ${table}
        SET
          status = 'running',
          attempts = attempts + 1,
          locked_at = NOW(),
          started_at = NOW(),
          finished_at = NULL
        WHERE id = (
          SELECT id
          FROM ${table}
          WHERE status = 'queued'
            AND run_at <= NOW()
          ORDER BY run_at ASC, created_at ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        RETURNING ${COLUMNS}
      `
    );

    return (result.rows[0] as JobRow | undefined) ?? null;
  }

  /* ---------------------------------------- */

  async function markSucceeded(
    jobId: string,
    value: unknown
  ): Promise<void> {
    await db.query(
      `
        /* jobs.succeed */
        UPDATE ${table}
        SET
          status = 'succeeded',
          result = $2::jsonb,
          error = NULL,
          locked_at = NULL,
          finished_at = NOW()
        WHERE id = $1
      `,
      [jobId, JSON.stringify(value ?? null)]
    );
  }

  /*
   * Failed attempt. With attempts left (and the
   * error retryable) the job goes back to queued
   * after an exponential backoff; otherwise it
   * is failed for good. Returns which one.
   */
  async function markFailed(
    job: Pick<JobRow, "id" | "attempts" | "max_attempts">,
    message: string,
    options: { retryable?: boolean } = {}
  ): Promise<"retry" | "failed"> {
    const retry =
      (options.retryable ?? true) &&
      job.attempts < job.max_attempts;

    if (retry) {
      await db.query(
        `
          /* jobs.retry */
          UPDATE ${table}
          SET
            status = 'queued',
            error = $2,
            locked_at = NULL,
            run_at = NOW() + make_interval(secs => $3)
          WHERE id = $1
        `,
        [job.id, message, backoffSeconds(job.attempts)]
      );

      return "retry";
    }

    await db.query(
      `
        /* jobs.give_up */
        UPDATE ${table}
        SET
          status = 'failed',
          error = $2,
          locked_at = NULL,
          finished_at = NOW()
        WHERE id = $1
      `,
      [job.id, message]
    );

    return "failed";
  }

  /* ---------------------------------------- */

  /*
   * Jobs left "running" by an invocation that died
   * at the function timeout. They go back to queued
   * (the claim already counted the attempt), or to
   * failed if they have no attempts left.
   */
  async function requeueStuck(
    olderThanSeconds = STUCK_AFTER_SECONDS
  ): Promise<{ requeued: number; failed: number }> {
    const result = await db.query(
      `
        /* jobs.requeue_stuck */
        UPDATE ${table}
        SET
          status = CASE
            WHEN attempts >= max_attempts THEN 'failed'
            ELSE 'queued'
          END,
          error = 'Job did not finish before the function timeout.',
          locked_at = NULL,
          run_at = NOW(),
          finished_at = CASE
            WHEN attempts >= max_attempts THEN NOW()
            ELSE NULL
          END
        WHERE status = 'running'
          AND locked_at < NOW() - make_interval(secs => $1)
        RETURNING id, status
      `,
      [olderThanSeconds]
    );

    const rows = result.rows as { status: JobStatus }[];

    return {
      requeued: rows.filter((r) => r.status === "queued").length,
      failed: rows.filter((r) => r.status === "failed").length,
    };
  }

  /* ---------------------------------------- */

  /*
   * Tenant-scoped read for the status endpoint. The
   * tenant id is part of the WHERE clause, so a job
   * id from another tenant is simply "not found".
   */
  async function getJobForTenant(
    tenantId: string,
    jobId: string
  ): Promise<JobRow | null> {
    if (!isJobId(jobId)) {
      return null;
    }

    const result = await db.query(
      `
        /* jobs.get_for_tenant */
        SELECT ${COLUMNS}
        FROM ${table}
        WHERE id = $1
          AND tenant_id = $2
        LIMIT 1
      `,
      [jobId, tenantId]
    );

    return (result.rows[0] as JobRow | undefined) ?? null;
  }

  return {
    enqueue,
    enqueueOnce,
    claimNext,
    markSucceeded,
    markFailed,
    requeueStuck,
    getJobForTenant,
  };
}

export type JobQueue = ReturnType<typeof createJobQueue>;
