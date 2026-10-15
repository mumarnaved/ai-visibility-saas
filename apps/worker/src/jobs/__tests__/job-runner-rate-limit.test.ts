import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  backoffSeconds,
  createJobQueue,
} from "../job-queue.js";
import {
  NonRetryableJobError,
  RATE_LIMIT_MAX_DEFER_MS,
  runJobs,
  type JobRegistry,
} from "../job-runner.js";
import { createMeter } from "../../usage/meter.js";
import {
  createRateLimiter,
  RateLimitError,
} from "../../usage/rate-limiter.js";
import { createUsageRepository } from "../../usage/usage-repository.js";
import { FakeUsageDb } from "../../usage/__tests__/fake-usage-db.js";
import { FakeJobsDb } from "./fake-jobs-db.js";

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function setup() {
  const db = new FakeJobsDb();
  const queue = createJobQueue(db);

  /* The runner's clock is the fake database's, so job ages are consistent. */
  const options = { now: () => db.now.getTime() };

  return { db, queue, options };
}

describe("a rate-limited job is a retryable delay, not a failure", () => {
  it("defers a job whose handler throws RateLimitError: queued, not failed, not retried", async () => {
    const { db, queue, options } = setup();
    const id = await queue.enqueue(TENANT_A, "stage1-audit");

    const registry: JobRegistry = {
      "stage1-audit": async () => {
        throw new RateLimitError("openrouter", TENANT_A, 45);
      },
    };

    const summary = await runJobs(queue, registry, options);

    assert.equal(summary.deferred, 1);
    assert.equal(summary.failed, 0);
    assert.equal(summary.retried, 0);

    const job = db.job(id);

    assert.equal(job.status, "queued");
    assert.equal(job.finished_at, null);
    assert.match(job.error ?? "", /Rate limit exceeded for openrouter/);
    assert.equal(
      job.run_at.getTime(),
      db.now.getTime() + 45_000,
      "waits as long as the limiter said"
    );
  });

  it("waits at least the queue's existing backoff base when the limiter's wait is shorter", async () => {
    const { db, queue, options } = setup();
    const id = await queue.enqueue(TENANT_A, "x");

    await runJobs(
      queue,
      {
        x: async () => {
          throw new RateLimitError("serpapi", TENANT_A, 2);
        },
      },
      options
    );

    assert.equal(
      db.job(id).run_at.getTime(),
      db.now.getTime() + backoffSeconds(1) * 1000
    );
  });

  it("does not spend the job's attempts: it survives more deferrals than max_attempts", async () => {
    const { db, queue, options } = setup();
    const id = await queue.enqueue(TENANT_A, "x", {}, { maxAttempts: 3 });

    let runs = 0;

    const registry: JobRegistry = {
      x: async () => {
        runs += 1;

        if (runs <= 5) {
          throw new RateLimitError("openrouter", TENANT_A, 30);
        }

        return { done: true };
      },
    };

    for (let i = 0; i < 6; i++) {
      await runJobs(queue, registry, options);

      db.advance(60);
    }

    assert.equal(runs, 6);
    assert.equal(db.job(id).status, "succeeded");
    assert.equal(db.job(id).attempts, 1, "only the real run counted");
  });

  it("is not picked up again until the wait is over", async () => {
    const { db, queue, options } = setup();

    await queue.enqueue(TENANT_A, "x");

    let runs = 0;

    const registry: JobRegistry = {
      x: async () => {
        runs += 1;
        throw new RateLimitError("openrouter", TENANT_A, 120);
      },
    };

    await runJobs(queue, registry, options);
    db.advance(60);
    await runJobs(queue, registry, options);

    assert.equal(runs, 1);

    db.advance(61);
    await runJobs(queue, registry, options);

    assert.equal(runs, 2);
  });

  it("still defers when an agent swallowed the error and the handler threw something else", async () => {
    const { db, queue, options } = setup();
    const id = await queue.enqueue(TENANT_A, "stage1-audit");

    /* Real meter + limiter, 1-token bucket, so the second call is limited. */
    const usageDb = new FakeUsageDb();

    const { meter } = createMeter({
      recorder: createUsageRepository(usageDb),
      limiter: createRateLimiter(usageDb, {
        env: {
          RATE_LIMIT_OPENROUTER_CAPACITY: "1",
          RATE_LIMIT_OPENROUTER_REFILL_PER_MINUTE: "1",
        } as NodeJS.ProcessEnv,
      }),
      log: { warn: () => undefined, error: () => undefined },
    });

    const call = () =>
      meter({ provider: "openrouter", operation: "chat" }, async () => "ok");

    const registry: JobRegistry = {
      "stage1-audit": async () => {
        await call();

        /* What agents do: catch, flatten to { success: false }, and the pipeline rethrows a plain Error. */
        try {
          await call();
        } catch {
          throw new NonRetryableJobError(
            "Citation/visibility audit failed: Rate limit exceeded for openrouter."
          );
        }

        return "unreachable";
      },
    };

    const summary = await runJobs(queue, registry, options);

    assert.equal(summary.deferred, 1);
    assert.equal(summary.failed, 0);
    assert.equal(db.job(id).status, "queued");
    assert.equal(db.job(id).run_at.getTime(), db.now.getTime() + 60_000);
  });

  it("a genuine failure with no rate limit still fails as before", async () => {
    const { db, queue, options } = setup();
    const id = await queue.enqueue(TENANT_A, "x");

    const summary = await runJobs(
      queue,
      {
        x: async () => {
          throw new NonRetryableJobError("bad payload");
        },
      },
      options
    );

    assert.equal(summary.deferred, 0);
    assert.equal(summary.failed, 1);
    assert.equal(db.job(id).status, "failed");
  });

  it("gives up deferring a job older than the cap, using the normal retry path", async () => {
    const { db, queue, options } = setup();
    const id = await queue.enqueue(TENANT_A, "x");

    db.advance(RATE_LIMIT_MAX_DEFER_MS / 1000 + 1);

    const summary = await runJobs(
      queue,
      {
        x: async () => {
          throw new RateLimitError("openrouter", TENANT_A, 30);
        },
      },
      options
    );

    assert.equal(summary.deferred, 0);
    assert.equal(summary.retried, 1);
    assert.equal(db.job(id).attempts, 1);
    assert.match(db.job(id).error ?? "", /Rate limit exceeded/);
  });
});
