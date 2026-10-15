import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

process.env.DATABASE_URL = "postgres://test:test@127.0.0.1:1/test";

let status = "active";
let agentRan = false;

let jobHandlers: typeof import("../job-handlers.js").jobHandlers;

before(async () => {
  const { pool } = await import("../../database/postgres/connection.js");

  (pool as unknown as {
    query: (sql: string) => Promise<{ rows: unknown[] }>;
  }).query = async (sql: string) => {
    if (sql.includes("FROM platform.tenants")) {
      return { rows: [{ schema_name: "tenant_x", status }] };
    }

    agentRan = true;

    throw new Error(`agent reached the database: ${sql.slice(0, 40)}`);
  };

  ({ jobHandlers } = await import("../job-handlers.js"));
});

const job = {
  id: "j",
  tenant_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  type: "stage4-monitor",
  payload: {},
} as never;

describe("a queued job for a deleted workspace", () => {
  it("fails without running the agent (no paid API calls), as a non-retryable error", async () => {
    for (const deleted of ["deprovisioning", "deprovisioned"]) {
      status = deleted;
      agentRan = false;

      await assert.rejects(
        jobHandlers["stage4-monitor"](job),
        (error: Error) =>
          error.name === "NonRetryableJobError" &&
          /Workspace was deleted/.test(error.message)
      );

      assert.equal(agentRan, false, deleted);
    }
  });

  it("an active workspace still reaches its agent", async () => {
    status = "active";
    agentRan = false;

    await assert.rejects(
      jobHandlers["stage4-monitor"](job),
      /agent reached the database/
    );

    assert.equal(agentRan, true);
  });
});
