import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  backoffSeconds,
  createJobQueue,
  STUCK_AFTER_SECONDS,
} from "../job-queue.js";
import {
  NonRetryableJobError,
  runJobs,
  type JobRegistry,
} from "../job-runner.js";
import { FakeJobsDb } from "./fake-jobs-db.js";

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function setup() {
  const db = new FakeJobsDb();
  const queue = createJobQueue(db);

  return { db, queue };
}

/* ========================================
   ENQUEUE + CLAIM
======================================== */

describe("enqueue and claim", () => {
  it("enqueue returns the job id and stores a queued job", async () => {
    const { db, queue } = setup();

    const id = await queue.enqueue(TENANT_A, "stage1-audit", { q: 1 });

    assert.match(id, /^[0-9a-f-]{36}$/);
    assert.equal(db.job(id).status, "queued");
    assert.equal(db.job(id).attempts, 0);
    assert.equal(db.job(id).max_attempts, 3);
    assert.deepEqual(db.job(id).payload, { q: 1 });
  });

  it("claimNext returns the oldest due job as running with attempts = 1", async () => {
    const { db, queue } = setup();

    const first = await queue.enqueue(TENANT_A, "a");
    db.advance(1);
    await queue.enqueue(TENANT_A, "b");

    const claimed = await queue.claimNext();

    assert.equal(claimed?.id, first);
    assert.equal(claimed?.status, "running");
    assert.equal(claimed?.attempts, 1);
    assert.ok(claimed?.locked_at);
  });

  it("claimNext returns null when nothing is due, and skips jobs scheduled for later", async () => {
    const { db, queue } = setup();

    assert.equal(await queue.claimNext(), null);

    await queue.enqueue(TENANT_A, "later", {}, {
      runAt: new Date(db.now.getTime() + 60_000),
    });

    assert.equal(await queue.claimNext(), null);

    db.advance(61);

    assert.equal((await queue.claimNext())?.type, "later");
  });

  it("enqueueOnce returns the active job for an identical request, but not for a different payload", async () => {
    const { db, queue } = setup();

    const first = await queue.enqueueOnce(TENANT_A, "stage2-plan");
    const again = await queue.enqueueOnce(TENANT_A, "stage2-plan");
    const other = await queue.enqueueOnce(TENANT_A, "stage1-audit", { q: "x" });
    const otherPayload = await queue.enqueueOnce(TENANT_A, "stage1-audit", {
      q: "y",
    });
    const otherTenant = await queue.enqueueOnce(TENANT_B, "stage2-plan");

    assert.deepEqual(again, { id: first.id, deduplicated: true });
    assert.equal(first.deduplicated, false);
    assert.notEqual(other.id, otherPayload.id);
    assert.notEqual(otherTenant.id, first.id);
    assert.equal(db.jobs.length, 4);
  });

  it("enqueueOnce queues a new job once the previous one has finished", async () => {
    const { queue } = setup();

    const first = await queue.enqueueOnce(TENANT_A, "stage2-plan");
    const claimed = await queue.claimNext();
    await queue.markSucceeded(claimed!.id, { ok: true });

    const second = await queue.enqueueOnce(TENANT_A, "stage2-plan");

    assert.notEqual(second.id, first.id);
    assert.equal(second.deduplicated, false);
  });
});

/* ========================================
   CONCURRENCY (SKIP LOCKED semantics)
======================================== */

describe("concurrent claims", () => {
  it("never hands the same job to two runners", async () => {
    const { queue } = setup();

    const ids = new Set<string>();
    for (let i = 0; i < 5; i++) {
      ids.add(await queue.enqueue(TENANT_A, "work", { i }));
    }

    const claims = await Promise.all(
      Array.from({ length: 12 }, () => queue.claimNext())
    );

    const claimed = claims.filter((c) => c !== null).map((c) => c!.id);

    assert.equal(claimed.length, 5, "exactly the 5 queued jobs are claimed");
    assert.equal(new Set(claimed).size, 5, "no job is claimed twice");
    assert.deepEqual(new Set(claimed), ids);
    assert.equal(claims.filter((c) => c === null).length, 7);
  });

  it("two runners draining the queue process every job exactly once", async () => {
    const { db, queue } = setup();

    for (let i = 0; i < 20; i++) {
      await queue.enqueue(TENANT_A, "count", { i });
    }

    const handled: string[] = [];

    const registry: JobRegistry = {
      count: async (job) => {
        await new Promise((resolve) => setImmediate(resolve));
        handled.push(job.id);
        return { done: true };
      },
    };

    const [a, b] = await Promise.all([
      runJobs(queue, registry),
      runJobs(queue, registry),
    ]);

    assert.equal(handled.length, 20);
    assert.equal(new Set(handled).size, 20);
    assert.equal(a.succeeded + b.succeeded, 20);
    assert.ok(db.jobs.every((j) => j.status === "succeeded" && j.attempts === 1));
  });
});

