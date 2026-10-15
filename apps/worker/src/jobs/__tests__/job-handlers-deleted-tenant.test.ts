import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Agent, AgentOutput } from "agent-contracts";

import {
  TenantNotUsableError,
  buildTenantContextWith,
  type BuildTenantContextDeps,
  type TenantRow,
  type TenantRuntime,
} from "../../context/build-tenant-context.js";
import { Orchestrator } from "../../orchestrator/orchestrator.js";
import { FakeRunStore } from "../../orchestrator/__tests__/fake-run-store.js";
import { RateLimitError } from "../../usage/rate-limiter.js";

process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:1/test";

const { createJobHandlers } = await import("../job-handlers.js");

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

let status = "active";

const tenantRow = (): TenantRow => ({
  id: TENANT,
  name: "nexflow",
  slug: "nexflow",
  website_url: "https://nexflow.example",
  schema_name: "tenant_aaaa",
  status,
  plan: "starter",
});

const contextDeps: BuildTenantContextDeps = {
  loadTenant: async () => tenantRow(),
  pool: {
    query: async () => ({ rows: [] }),
    connect: async () => ({
      query: async () => ({ rows: [] }),
      release() {},
    }),
  },
  rawStorage: {
    write: async () => {},
    read: async () => Buffer.alloc(0),
    delete: async () => {},
    list: async () => [],
  },
  providers: {
    firecrawl: { scrape: async () => ({}) },
    serpapi: { siteIndexSignals: async () => ({}) },
    openrouter: { run: async () => ({}) },
  },
  loadPlan: async () => ({ planTier: "free", status: "active", websiteLimit: 1 }),
};

let agentRuns = 0;
let monitoringResult: () => AgentOutput | Promise<AgentOutput> = () => ({
  success: true,
  data: { snapshot: 1 },
});

function build() {
  const orchestrator = new Orchestrator({
    store: new FakeRunStore(),
    /* the same check the real orchestrator performs before a run */
    assertTenantUsable: async () => {
      const tenant = tenantRow();

      if (tenant.status !== "active") {
        throw new TenantNotUsableError("not_active", tenant.status);
      }
    },
    sleep: async () => {},
    log: { warn() {}, error() {} },
  });

  orchestrator.registerAgent({
    name: "monitoring",
    async execute() {
      agentRuns += 1;

      return monitoringResult();
    },
  } as Agent);

  return createJobHandlers({
    orchestrator,
    buildContext: (tenantId): Promise<TenantRuntime> =>
      buildTenantContextWith(contextDeps, tenantId),
  });
}

const job = {
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  tenant_id: TENANT,
  type: "stage4-monitor",
  payload: {},
} as never;

describe("job handlers go through buildTenantContext and the orchestrator", () => {
  it("a queued job for a deleted workspace fails as non-retryable, before any agent runs", async () => {
    for (const deleted of ["deprovisioning", "deprovisioned"]) {
      status = deleted;
      agentRuns = 0;

      await assert.rejects(
        build()["stage4-monitor"](job),
        (error: Error) =>
          error.name === "NonRetryableJobError" &&
          /Workspace was deleted/.test(error.message),
        deleted
      );

      assert.equal(agentRuns, 0, deleted);
    }
  });

  it("a failed tenant is rejected too", async () => {
    status = "failed";
    agentRuns = 0;

    await assert.rejects(
      build()["stage4-monitor"](job),
      (error: Error) =>
        error.name === "NonRetryableJobError" && /not active/.test(error.message)
    );

    assert.equal(agentRuns, 0);
  });

  it("an active tenant runs its agent through the orchestrator and returns the data", async () => {
    status = "active";
    agentRuns = 0;
    monitoringResult = () => ({ success: true, data: { snapshot: 1 } });

    assert.deepEqual(await build()["stage4-monitor"](job), { snapshot: 1 });
    assert.equal(agentRuns, 1);
  });

  it("an agent that reports failure fails the job without retrying it", async () => {
    status = "active";
    monitoringResult = () => ({ success: false, error: "Monitoring blew up." });

    await assert.rejects(
      build()["stage4-monitor"](job),
      (error: Error) =>
        error.name === "NonRetryableJobError" && /Monitoring blew up/.test(error.message)
    );
  });

  it("a rate limit from the orchestrator reaches the job runner untouched (so the job is deferred)", async () => {
    status = "active";
    const limited = new RateLimitError("openrouter", TENANT, 30);
    monitoringResult = () => {
      throw limited;
    };

    await assert.rejects(
      build()["stage4-monitor"](job),
      (error) => error === limited
    );
  });

  it("a payload for another tenant is refused by the orchestrator, not run", async () => {
    status = "active";
    agentRuns = 0;
    monitoringResult = () => ({ success: true, data: {} });

    const orchestrator = new Orchestrator({
      store: new FakeRunStore(),
      assertTenantUsable: async () => {},
    });
    orchestrator.registerAgent({
      name: "monitoring",
      async execute() {
        agentRuns += 1;

        return { success: true, data: {} };
      },
    } as Agent);

    const context = await buildTenantContextWith(contextDeps, TENANT);

    await assert.rejects(
      orchestrator.run(context, "monitoring", {
        tenantId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      }),
      /does not match/
    );

    assert.equal(agentRuns, 0);
  });
});
