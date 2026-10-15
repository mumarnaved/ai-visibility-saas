import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createMeter } from "../meter.js";
import {
  createRateLimiter,
  RateLimitError,
} from "../rate-limiter.js";
import {
  createUsageContext,
  runInUsageContext,
} from "../usage-context.js";
import { createUsageRepository } from "../usage-repository.js";
import { openRouterCost } from "../usage-rates.js";
import { FakeUsageDb } from "./fake-usage-db.js";

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const JOB = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

interface TestLog {
  warn(message: string, ...rest: unknown[]): void;
  error(message: string, ...rest: unknown[]): void;
}

const silent: TestLog = {
  warn: () => undefined,
  error: () => undefined,
};

function setup(
  options: {
    env?: NodeJS.ProcessEnv;
    recordTimeoutMs?: number;
    log?: TestLog;
  } = {}
) {
  const db = new FakeUsageDb();

  const { meter } = createMeter({
    recorder: createUsageRepository(db),
    limiter: createRateLimiter(db, {
      env: options.env ?? ({} as NodeJS.ProcessEnv),
    }),
    log: options.log ?? silent,
    recordTimeoutMs: options.recordTimeoutMs,
  });

  return { db, meter };
}

const inTenant = <T>(
  tenantId: string,
  fn: () => Promise<T>,
  jobId: string | null = null
) => runInUsageContext(createUsageContext(tenantId, jobId), fn);

describe("meter: recording", () => {
  it("records a successful call with tenant, provider, operation, units, cost and job", async () => {
    const { db, meter } = setup();

    const value = await inTenant(
      TENANT_A,
      () =>
        meter(
          {
            provider: "firecrawl",
            operation: "scrape",
            measure: () => ({ units: 1 }),
          },
          async () => "scraped"
        ),
      JOB
    );

    assert.equal(value, "scraped");
    assert.equal(db.events.length, 1);

    const event = db.events[0];

    assert.equal(event.tenant_id, TENANT_A);
    assert.equal(event.provider, "firecrawl");
    assert.equal(event.operation, "scrape");
    assert.equal(event.units, 1);
    assert.equal(event.cost_estimate, 0.0053);
    assert.equal(event.job_id, JOB);
    assert.equal(event.success, true);
    assert.equal(event.error, null);
  });

  it("defaults to one unit priced at the provider rate", async () => {
    const { db, meter } = setup();

    await inTenant(TENANT_A, () =>
      meter(
        { provider: "serpapi", operation: "search" },
        async () => "ok"
      )
    );

    assert.equal(db.events[0].units, 1);
    assert.equal(db.events[0].cost_estimate, 0.015);
    assert.equal(db.events[0].job_id, null);
  });

  it("uses the measured units and cost (tokens)", async () => {
    const { db, meter } = setup();

    await inTenant(TENANT_A, () =>
      meter(
        {
          provider: "openrouter",
          operation: "chat_completion",
          measure: (r: { prompt: number; completion: number }) => ({
            units: r.prompt + r.completion,
            costEstimate: openRouterCost(
              "some/paid-model",
              r.prompt,
              r.completion
            ),
          }),
        },
        async () => ({ prompt: 1000, completion: 500 })
      )
    );

    assert.equal(db.events[0].units, 1500);
    /* default paid rate: $1/M in, $3/M out */
    assert.equal(db.events[0].cost_estimate, 0.0025);
  });

  it("free OpenRouter models cost nothing", () => {
    assert.equal(
      openRouterCost("nvidia/nemotron-3-super-120b-a12b:free", 5000, 5000),
      0
    );
    assert.equal(openRouterCost("any/new-model:free", 1e6, 1e6), 0);
    assert.ok(openRouterCost("any/new-paid-model", 1000, 1000) > 0);
  });

  it("records a failed call as a failure with zero units and cost, and rethrows the original error", async () => {
    const { db, meter } = setup();
    const boom = new Error("Firecrawl scrape failed (402): out of credits");

    await assert.rejects(
      inTenant(
        TENANT_A,
        () =>
          meter(
            {
              provider: "firecrawl",
              operation: "scrape",
              measure: () => ({ units: 1 }),
            },
            async () => {
              throw boom;
            }
          ),
        JOB
      ),
      (error) => error === boom
    );

    assert.equal(db.events.length, 1);

    const event = db.events[0];

    assert.equal(event.success, false);
    assert.equal(event.units, 0);
    assert.equal(event.cost_estimate, 0);
    assert.equal(event.tenant_id, TENANT_A);
    assert.equal(event.provider, "firecrawl");
    assert.equal(event.job_id, JOB);
    assert.match(event.error ?? "", /out of credits/);
  });

  it("truncates very long error messages", async () => {
    const { db, meter } = setup();

    await assert.rejects(
      inTenant(TENANT_A, () =>
        meter({ provider: "serpapi", operation: "search" }, async () => {
          throw new Error("x".repeat(5000));
        })
      )
    );

    assert.equal((db.events[0].error ?? "").length, 500);
  });

  it("falls back to one default unit when measure() throws, without failing the call", async () => {
    const { db, meter } = setup();

    const value = await inTenant(TENANT_A, () =>
      meter(
        {
          provider: "serpapi",
          operation: "search",
          measure: () => {
            throw new Error("bad shape");
          },
        },
        async () => 42
      )
    );

    assert.equal(value, 42);
    assert.equal(db.events[0].units, 1);
    assert.equal(db.events[0].success, true);
  });
});