/* ========================================
   RETRY + BACKOFF
======================================== */

describe("retry with exponential backoff", () => {
  it("backoff doubles from 30s and is capped at an hour", () => {
    assert.deepEqual(
      [1, 2, 3, 4].map(backoffSeconds),
      [30, 60, 120, 240]
    );
    assert.equal(backoffSeconds(50), 3600);
  });

  it("a failed attempt goes back to queued with a later run_at, then fails for good after max_attempts", async () => {
    const { db, queue } = setup();
    const id = await queue.enqueue(TENANT_A, "flaky");

    /* attempt 1 */
    let job = (await queue.claimNext())!;
    assert.equal(await queue.markFailed(job, "boom 1"), "retry");
    assert.equal(db.job(id).status, "queued");
    assert.equal(db.job(id).error, "boom 1");
    assert.equal(db.job(id).run_at.getTime(), db.now.getTime() + 30_000);

    /* not claimable until the backoff has passed */
    assert.equal(await queue.claimNext(), null);
    db.advance(30);

    /* attempt 2 */
    job = (await queue.claimNext())!;
    assert.equal(job.attempts, 2);
    assert.equal(await queue.markFailed(job, "boom 2"), "retry");
    assert.equal(db.job(id).run_at.getTime(), db.now.getTime() + 60_000);

    db.advance(60);

    /* attempt 3 = max_attempts */
    job = (await queue.claimNext())!;
    assert.equal(job.attempts, 3);
    assert.equal(await queue.markFailed(job, "boom 3"), "failed");

    assert.equal(db.job(id).status, "failed");
    assert.equal(db.job(id).error, "boom 3");
    assert.ok(db.job(id).finished_at);
    assert.equal(await queue.claimNext(), null);
  });

  it("a non-retryable error fails immediately, with attempts left", async () => {
    const { db, queue } = setup();
    const id = await queue.enqueue(TENANT_A, "bad-input");

    const registry: JobRegistry = {
      "bad-input": async () => {
        throw new NonRetryableJobError("payload is incomplete");
      },
    };

    const summary = await runJobs(queue, registry);

    assert.equal(summary.failed, 1);
    assert.equal(summary.retried, 0);
    assert.equal(db.job(id).status, "failed");
    assert.equal(db.job(id).attempts, 1);
    assert.equal(db.job(id).error, "payload is incomplete");
  });

  it("an unknown job type fails without retrying", async () => {
    const { db, queue } = setup();
    const id = await queue.enqueue(TENANT_A, "nobody-handles-this");

    await runJobs(queue, {});

    assert.equal(db.job(id).status, "failed");
    assert.match(db.job(id).error ?? "", /No handler registered/);
  });

  it("the runner retries a throwing handler and records the success of a later attempt", async () => {
    const { db, queue } = setup();
    const id = await queue.enqueue(TENANT_A, "flaky");
    let calls = 0;

    const registry: JobRegistry = {
      flaky: async () => {
        calls += 1;
        if (calls === 1) throw new Error("transient");
        return { value: 42 };
      },
    };

    const first = await runJobs(queue, registry);
    assert.equal(first.retried, 1);
    assert.equal(db.job(id).status, "queued");

    db.advance(30);

    const second = await runJobs(queue, registry);
    assert.equal(second.succeeded, 1);
    assert.equal(db.job(id).status, "succeeded");
    assert.deepEqual(db.job(id).result, { value: 42 });
    assert.equal(db.job(id).attempts, 2);
  });
});

