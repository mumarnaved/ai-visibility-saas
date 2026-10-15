import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ZodError, z } from "zod";

import type { Agent, AgentOutput, TenantContext } from "agent-contracts";

import {
  Orchestrator,
  OrchestratorError,
  StepBudgetExceededError,
  classifyFailure,
  hashInput,
  redact,
} from "../orchestrator.js";
import { TenantNotUsableError } from "../../context/build-tenant-context.js";
import { RateLimitError } from "../../usage/rate-limiter.js";
import {
  createUsageContext,
  runInUsageContext,
} from "../../usage/usage-context.js";
import { FakeRunStore } from "./fake-run-store.js";

process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:1/test";

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const JOB = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const ctx: TenantContext = {
  tenantId: TENANT,
  schema: "tenant_a",
  storagePrefix: `tenant-${TENANT}`,
  credentialNamespace: `credentials/tenant-${TENANT}`,
  vectorNamespace: `vector-tenant-${TENANT}`,
};

type Step = (calls: number) => AgentOutput | Promise<AgentOutput>;

/* An agent whose behaviour per call is scripted. */
function scripted(name: string, script: Step) {
  const agent = {
    name,
    calls: 0,
    inputs: [] as unknown[],
    async execute(input: { payload: unknown }) {
      agent.calls += 1;
      agent.inputs.push(input.payload);

      return script(agent.calls);
    },
  };

  return agent;
}

const ok = (data: unknown = { done: true }): AgentOutput => ({
  success: true,
  data,
});

const fail = (error: string): AgentOutput => ({
  success: false,
  error,
});

function setup(
  options: {
    usable?: (tenantId: string) => Promise<void>;
    minStepWindowMs?: number;
    now?: () => number;
  } = {}
) {
  const store = new FakeRunStore();
  const sleeps: number[] = [];
  const logs: string[] = [];

  const orchestrator = new Orchestrator({
    store,
    assertTenantUsable: options.usable ?? (async () => undefined),
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    backoffBaseMs: 1000,
    minStepWindowMs: options.minStepWindowMs,
    now: options.now,
    log: {
      warn: (m) => logs.push(m),
      error: (m, ...rest) => logs.push([m, ...rest].join(" ")),
    },
  });

  const register = (agent: ReturnType<typeof scripted>) => {
    orchestrator.registerAgent(agent as unknown as Agent);

    return agent;
  };

  return { orchestrator, store, sleeps, logs, register };
}

/* ======================================== */

