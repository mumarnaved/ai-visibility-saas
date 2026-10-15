import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it } from "node:test";

import { FakeUsageDb } from "./fake-usage-db.js";

/*
 * Env must be set before the clients are imported:
 * usage-instance.ts reaches the pool lazily, and
 * the pool refuses to load without DATABASE_URL.
 * The real pool's query is replaced below, so no
 * database is touched.
 */
process.env.DATABASE_URL = "postgres://test:test@127.0.0.1:1/test";
process.env.FIRECRAWL_API_KEY = "test-firecrawl-key";
process.env.SERPAPI_API_KEY = "test-serpapi-key";
process.env.OPENROUTER_API_KEY = "test-openrouter-key";

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const db = new FakeUsageDb();

const realFetch = globalThis.fetch;

let fetchCalls: string[] = [];

let respond: (url: string) => Response = () => {
  throw new Error("no fetch stub set");
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

let firecrawl: typeof import("../../agents/shared/firecrawl-client.js");
let serpapi: typeof import("../../agents/shared/serpapi-client.js");
let openrouter: typeof import("../../agents/shared/openrouter-provider.js");
let context: typeof import("../usage-context.js");
let limiter: typeof import("../rate-limiter.js");

before(async () => {
  const { pool } = await import("../../database/postgres/connection.js");

  (pool as unknown as { query: FakeUsageDb["query"] }).query = (
    sql,
    params
  ) => db.query(sql, params);

  firecrawl = await import("../../agents/shared/firecrawl-client.js");
  serpapi = await import("../../agents/shared/serpapi-client.js");
  openrouter = await import("../../agents/shared/openrouter-provider.js");
  context = await import("../usage-context.js");
  limiter = await import("../rate-limiter.js");
});

beforeEach(() => {
  db.events = [];
  db.buckets.clear();
  db.failMarkers.clear();
  fetchCalls = [];

  delete process.env.RATE_LIMIT_OPENROUTER_CAPACITY;
  delete process.env.RATE_LIMIT_OPENROUTER_REFILL_PER_MINUTE;

  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);

    fetchCalls.push(url);

    return respond(url);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const inJob = <T>(fn: () => Promise<T>) =>
  context.runInUsageContext(context.createUsageContext(TENANT_A, JOB), fn);

describe("Firecrawl client metering", () => {
  it("records one credit for a successful scrape, attributed to the tenant and job", async () => {
    respond = () =>
      json({
        success: true,
        data: { markdown: "# hi", html: "<h1>hi</h1>", links: [], metadata: {} },
      });

    await inJob(() => firecrawl.scrapeWithFirecrawl("https://example.com"));

    assert.equal(db.events.length, 1);
    assert.equal(db.events[0].provider, "firecrawl");
    assert.equal(db.events[0].operation, "scrape");
    assert.equal(db.events[0].units, 1);
    assert.equal(db.events[0].cost_estimate, 0.0053);
    assert.equal(db.events[0].tenant_id, TENANT_A);
    assert.equal(db.events[0].job_id, JOB);
    assert.equal(db.events[0].success, true);
  });

  it("records an HTTP failure as a failed event and still throws the original error", async () => {
    respond = () => new Response("payment required", { status: 402 });

    await assert.rejects(
      inJob(() => firecrawl.scrapeWithFirecrawl("https://example.com")),
      /Firecrawl scrape failed \(402\)/
    );

    assert.equal(db.events.length, 1);
    assert.equal(db.events[0].success, false);
    assert.equal(db.events[0].units, 0);
    assert.equal(db.events[0].cost_estimate, 0);
    assert.match(db.events[0].error ?? "", /402/);
  });

  it("a usage-insert failure does not break the scrape", async () => {
    respond = () =>
      json({
        success: true,
        data: { markdown: "m", html: "h", links: [], metadata: {} },
      });

    db.failMarkers.add("usage.insert");

    const originalError = console.error;
    console.error = () => undefined;

    try {
      const result = await inJob(() =>
        firecrawl.scrapeWithFirecrawl("https://example.com")
      );

      assert.equal(result.markdown, "m");
    } finally {
      console.error = originalError;
    }
  });
});

describe("SerpApi client metering", () => {
  it("records one search", async () => {
    respond = () =>
      json({
        search_information: { total_results: 1200 },
        organic_results: [{}, {}],
      });

    const signals = await inJob(() =>
      serpapi.getSiteIndexSignals("example.com")
    );

    assert.equal(signals.indexedPagesEstimate, 1200);
    assert.equal(db.events.length, 1);
    assert.equal(db.events[0].provider, "serpapi");
    assert.equal(db.events[0].units, 1);
    assert.equal(db.events[0].cost_estimate, 0.015);
  });

  it("records an API-level error body as a failed event", async () => {
    respond = () => json({ error: "Your account has run out of searches." });

    await assert.rejects(
      inJob(() => serpapi.getSiteIndexSignals("example.com")),
      /run out of searches/
    );

    assert.equal(db.events[0].success, false);
    assert.equal(db.events[0].units, 0);
  });
});

describe("OpenRouter client metering", () => {
  const completion = (
    content: string,
    usage?: { prompt_tokens: number; completion_tokens: number }
  ) => json({ choices: [{ message: { content } }], usage });

  it("records tokens from the response usage; free models cost $0", async () => {
    respond = () =>
      completion("answer", { prompt_tokens: 120, completion_tokens: 30 });

    const result = await inJob(() => openrouter.runOpenRouter("best crm?"));

    assert.equal(result.response, "answer");
    assert.equal(db.events.length, 1);
    assert.equal(db.events[0].provider, "openrouter");
    assert.equal(db.events[0].operation, "chat_completion");
    assert.equal(db.events[0].units, 150);
    assert.equal(db.events[0].cost_estimate, 0);
  });

  it("estimates tokens (~4 chars each) when the response has no usage", async () => {
    respond = () => completion("x".repeat(400));

    await inJob(() =>
      openrouter.runOpenRouter("q".repeat(40), "s".repeat(40))
    );

    /* prompt (40 + 40) / 4 = 20, completion 400 / 4 = 100 */
    assert.equal(db.events[0].units, 120);
  });

  it("meters each attempt: failed attempts are failures, the success is metered once", async () => {
    let calls = 0;

    respond = () =>
      ++calls === 1
        ? new Response("overloaded", { status: 502 })
        : completion("recovered", { prompt_tokens: 10, completion_tokens: 5 });

    const result = await inJob(() => openrouter.runOpenRouter("hello"));

    assert.equal(result.response, "recovered");
    assert.deepEqual(
      db.events.map((e) => [e.success, e.units]),
      [
        [false, 0],
        [true, 15],
      ]
    );
  });

  it("a tenant over its limit gets RateLimitError, not a model fallback, and OpenRouter is not called", async () => {
    process.env.RATE_LIMIT_OPENROUTER_CAPACITY = "1";
    process.env.RATE_LIMIT_OPENROUTER_REFILL_PER_MINUTE = "1";

    respond = () =>
      completion("ok", { prompt_tokens: 1, completion_tokens: 1 });

    await inJob(() => openrouter.runOpenRouter("first"));

    const callsBefore = fetchCalls.length;

    await assert.rejects(
      inJob(() => openrouter.runOpenRouter("second")),
      (error: unknown) =>
        error instanceof limiter.RateLimitError &&
        error.provider === "openrouter" &&
        error.retryAfterSeconds === 60
    );

    assert.equal(fetchCalls.length, callsBefore, "no request left the process");
    assert.equal(db.events.length, 1);
  });
});
