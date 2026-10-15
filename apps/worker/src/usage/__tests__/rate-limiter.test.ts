import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createRateLimiter,
  DEFAULT_RATE_LIMITS,
  RateLimitError,
  rateLimitConfigFor,
} from "../rate-limiter.js";
import { FakeUsageDb } from "./fake-usage-db.js";

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/* 5-token bucket refilling 1 token per 10 seconds. */
const env = {
  RATE_LIMIT_OPENROUTER_CAPACITY: "5",
  RATE_LIMIT_OPENROUTER_REFILL_PER_MINUTE: "6",
  RATE_LIMIT_FIRECRAWL_CAPACITY: "2",
  RATE_LIMIT_FIRECRAWL_REFILL_PER_MINUTE: "6",
} as NodeJS.ProcessEnv;

function setup() {
  const db = new FakeUsageDb();

  return { db, limiter: createRateLimiter(db, { env }) };
}

describe("rate limit config", () => {
  it("uses the built-in defaults when env is unset", () => {
    assert.deepEqual(
      rateLimitConfigFor("openrouter", {} as NodeJS.ProcessEnv),
      DEFAULT_RATE_LIMITS.openrouter
    );
  });

  it("takes capacity and refill from env", () => {
    assert.deepEqual(rateLimitConfigFor("openrouter", env), {
      capacity: 5,
      refillPerMinute: 6,
    });
  });

  it("ignores blank, zero, negative and non-numeric values", () => {
    for (const bad of ["", "  ", "0", "-3", "abc", "NaN"]) {
      assert.deepEqual(
        rateLimitConfigFor("serpapi", {
          RATE_LIMIT_SERPAPI_CAPACITY: bad,
          RATE_LIMIT_SERPAPI_REFILL_PER_MINUTE: bad,
        } as NodeJS.ProcessEnv),
        DEFAULT_RATE_LIMITS.serpapi,
        `value ${JSON.stringify(bad)}`
      );
    }
  });

  it("never lets capacity drop below one token", () => {
    assert.equal(
      rateLimitConfigFor("serpapi", {
        RATE_LIMIT_SERPAPI_CAPACITY: "0.2",
      } as NodeJS.ProcessEnv).capacity,
      1
    );
  });
});

describe("token bucket", () => {
  it("allows a burst up to capacity, then rejects", async () => {
    const { limiter } = setup();

    for (let i = 0; i < 5; i++) {
      await limiter.take(TENANT_A, "openrouter");
    }

    await assert.rejects(
      limiter.take(TENANT_A, "openrouter"),
      (error: unknown) => {
        assert.ok(error instanceof RateLimitError);
        assert.equal(error.provider, "openrouter");
        assert.equal(error.tenantId, TENANT_A);

        return true;
      }
    );
  });

  it("tells the caller how long to wait", async () => {
    const { db, limiter } = setup();

    for (let i = 0; i < 5; i++) {
      await limiter.take(TENANT_A, "openrouter");
    }

    /* Empty bucket, 1 token / 10s. */
    await assert.rejects(
      limiter.take(TENANT_A, "openrouter"),
      (error: unknown) =>
        error instanceof RateLimitError &&
        error.retryAfterSeconds === 10 &&
        /Retry in 10s/.test(error.message)
    );

    /* Four seconds later: six to go (rounded up). */
    db.advance(4);

    await assert.rejects(
      limiter.take(TENANT_A, "openrouter"),
      (error: unknown) =>
        error instanceof RateLimitError &&
        error.retryAfterSeconds === 6
    );
  });

  it("refills over time and allows the call after the wait", async () => {
    const { db, limiter } = setup();

    for (let i = 0; i < 5; i++) {
      await limiter.take(TENANT_A, "openrouter");
    }

    await assert.rejects(limiter.take(TENANT_A, "openrouter"));

    db.advance(10);

    await limiter.take(TENANT_A, "openrouter");

    await assert.rejects(limiter.take(TENANT_A, "openrouter"));
  });

  it("never refills past capacity", async () => {
    const { db, limiter } = setup();

    await limiter.take(TENANT_A, "openrouter");

    db.advance(60 * 60);

    for (let i = 0; i < 5; i++) {
      await limiter.take(TENANT_A, "openrouter");
    }

    await assert.rejects(limiter.take(TENANT_A, "openrouter"));
  });

  it("a rejected call spends nothing and does not delay the refill", async () => {
    const { db, limiter } = setup();

    for (let i = 0; i < 5; i++) {
      await limiter.take(TENANT_A, "openrouter");
    }

    /* Hammering a limited bucket must not push the refill out. */
    for (let i = 0; i < 20; i++) {
      db.advance(0.4);
      await assert.rejects(limiter.take(TENANT_A, "openrouter"));
    }

    /* 8s hammered so far; 2s more completes the first 10s refill. */
    db.advance(2);

    await limiter.take(TENANT_A, "openrouter");
  });

  it("one tenant being limited does not affect another tenant", async () => {
    const { limiter } = setup();

    for (let i = 0; i < 5; i++) {
      await limiter.take(TENANT_A, "openrouter");
    }

    await assert.rejects(limiter.take(TENANT_A, "openrouter"));

    /* Tenant B has its own full bucket. */
    for (let i = 0; i < 5; i++) {
      await limiter.take(TENANT_B, "openrouter");
    }

    await assert.rejects(limiter.take(TENANT_B, "openrouter"));
  });

  it("buckets are per provider as well", async () => {
    const { limiter } = setup();

    await limiter.take(TENANT_A, "firecrawl");
    await limiter.take(TENANT_A, "firecrawl");

    await assert.rejects(limiter.take(TENANT_A, "firecrawl"));

    /* Firecrawl being empty leaves OpenRouter untouched. */
    await limiter.take(TENANT_A, "openrouter");
  });

  it("concurrent callers cannot spend more tokens than the bucket holds", async () => {
    const { limiter } = setup();

    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () =>
        limiter.take(TENANT_A, "openrouter")
      )
    );

    assert.equal(
      results.filter((r) => r.status === "fulfilled").length,
      5
    );
    assert.equal(
      results.filter((r) => r.status === "rejected").length,
      7
    );
  });

  it("limits come from env at call time", async () => {
    const db = new FakeUsageDb();

    const limiter = createRateLimiter(db, {
      env: {
        RATE_LIMIT_SERPAPI_CAPACITY: "1",
        RATE_LIMIT_SERPAPI_REFILL_PER_MINUTE: "1",
      } as NodeJS.ProcessEnv,
    });

    await limiter.take(TENANT_A, "serpapi");

    await assert.rejects(
      limiter.take(TENANT_A, "serpapi"),
      (error: unknown) =>
        error instanceof RateLimitError &&
        error.retryAfterSeconds === 60
    );
  });
});