describe("orchestrator: guards (nothing is spent when they fail)", () => {
  it("rejects a payload whose tenantId differs from the context's", async () => {
    const { orchestrator, store, register } = setup();
    const agent = register(scripted("a", () => ok()));

    await assert.rejects(
      orchestrator.run(ctx, "a", { tenantId: OTHER, x: 1 }),
      (error: unknown) =>
        error instanceof OrchestratorError &&
        error.code === "tenant_mismatch"
    );

    assert.equal(agent.calls, 0);
    assert.equal(store.rows.length, 0, "a refused run is not a run");
  });

  it("fills in the context's tenantId when the payload has none, and passes the context through", async () => {
    const { orchestrator, register } = setup();
    const agent = register(scripted("a", () => ok()));

    await orchestrator.run(ctx, "a", { x: 1 });

    assert.deepEqual(agent.inputs[0], { x: 1, tenantId: TENANT });
  });

  it("rejects input that is not an object", async () => {
    const { orchestrator, register } = setup();
    const agent = register(scripted("a", () => ok()));

    for (const bad of [null, undefined, "text", 42, ["x"]]) {
      await assert.rejects(
        orchestrator.run(ctx, "a", bad),
        (error: unknown) =>
          error instanceof OrchestratorError && error.code === "invalid_input"
      );
    }

    assert.equal(agent.calls, 0);
  });

  it("rejects a malformed tenant context", async () => {
    const { orchestrator, register } = setup();
    const agent = register(scripted("a", () => ok()));

    await assert.rejects(
      orchestrator.run({ tenantId: "" } as never, "a", {}),
      ZodError
    );

    assert.equal(agent.calls, 0);
  });

  it("rejects a tenant that is not usable (failed, deleted, unknown) before running anything", async () => {
    for (const [status, message] of [
      ["failed", /not active \(status: failed\)/],
      ["provisioning", /not active \(status: provisioning\)/],
      ["suspended", /not active \(status: suspended\)/],
      ["deprovisioning", /Workspace was deleted/],
      ["deprovisioned", /Workspace was deleted/],
    ] as const) {
      const { orchestrator, store, register } = setup({
        usable: async () => {
          throw new TenantNotUsableError("not_active", status);
        },
      });
      const agent = register(scripted("a", () => ok()));

      await assert.rejects(
        orchestrator.run(ctx, "a", {}, { jobId: JOB }),
        (error: unknown) =>
          error instanceof TenantNotUsableError &&
          message.test(error.message)
      );

      assert.equal(agent.calls, 0, status);
      assert.equal(store.rows.length, 0, status);
    }

    const { orchestrator, register } = setup({
      usable: async () => {
        throw new TenantNotUsableError("not_found", null);
      },
    });
    register(scripted("a", () => ok()));

    await assert.rejects(orchestrator.run(ctx, "a", {}), /Tenant not found/);
  });

  it("an unregistered agent is an error, and a bare orchestrator refuses to run", async () => {
    const { orchestrator } = setup();

    await assert.rejects(
      orchestrator.run(ctx, "nope", {}),
      (error: unknown) =>
        error instanceof OrchestratorError && error.code === "unknown_agent"
    );

    const bare = new Orchestrator();
    bare.registerAgent(scripted("a", () => ok()) as unknown as Agent);

    await assert.rejects(
      bare.run(ctx, "a", {}),
      (error: unknown) =>
        error instanceof OrchestratorError && error.code === "not_configured"
    );
  });
});

/* ======================================== */

describe("orchestrator: recording", () => {
  it("records a run with tenant, agent, status, attempts and an input HASH, never the input", async () => {
    const { orchestrator, store, register } = setup();
    register(scripted("citation", () => ok()));

    await orchestrator.run(ctx, "citation", {
      websiteUrl: "https://secret-client.example",
      queries: [{ query: "my private prompt text" }],
    });

    assert.equal(store.rows.length, 1);

    const row = store.rows[0];

    assert.equal(row.tenantId, TENANT);
    assert.equal(row.agent, "citation");
    assert.equal(row.status, "succeeded");
    assert.equal(row.attempts, 1);
    assert.match(row.inputHash, /^[0-9a-f]{64}$/);

    const stored = JSON.stringify(row);

    assert.ok(!stored.includes("secret-client"), "no URL stored");
    assert.ok(!stored.includes("private prompt"), "no prompt stored");
  });

  it("the input hash ignores key order but not content", () => {
    assert.equal(
      hashInput("a", { x: 1, y: [1, { b: 2, a: 1 }] }),
      hashInput("a", { y: [1, { a: 1, b: 2 }], x: 1 })
    );
    assert.notEqual(hashInput("a", { x: 1 }), hashInput("a", { x: 2 }));
    assert.notEqual(hashInput("a", { x: 1 }), hashInput("b", { x: 1 }));
  });

  it("redacts credentials from stored errors and caps their length", async () => {
    const { orchestrator, store, register } = setup();
    register(
      scripted("a", () =>
        fail(
          `request failed: Authorization: Bearer sk-abcdef1234567890 api_key=SUPERSECRET123 ${"x".repeat(2000)}`
        )
      )
    );

    await orchestrator.run(ctx, "a", {});

    const error = store.rows[0].error!;

    assert.ok(!error.includes("sk-abcdef1234567890"));
    assert.ok(!error.includes("SUPERSECRET123"));
    assert.ok(error.length <= 500);
    assert.match(redact("token: abc123"), /token: \[redacted\]/);
  });

  it("bookkeeping failures never break the run", async () => {
    const { orchestrator, store, register, logs } = setup();
    const agent = register(scripted("a", () => ok({ v: 1 })));

    store.failing = new Set(["start", "finish", "findCheckpoint"]);

    const output = await orchestrator.run(ctx, "a", {}, { jobId: JOB });

    assert.equal(output.success, true);
    assert.deepEqual(output.data, { v: 1 });
    assert.equal(agent.calls, 1);
    assert.ok(logs.length >= 2, "problems were logged");
  });
});

