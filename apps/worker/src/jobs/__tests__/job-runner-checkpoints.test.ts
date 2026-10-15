import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Agent, AgentOutput } from "agent-contracts";

import { createJobQueue } from "../job-queue.js";
import {
  INVOCATION_DEADLINE_MS,
  NonRetryableJobError,
  runJobs,
  type JobRegistry,
} from "../job-runner.js";
import { Orchestrator } from "../../orchestrator/orchestrator.js";
import { FakeRunStore } from "../../orchestrator/__tests__/fake-run-store.js";
import { RateLimitError } from "../../usage/rate-limiter.js";
import { FakeJobsDb } from "./fake-jobs-db.js";

process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:1/test";

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const ctx = {
  tenantId: TENANT,
  schema: "tenant_a",
  storagePrefix: `tenant-${TENANT}`,
  credentialNamespace: `credentials/tenant-${TENANT}`,
  vectorNamespace: `vector-tenant-${TENANT}`,
};

function setup() {
  const db = new FakeJobsDb();
  const queue = createJobQueue(db);

  /* The runner's clock is the fake database's. */
  const options = { now: () => db.now.getTime() };

  return { db, queue, options };
}

const calls: Record<string, number> = {};

function agent(
  name: string,
  behaviour: (n: number) => AgentOutput | Promise<AgentOutput>
): Agent {
  calls[name] = 0;

  return {
    name,
    async execute() {
      calls[name] += 1;

      return behaviour(calls[name]);
    },
  } as Agent;
}

const ok = (data: unknown): AgentOutput => ({ success: true, data });

describe("a multi-step job that is rate limited resumes without paying twice", () => {
  it("steps 1-2 run once; the deferred job re-runs only the step that did not finish", async () => {
    const { db, queue, options } = setup();

    const store = new FakeRunStore();
    const orchestrator = new Orchestrator({
      store,
      assertTenantUsable: async () => {},
      sleep: async () => {},
      /* the same clock as the runner, or the time-budget guard compares two different "nows" */
      now: () => db.now.getTime(),
      log: { warn() {}, error() {} },
    });

    /* Firecrawl-backed, Firecrawl-backed, OpenRouter-backed (rate limited the first time). */
    orchestrator.registerAgent(agent("technical", () => ok({ t: 1 })));
    orchestrator.registerAgent(agent("content", () => ok({ c: 1 })));
    orchestrator.registerAgent(
      agent("citation", (n) => {
        if (n === 1) {
          throw new RateLimitError("openrouter", TENANT, 45);
        }

        return ok({ q: 1 });
      })
    );

    const registry: JobRegistry = {
      "stage-like": async (job) => {
        const run = orchestrator.runner(ctx, { jobId: job.id });

        const results = [];

        for (const name of ["technical", "content", "citation"]) {
          const output = await run(name, {});

          if (!output.success) {
            throw new NonRetryableJobError(output.error ?? "failed");
          }

          results.push(output.data);
        }

        return results;
      },
    };

    const id = await queue.enqueue(TENANT, "stage-like");

    /* invocation 1: rate limited at the third step */
    const first = await runJobs(queue, registry, {
      ...options,
      onJobFinished: (job) => orchestrator.releaseCheckpoints(job.id),
    });

    assert.equal(first.deferred, 1);
    assert.equal(first.failed, 0);
    assert.equal(db.job(id).status, "queued");
    assert.equal(db.job(id).attempts, 0, "the deferral did not use an attempt");
    assert.equal(calls.technical, 1);
    assert.equal(calls.content, 1);
    assert.equal(calls.citation, 1);

    /* checkpoints survive a deferral */
    assert.equal(store.rows.filter((r) => r.result !== null).length, 2);

    /* invocation 2, after the wait */
    db.advance(60);

    const second = await runJobs(queue, registry, {
      ...options,
      onJobFinished: (job) => orchestrator.releaseCheckpoints(job.id),
    });

    assert.equal(second.succeeded, 1);
    assert.equal(db.job(id).status, "succeeded");
    assert.equal(calls.technical, 1, "not run (or paid for) again");
    assert.equal(calls.content, 1, "not run (or paid for) again");
    assert.equal(calls.citation, 2, "only the unfinished step ran again");

    /* and a finished job leaves no checkpoints behind */
    assert.equal(store.rows.filter((r) => r.result !== null).length, 0);
  });
});

describe("running out of time inside an invocation", () => {
  it("parks the job to continue right away, without using an attempt or counting as a failure", async () => {
    const { db, queue, options } = setup();

    const orchestrator = new Orchestrator({
      store: new FakeRunStore(),
      assertTenantUsable: async () => {},
      /* the clock jumps past the invocation deadline after step one */
      now: () => db.now.getTime(),
      minStepWindowMs: 45_000,
      log: { warn() {}, error() {} },
    });

    orchestrator.registerAgent(
      agent("one", () => {
        db.advance(INVOCATION_DEADLINE_MS / 1000 - 10);

        return ok(1);
      })
    );
    orchestrator.registerAgent(agent("two", () => ok(2)));

    const registry: JobRegistry = {
      long: async (job) => {
        const run = orchestrator.runner(ctx, { jobId: job.id });

        await run("one", {});
        await run("two", {});

        return "done";
      },
    };

    const id = await queue.enqueue(TENANT, "long");
    const summary = await runJobs(queue, registry, options);

    assert.equal(summary.deferred, 1);
    assert.equal(summary.failed, 0);
    assert.equal(summary.retried, 0);
    assert.equal(db.job(id).status, "queued");
    assert.equal(db.job(id).attempts, 0);
    assert.match(db.job(id).error ?? "", /continues in a new one/);

    /* due again almost at once (not the 30s rate-limit floor) */
    assert.ok(db.job(id).run_at.getTime() - db.now.getTime() <= 1000);

    /* the next invocation finishes it: step one is not run again */
    db.advance(2);

    const next = await runJobs(queue, registry, options);

    assert.equal(next.succeeded, 1);
    assert.equal(calls.one, 1);
    assert.equal(calls.two, 1);
  });
});

describe("onJobFinished", () => {
  it("fires for a success and for a final failure, not for a retry or a deferral", async () => {
    const { db, queue, options } = setup();
    const finished: string[] = [];

    const registry: JobRegistry = {
      good: async () => "ok",
      bad: async () => {
        throw new NonRetryableJobError("nope");
      },
      flaky: async () => {
        throw new Error("transient blip");
      },
      limited: async () => {
        throw new RateLimitError("openrouter", TENANT, 30);
      },
    };

    const ids = {
      good: await queue.enqueue(TENANT, "good"),
      bad: await queue.enqueue(TENANT, "bad"),
      flaky: await queue.enqueue(TENANT, "flaky"),
      limited: await queue.enqueue(TENANT, "limited"),
    };

    await runJobs(queue, registry, {
      ...options,
      onJobFinished: async (job, outcome) => {
        finished.push(`${job.type}:${outcome}`);
      },
    });

    assert.deepEqual(finished.sort(), ["bad:failed", "good:succeeded"]);
    assert.equal(db.job(ids.flaky).status, "queued");
    assert.equal(db.job(ids.limited).status, "queued");
  });

  it("a cleanup that throws never fails or loses the job", async () => {
    const { db, queue, options } = setup();
    const id = await queue.enqueue(TENANT, "good");

    const summary = await runJobs(
      queue,
      { good: async () => "ok" },
      {
        ...options,
        onJobFinished: async () => {
          throw new Error("cleanup exploded");
        },
      }
    );

    assert.equal(summary.succeeded, 1);
    assert.equal(db.job(id).status, "succeeded");
  });
});