describe("meter: metering never breaks the call", () => {
  it("returns the call's result when the usage insert fails, and logs it", async () => {
    const errors: unknown[][] = [];

    const { db, meter } = setup({
      log: {
        warn: () => undefined,
        error: (...args) => {
          errors.push(args);
        },
      },
    });

    db.failMarkers.add("usage.insert");

    const value = await inTenant(TENANT_A, () =>
      meter(
        { provider: "firecrawl", operation: "scrape" },
        async () => "still works"
      )
    );

    assert.equal(value, "still works");
    assert.equal(db.events.length, 0);
    assert.equal(errors.length, 1);
    assert.match(String(errors[0][0]), /Failed to record firecrawl usage/);
    assert.match(String(errors[0][1]), /simulated usage\.insert failure/);
  });

  it("rethrows the call's own error (not the insert's) when both fail", async () => {
    const { db, meter } = setup();

    db.failMarkers.add("usage.insert");

    const original = new Error("provider down");

    await assert.rejects(
      inTenant(TENANT_A, () =>
        meter({ provider: "serpapi", operation: "search" }, async () => {
          throw original;
        })
      ),
      (error) => error === original
    );
  });

  it("does not hang the call when the database hangs", async () => {
    const { db, meter } = setup({ recordTimeoutMs: 25 });

    db.hangInserts = true;

    const started = Date.now();

    const value = await inTenant(TENANT_A, () =>
      meter(
        { provider: "openrouter", operation: "chat_completion" },
        async () => "fast"
      )
    );

    assert.equal(value, "fast");
    assert.ok(Date.now() - started < 1000);
  });

  it("allows the call when the rate limiter's own storage is down", async () => {
    const { db, meter } = setup();

    db.failMarkers.add("ratelimit.take");

    const value = await inTenant(TENANT_A, () =>
      meter(
        { provider: "firecrawl", operation: "scrape" },
        async () => "allowed"
      )
    );

    assert.equal(value, "allowed");
    assert.equal(db.events.length, 1);
  });

  it("runs unmetered, with one warning per provider, outside a tenant context", async () => {
    const warnings: string[] = [];

    const { db, meter } = setup({
      log: {
        warn: (message) => {
          warnings.push(message);
        },
        error: () => undefined,
      },
    });

    for (let i = 0; i < 3; i++) {
      assert.equal(
        await meter(
          { provider: "serpapi", operation: "search" },
          async () => "unmetered"
        ),
        "unmetered"
      );
    }

    assert.equal(db.events.length, 0);
    assert.equal(db.buckets.size, 0);
    assert.equal(warnings.length, 1);
  });
});

describe("meter: rate limiting", () => {
  const env = {
    RATE_LIMIT_SERPAPI_CAPACITY: "2",
    RATE_LIMIT_SERPAPI_REFILL_PER_MINUTE: "6",
  } as NodeJS.ProcessEnv;

  const call = (
    meter: ReturnType<typeof setup>["meter"],
    tenantId: string,
    onCall: () => void = () => undefined
  ) =>
    inTenant(tenantId, () =>
      meter({ provider: "serpapi", operation: "search" }, async () => {
        onCall();

        return "ok";
      })
    );

  it("rejects an over-limit call with RateLimitError before calling the provider, and records nothing", async () => {
    const { db, meter } = setup({ env });
    let providerCalls = 0;

    await call(meter, TENANT_A, () => providerCalls++);
    await call(meter, TENANT_A, () => providerCalls++);

    await assert.rejects(
      call(meter, TENANT_A, () => providerCalls++),
      (error: unknown) =>
        error instanceof RateLimitError &&
        error.retryAfterSeconds === 10
    );

    assert.equal(providerCalls, 2, "the third call never reached the provider");
    assert.equal(db.events.length, 2, "a refused call is not a provider call");
  });

  it("isolates tenants: A being limited leaves B unaffected", async () => {
    const { db, meter } = setup({ env });

    await call(meter, TENANT_A);
    await call(meter, TENANT_A);
    await assert.rejects(call(meter, TENANT_A), RateLimitError);

    assert.equal(await call(meter, TENANT_B), "ok");
    assert.equal(await call(meter, TENANT_B), "ok");
    await assert.rejects(call(meter, TENANT_B), RateLimitError);

    assert.equal(db.eventsFor(TENANT_A).length, 2);
    assert.equal(db.eventsFor(TENANT_B).length, 2);
  });

  it("flags the usage context so the job runner can see it even if the error is swallowed", async () => {
    const { meter } = setup({ env });
    const context = createUsageContext(TENANT_A, JOB);

    await runInUsageContext(context, async () => {
      for (let i = 0; i < 3; i++) {
        try {
          await meter(
            { provider: "serpapi", operation: "search" },
            async () => "ok"
          );
        } catch {
          /* an agent catching and flattening the error */
        }
      }
    });

    assert.ok(context.rateLimited);
    assert.equal(context.rateLimited.provider, "serpapi");
    assert.equal(context.rateLimited.retryAfterSeconds, 10);
  });

  it("keeps concurrent contexts apart (AsyncLocalStorage)", async () => {
    const { db, meter } = setup();

    await Promise.all([
      inTenant(TENANT_A, async () => {
        await new Promise((r) => setTimeout(r, 5));
        await meter({ provider: "serpapi", operation: "a" }, async () => 1);
      }),
      inTenant(TENANT_B, async () => {
        await meter({ provider: "serpapi", operation: "b" }, async () => 2);
      }),
    ]);

    assert.equal(db.events.find((e) => e.operation === "a")?.tenant_id, TENANT_A);
    assert.equal(db.events.find((e) => e.operation === "b")?.tenant_id, TENANT_B);
  });
});