/* ======================================== */

describe("orchestrator: retry with backoff (transient errors only)", () => {
  it("retries a transient failure and then succeeds", async () => {
    const { orchestrator, store, sleeps, register } = setup();
    const agent = register(
      scripted("a", (n) =>
        n === 1 ? fail("Firecrawl scrape failed (503): overloaded") : ok({ n })
      )
    );

    const output = await orchestrator.run(ctx, "a", {});

    assert.equal(output.success, true);
    assert.equal(agent.calls, 2);
    assert.deepEqual(sleeps, [1000]);
    assert.equal(store.rows.length, 1, "one run row, attempts counted on it");
    assert.equal(store.rows[0].status, "succeeded");
    assert.equal(store.rows[0].attempts, 2);
  });

  it("backs off exponentially across attempts and gives up after maxAttempts", async () => {
    const { orchestrator, store, sleeps, register } = setup();
    const agent = register(
      scripted("a", () => fail("fetch failed: ECONNRESET"))
    );

    const output = await orchestrator.run(ctx, "a", {}, { maxAttempts: 3 });

    assert.equal(output.success, false);
    assert.equal(agent.calls, 3);
    assert.deepEqual(sleeps, [1000, 2000]);
    assert.equal(output.metadata?.failureKind, "transient");
    assert.equal(output.metadata?.attempts, 3);
    assert.equal(store.rows[0].status, "failed");
    assert.equal(store.rows[0].errorKind, "transient");
  });

  it("retries a transient THROWN error too", async () => {
    const { orchestrator, register } = setup();
    const agent = register(
      scripted("a", (n) => {
        if (n === 1) {
          throw Object.assign(new Error("connect ETIMEDOUT"), {
            code: "ETIMEDOUT",
          });
        }

        return ok();
      })
    );

    const output = await orchestrator.run(ctx, "a", {});

    assert.equal(output.success, true);
    assert.equal(agent.calls, 2);
  });

  it("does NOT retry a validation error", async () => {
    const { orchestrator, sleeps, register, store } = setup();
    const agent = register(
      scripted("a", () => fail("Invalid input: websiteUrl is required."))
    );

    const output = await orchestrator.run(ctx, "a", {}, { maxAttempts: 5 });

    assert.equal(agent.calls, 1);
    assert.deepEqual(sleeps, []);
    assert.equal(output.success, false);
    assert.equal(output.metadata?.failureKind, "validation");
    assert.equal(store.rows[0].errorKind, "validation");
  });

  it("does NOT retry a thrown ZodError either", async () => {
    const { orchestrator, register } = setup();
    const agent = register(
      scripted("a", () => {
        z.object({ websiteUrl: z.string() }).parse({});

        return ok();
      })
    );

    const output = await orchestrator.run(ctx, "a", {}, { maxAttempts: 5 });

    assert.equal(agent.calls, 1);
    assert.equal(output.success, false);
    assert.equal(output.metadata?.failureKind, "validation");
  });

  it("does NOT retry a failure it does not recognise (retrying could pay twice)", async () => {
    const { orchestrator, register } = setup();
    const agent = register(scripted("a", () => fail("The brand could not be analysed.")));

    const output = await orchestrator.run(ctx, "a", {}, { maxAttempts: 5 });

    assert.equal(agent.calls, 1);
    assert.equal(output.metadata?.failureKind, "permanent");
  });

  it("does NOT retry a rate limit: a thrown RateLimitError is rethrown for the job runner to defer", async () => {
    const { orchestrator, store, sleeps, register } = setup();
    const limited = new RateLimitError("openrouter", TENANT, 30);
    const agent = register(
      scripted("a", () => {
        throw limited;
      })
    );

    await assert.rejects(
      orchestrator.run(ctx, "a", {}, { maxAttempts: 5 }),
      (error) => error === limited
    );

    assert.equal(agent.calls, 1);
    assert.deepEqual(sleeps, []);
    assert.equal(store.rows[0].errorKind, "rate_limit");
  });

  it("recognises a rate limit that an agent swallowed (the usage context flag) and does not retry it", async () => {
    const { orchestrator, register, sleeps } = setup();
    const usage = createUsageContext(TENANT, JOB);
    const agent = register(
      scripted("a", () => {
        usage.rateLimited = {
          provider: "openrouter",
          retryAfterSeconds: 30,
          message: "Rate limit exceeded for openrouter. Retry in 30s.",
        };

        return fail("Citation/visibility audit failed: something flattened");
      })
    );

    const output = await runInUsageContext(usage, () =>
      orchestrator.run(ctx, "a", {}, { maxAttempts: 5 })
    );

    assert.equal(agent.calls, 1);
    assert.deepEqual(sleeps, []);
    assert.equal(output.metadata?.failureKind, "rate_limit");
  });

  it("after a rate limit in this job, later steps do not start (nothing more is spent)", async () => {
    const { orchestrator, register } = setup();
    const next = register(scripted("next", () => ok()));
    const usage = createUsageContext(TENANT, JOB);

    usage.rateLimited = {
      provider: "serpapi",
      retryAfterSeconds: 45,
      message: "Rate limit exceeded for serpapi. Retry in 45s.",
    };

    await runInUsageContext(usage, async () => {
      await assert.rejects(
        orchestrator.run(ctx, "next", {}),
        (error: unknown) =>
          error instanceof RateLimitError &&
          error.provider === "serpapi" &&
          error.retryAfterSeconds === 45
      );
    });

    assert.equal(next.calls, 0);
  });

  it("classifyFailure", () => {
    const cases: Array<[unknown, string]> = [
      [new RateLimitError("openrouter", TENANT, 5), "rate_limit"],
      [new Error("Rate limit exceeded for firecrawl. Retry in 9s."), "rate_limit"],
      [new ZodError([]), "validation"],
      ["websiteUrl is required.", "validation"],
      ["Tenant context does not match audit input", "validation"],
      ["OpenRouter request failed for m (502): bad gateway", "transient"],
      ["Firecrawl scrape failed (429): slow down", "transient"],
      [Object.assign(new Error("x"), { code: "ECONNRESET" }), "transient"],
      ["Connection terminated unexpectedly", "transient"],
      ["The brand could not be analysed.", "permanent"],
      ["Firecrawl scrape failed (402): payment required", "permanent"],
      [undefined, "permanent"],
    ];

    for (const [input, expected] of cases) {
      assert.equal(classifyFailure(input), expected, String(input));
    }
  });
});

