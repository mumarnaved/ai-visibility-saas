import { randomUUID } from "node:crypto";

import type { JobQueryable, JobRow } from "../job-queue.js";

/* ========================================
   FAKE JOBS TABLE

   Interprets the queue's SQL by its jobs.<name>
   marker and applies the same semantics on an
   in-memory table, with a controllable clock:

   - claim takes one queued, due row and marks it
     running in a single synchronous step, so two
     concurrent callers can never get the same row
     (what FOR UPDATE SKIP LOCKED guarantees);
   - retry / give_up / succeed / requeue_stuck
     mirror their UPDATE statements.

   The real SQL is exercised against Postgres by
   job-queue.integration.test.ts (opt-in).
======================================== */

export class FakeJobsDb implements JobQueryable {
  jobs: JobRow[] = [];

  now = new Date("2026-10-15T12:00:00.000Z");

  log: string[] = [];

  advance(seconds: number): void {
    this.now = new Date(this.now.getTime() + seconds * 1000);
  }

  job(id: string): JobRow {
    const found = this.jobs.find((j) => j.id === id);

    if (!found) {
      throw new Error(`no such job ${id}`);
    }

    return found;
  }

  async query(
    sql: string,
    params: unknown[] = []
  ): Promise<{ rows: any[] }> {
    const marker = sql.match(/\/\* jobs\.(\w+) \*\//)?.[1];

    this.log.push(marker ?? "unknown");

    switch (marker) {
      case "enqueue": {
        const [tenantId, type, payload, maxAttempts, runAt] = params as [
          string,
          string,
          string,
          number,
          Date | null,
        ];

        const job: JobRow = {
          id: randomUUID(),
          tenant_id: tenantId,
          type,
          payload: JSON.parse(payload),
          status: "queued",
          attempts: 0,
          max_attempts: maxAttempts,
          run_at: runAt ?? this.now,
          locked_at: null,
          started_at: null,
          finished_at: null,
          result: null,
          error: null,
          created_at: this.now,
        };

        this.jobs.push(job);

        return { rows: [{ id: job.id }] };
      }

      case "find_active": {
        const [tenantId, type, payload] = params as [string, string, string];

        const found = this.jobs.find(
          (j) =>
            j.tenant_id === tenantId &&
            j.type === type &&
            JSON.stringify(j.payload) ===
              JSON.stringify(JSON.parse(payload)) &&
            (j.status === "queued" || j.status === "running")
        );

        return { rows: found ? [{ id: found.id }] : [] };
      }

      case "claim": {
        const due = this.jobs
          .filter(
            (j) =>
              j.status === "queued" && j.run_at.getTime() <= this.now.getTime()
          )
          .sort(
            (a, b) =>
              a.run_at.getTime() - b.run_at.getTime() ||
              a.created_at.getTime() - b.created_at.getTime()
          )[0];

        if (!due) {
          return { rows: [] };
        }

        due.status = "running";
        due.attempts += 1;
        due.locked_at = this.now;
        due.started_at = this.now;
        due.finished_at = null;

        return { rows: [{ ...due }] };
      }

      case "succeed": {
        const [id, result] = params as [string, string];
        const job = this.job(id);

        job.status = "succeeded";
        job.result = JSON.parse(result);
        job.error = null;
        job.locked_at = null;
        job.finished_at = this.now;

        return { rows: [] };
      }

      case "retry": {
        const [id, message, seconds] = params as [string, string, number];
        const job = this.job(id);

        job.status = "queued";
        job.error = message;
        job.locked_at = null;
        job.run_at = new Date(this.now.getTime() + seconds * 1000);

        return { rows: [] };
      }

      case "defer": {
        const [id, message, seconds] = params as [string, string, number];
        const job = this.job(id);

        job.status = "queued";
        job.attempts = Math.max(job.attempts - 1, 0);
        job.error = message;
        job.locked_at = null;
        job.run_at = new Date(this.now.getTime() + seconds * 1000);

        return { rows: [] };
      }

      case "give_up": {
        const [id, message] = params as [string, string];
        const job = this.job(id);

        job.status = "failed";
        job.error = message;
        job.locked_at = null;
        job.finished_at = this.now;

        return { rows: [] };
      }

      case "requeue_stuck": {
        const [olderThan] = params as [number];
        const cutoff = this.now.getTime() - olderThan * 1000;
        const rows: { id: string; status: string }[] = [];

        for (const job of this.jobs) {
          if (
            job.status === "running" &&
            job.locked_at !== null &&
            job.locked_at.getTime() < cutoff
          ) {
            const exhausted = job.attempts >= job.max_attempts;

            job.status = exhausted ? "failed" : "queued";
            job.error = "Job did not finish before the function timeout.";
            job.locked_at = null;
            job.run_at = this.now;
            job.finished_at = exhausted ? this.now : null;

            rows.push({ id: job.id, status: job.status });
          }
        }

        return { rows };
      }

      case "get_for_tenant": {
        const [id, tenantId] = params as [string, string];

        const found = this.jobs.find(
          (j) => j.id === id && j.tenant_id === tenantId
        );

        return { rows: found ? [{ ...found }] : [] };
      }

      default:
        throw new Error(`FakeJobsDb: unrecognised SQL: ${sql.slice(0, 60)}`);
    }
  }
}
