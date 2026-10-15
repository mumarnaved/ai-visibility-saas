import type { JobQueue, JobRow } from "./job-queue.js";

import { RateLimitError } from "../usage/rate-limiter.js";
import {
  createUsageContext,
  runInUsageContext,
} from "../usage/usage-context.js";

/* ========================================
   JOB RUNNER

   Claims and processes jobs in a loop until the
   time budget is spent or the queue is empty.
   The budget stops well before the 300s function
   limit so the invocation can return a summary.
   Handlers are looked up in one registry keyed
   by job type.
======================================== */

/* Stop claiming new jobs after this long (function limit is 300s). */
export const DEFAULT_BUDGET_MS = 250_000;

/*
 * A job that keeps hitting the tenant's provider
 * rate limit is deferred (not failed) until it is
 * this old; after that it goes through the normal
 * retry/failure path so a permanently starved job
 * cannot loop forever.
 */
export const RATE_LIMIT_MAX_DEFER_MS = 6 * 60 * 60 * 1000;

/*
 * Thrown by a handler when running the job again
 * cannot help (bad input, a deterministic agent
 * failure). The job fails immediately instead of
 * burning its remaining attempts.
 */
export class NonRetryableJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableJobError";
  }
}

export type JobHandler = (
  job: JobRow
) => Promise<unknown>;

export type JobRegistry = Record<string, JobHandler>;

export interface JobRunSummary {
  processed: number;
  succeeded: number;
  retried: number;
  deferred: number;
  failed: number;
  requeuedStuck: number;
  failedStuck: number;
  elapsedMs: number;
  budgetExhausted: boolean;
}

export interface RunJobsOptions {
  budgetMs?: number;
  now?: () => number;
  log?: (line: string) => void;
}

export async function runJobs(
  queue: JobQueue,
  registry: JobRegistry,
  options: RunJobsOptions = {}
): Promise<JobRunSummary> {
  const budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS;
  const now = options.now ?? Date.now;
  const log = options.log ?? (() => undefined);
  const startedAt = now();

  const summary: JobRunSummary = {
    processed: 0,
    succeeded: 0,
    retried: 0,
    deferred: 0,
    failed: 0,
    requeuedStuck: 0,
    failedStuck: 0,
    elapsedMs: 0,
    budgetExhausted: false,
  };

  /* Recover jobs orphaned by an invocation that hit the timeout. */
  const stuck = await queue.requeueStuck();
  summary.requeuedStuck = stuck.requeued;
  summary.failedStuck = stuck.failed;

  while (true) {
    if (now() - startedAt >= budgetMs) {
      summary.budgetExhausted = true;
      break;
    }

    const job = await queue.claimNext();

    if (!job) {
      break;
    }

    summary.processed += 1;

    const handler = registry[job.type];

    /*
     * Everything the handler does runs inside this
     * tenant's usage context, so provider calls are
     * metered, rate limited and attributed to this
     * job. usage.rateLimited is set by meter() when
     * the tenant's bucket was empty, even if an
     * agent swallowed the error on the way up.
     */
    const usage = createUsageContext(job.tenant_id, job.id);

    try {
      if (!handler) {
        throw new NonRetryableJobError(
          `No handler registered for job type "${job.type}".`
        );
      }

      const result = await runInUsageContext(usage, () =>
        handler(job)
      );

      await queue.markSucceeded(job.id, result);
      summary.succeeded += 1;
      log(`job ${job.id} (${job.type}) succeeded`);
    } catch (error) {
      const rateLimit =
        error instanceof RateLimitError
          ? {
              retryAfterSeconds: error.retryAfterSeconds,
              message: error.message,
            }
          : usage.rateLimited;

      if (
        rateLimit &&
        now() - job.created_at.getTime() <
          RATE_LIMIT_MAX_DEFER_MS
      ) {
        await queue.deferRateLimited(
          job,
          rateLimit.message,
          rateLimit.retryAfterSeconds
        );

        summary.deferred += 1;

        log(
          `job ${job.id} (${job.type}) deferred: ${rateLimit.message}`
        );

        continue;
      }

      const message =
        error instanceof Error
          ? error.message
          : String(error);

      const outcome = await queue.markFailed(job, message, {
        retryable: !(error instanceof NonRetryableJobError),
      });

      if (outcome === "retry") {
        summary.retried += 1;
      } else {
        summary.failed += 1;
      }

      log(
        `job ${job.id} (${job.type}) ${
          outcome === "retry" ? "will retry" : "failed"
        }: ${message}`
      );
    }
  }

  summary.elapsedMs = now() - startedAt;

  return summary;
}