/* ======================================== */

describe("orchestrator: checkpoints (a finished step is not run, or paid for, again)", () => {
  it("skips a step that already succeeded in the same job with the same input", async () => {
    const { orchestrator, store, register } = setup();
    const agent = register(scripted("a", () => ok({ report: [1, 2, 3] })));

    const first = await orchestrator.run(ctx, "a", { q: 1 }, { jobId: JOB });
    const second = await orchestrator.run(ctx, "a", { q: 1 }, { jobId: JOB });

    assert.equal(agent.calls, 1, "the agent (and its provider calls) ran once");
    assert.deepEqual(second.data, first.data);
    assert.equal(second.metadata?.resumedFromCheckpoint, true);
    assert.equal(store.rows.length, 1, "the skip is not a new run");
  });

  it("a different input, a different job, or a different agent still runs", async () => {
    const { orchestrator, register } = setup();
    const a = register(scripted("a", () => ok()));
    const b = register(scripted("b", () => ok()));

    await orchestrator.run(ctx, "a", { q: 1 }, { jobId: JOB });
    await orchestrator.run(ctx, "a", { q: 2 }, { jobId: JOB });
    await orchestrator.run(ctx, "a", { q: 1 }, { jobId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" });
    await orchestrator.run(ctx, "b", { q: 1 }, { jobId: JOB });

    assert.equal(a.calls, 3);
    assert.equal(b.calls, 1);
  });

  it("without a jobId nothing is checkpointed (no stored result)", async () => {
    const { orchestrator, store, register } = setup();
    const agent = register(scripted("a", () => ok()));

    await orchestrator.run(ctx, "a", { q: 1 });
    await orchestrator.run(ctx, "a", { q: 1 });

    assert.equal(agent.calls, 2);
    assert.ok(store.rows.every((r) => r.result === null));
  });

  it("a FAILED step is not checkpointed, so it runs again on the retry", async () => {
    const { orchestrator, register } = setup();
    const agent = register(
      scripted("a", (n) => (n === 1 ? fail("The brand could not be analysed.") : ok()))
    );

    const first = await orchestrator.run(ctx, "a", {}, { jobId: JOB });
    const second = await orchestrator.run(ctx, "a", {}, { jobId: JOB });

    assert.equal(first.success, false);
    assert.equal(second.success, true);
    assert.equal(agent.calls, 2);
  });

  it("releasing a job's checkpoints makes its steps run again", async () => {
    const { orchestrator, store, register } = setup();
    const agent = register(scripted("a", () => ok()));

    await orchestrator.run(ctx, "a", {}, { jobId: JOB });
    await orchestrator.releaseCheckpoints(JOB);
    await orchestrator.run(ctx, "a", {}, { jobId: JOB });

    assert.equal(agent.calls, 2);
    assert.equal(
      store.rows.filter((r) => r.status === "succeeded").length,
      2,
      "the run history itself is kept"
    );
  });

  it("a multi-step job rerun after a rate limit re-runs only the step that did not finish", async () => {
    const { orchestrator, register } = setup();
    const technical = register(scripted("technical", () => ok({ t: 1 })));
    const content = register(scripted("content", () => ok({ c: 1 })));
    const citation = register(
      scripted("citation", (n) => {
        if (n === 1) {
          throw new RateLimitError("openrouter", TENANT, 30);
        }

        return ok({ q: 1 });
      })
    );

    const runJobOnce = async () => {
      const run = orchestrator.runner(ctx, { jobId: JOB });

      await run("technical", {});
      await run("content", {});
      await run("citation", {});
    };

    await assert.rejects(runJobOnce(), RateLimitError);
    await runJobOnce();

    assert.equal(technical.calls, 1, "Firecrawl-backed step paid once");
    assert.equal(content.calls, 1);
    assert.equal(citation.calls, 2, "only the unfinished step ran again");
  });
});

/* ======================================== */

describe("orchestrator: time budget", () => {
  it("does not start a step when the invocation is nearly out of time", async () => {
    let clock = 1_000_000;
    const { orchestrator, register } = setup({
      now: () => clock,
      minStepWindowMs: 45_000,
    });
    const agent = register(scripted("a", () => ok()));
    const usage = createUsageContext(TENANT, JOB, clock + 30_000);

    await runInUsageContext(usage, async () => {
      await assert.rejects(
        orchestrator.run(ctx, "a", {}, { jobId: JOB }),
        StepBudgetExceededError
      );
    });

    assert.equal(agent.calls, 0);

    /* plenty of time left: it runs */
    clock += 0;
    await runInUsageContext(
      createUsageContext(TENANT, JOB, clock + 200_000),
      async () => {
        assert.equal((await orchestrator.run(ctx, "a", {}, { jobId: JOB })).success, true);
      }
    );
  });

  it("a step already checkpointed is returned even when time is short", async () => {
    const clock = 1_000_000;
    const { orchestrator, register } = setup({ now: () => clock });
    const agent = register(scripted("a", () => ok({ v: 1 })));

    await runInUsageContext(createUsageContext(TENANT, JOB, clock + 500_000), () =>
      orchestrator.run(ctx, "a", {}, { jobId: JOB })
    );

    const output = await runInUsageContext(
      createUsageContext(TENANT, JOB, clock + 1_000),
      () => orchestrator.run(ctx, "a", {}, { jobId: JOB })
    );

    assert.equal(output.metadata?.resumedFromCheckpoint, true);
    assert.equal(agent.calls, 1);
  });
});