/* ========================================
   STUCK JOB RECOVERY
======================================== */

describe("stuck job recovery", () => {
  it("requeues a job left running past the function timeout", async () => {
    const { db, queue } = setup();
    const id = await queue.enqueue(TENANT_A, "slow");

    await queue.claimNext();
    db.advance(STUCK_AFTER_SECONDS - 1);

    assert.deepEqual(await queue.requeueStuck(), { requeued: 0, failed: 0 });
    assert.equal(db.job(id).status, "running");

    db.advance(2);

    assert.deepEqual(await queue.requeueStuck(), { requeued: 1, failed: 0 });
    assert.equal(db.job(id).status, "queued");
    assert.equal(db.job(id).locked_at, null);

    /* and it can be claimed again right away; the lost attempt still counts */
    const again = await queue.claimNext();
    assert.equal(again?.id, id);
    assert.equal(again?.attempts, 2);
  });

  it("fails a stuck job that has no attempts left", async () => {
    const { db, queue } = setup();
    const id = await queue.enqueue(TENANT_A, "slow", {}, { maxAttempts: 1 });

    await queue.claimNext();
    db.advance(STUCK_AFTER_SECONDS + 1);

    assert.deepEqual(await queue.requeueStuck(), { requeued: 0, failed: 1 });
    assert.equal(db.job(id).status, "failed");
    assert.match(db.job(id).error ?? "", /function timeout/);
  });

  it("runJobs recovers stuck jobs before claiming, and reports it", async () => {
    const { db, queue } = setup();
    const id = await queue.enqueue(TENANT_A, "slow");

    await queue.claimNext();
    db.advance(STUCK_AFTER_SECONDS + 1);

    const summary = await runJobs(queue, { slow: async () => "recovered" });

    assert.equal(summary.requeuedStuck, 1);
    assert.equal(summary.succeeded, 1);
    assert.equal(db.job(id).status, "succeeded");
  });

  it("leaves queued, succeeded and recently started jobs alone", async () => {
    const { db, queue } = setup();

    await queue.enqueue(TENANT_A, "q");
    const running = await queue.enqueue(TENANT_A, "r");
    await queue.claimNext();
    await queue.claimNext();
    await queue.enqueue(TENANT_A, "q2");

    db.advance(60);

    assert.deepEqual(await queue.requeueStuck(), { requeued: 0, failed: 0 });
    assert.equal(db.job(running).status, "running");
  });
});

/* ========================================
   TIME BUDGET
======================================== */

describe("time budget", () => {
  it("stops claiming once the budget is spent and leaves the rest queued", async () => {
    const { db, queue } = setup();

    for (let i = 0; i < 5; i++) {
      await queue.enqueue(TENANT_A, "tick", { i });
    }

    let clock = 0;

    const summary = await runJobs(
      queue,
      {
        tick: async () => {
          clock += 100_000;
          return null;
        },
      },
      { budgetMs: 250_000, now: () => clock }
    );

    assert.equal(summary.processed, 3);
    assert.equal(summary.budgetExhausted, true);
    assert.equal(db.jobs.filter((j) => j.status === "queued").length, 2);
  });

  it("reports an empty run without exhausting the budget", async () => {
    const { queue } = setup();

    const summary = await runJobs(queue, {});

    assert.equal(summary.processed, 0);
    assert.equal(summary.budgetExhausted, false);
  });
});

/* ========================================
   TENANT SCOPING (queue level)
======================================== */

describe("getJobForTenant", () => {
  it("returns a job only for its own tenant, and rejects malformed ids", async () => {
    const { queue } = setup();
    const id = await queue.enqueue(TENANT_A, "x");

    assert.equal((await queue.getJobForTenant(TENANT_A, id))?.id, id);
    assert.equal(await queue.getJobForTenant(TENANT_B, id), null);
    assert.equal(await queue.getJobForTenant(TENANT_A, "not-a-uuid"), null);
    assert.equal(await queue.getJobForTenant(TENANT_A, "1; DROP TABLE"), null);
  });

  it("refuses a table name that is not schema.table", () => {
    assert.throws(
      () => createJobQueue(new FakeJobsDb(), "platform.jobs; DROP TABLE x"),
      /Invalid job table name/
    );
  });
});
