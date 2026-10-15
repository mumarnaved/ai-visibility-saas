import { randomUUID } from "node:crypto";

import type { AgentOutput } from "agent-contracts";

import type {
  AgentRunStore,
  FinishRun,
  StartRun,
} from "../agent-run-store.js";

export interface FakeRunRow extends StartRun {
  id: string;
  status: "running" | "succeeded" | "failed";
  attempts: number;
  error: string | null;
  errorKind: string | null;
  result: AgentOutput | null;
}

/* In-memory platform.agent_runs with the same semantics as the SQL. */
export class FakeRunStore implements AgentRunStore {
  rows: FakeRunRow[] = [];

  /* Make the named operations throw, to prove bookkeeping cannot break a run. */
  failing = new Set<string>();

  private check(op: string): void {
    if (this.failing.has(op)) {
      throw new Error(`simulated ${op} failure`);
    }
  }

  async findCheckpoint(
    tenantId: string,
    jobId: string,
    agent: string,
    inputHash: string
  ): Promise<AgentOutput | null> {
    this.check("findCheckpoint");

    const found = [...this.rows]
      .reverse()
      .find(
        (r) =>
          r.tenantId === tenantId &&
          r.jobId === jobId &&
          r.agent === agent &&
          r.inputHash === inputHash &&
          r.status === "succeeded" &&
          r.result !== null
      );

    return found ? structuredClone(found.result) : null;
  }

  async start(run: StartRun): Promise<string> {
    this.check("start");

    const row: FakeRunRow = {
      ...run,
      id: randomUUID(),
      status: "running",
      attempts: 1,
      error: null,
      errorKind: null,
      result: null,
    };

    this.rows.push(row);

    return row.id;
  }

  async recordAttempt(
    runId: string,
    attempts: number,
    error: string,
    errorKind: string
  ): Promise<void> {
    this.check("recordAttempt");

    const row = this.rows.find((r) => r.id === runId)!;

    row.attempts = attempts;
    row.error = error;
    row.errorKind = errorKind;
  }

  async finish(runId: string, outcome: FinishRun): Promise<void> {
    this.check("finish");

    const row = this.rows.find((r) => r.id === runId)!;

    row.status = outcome.status;
    row.attempts = outcome.attempts;
    row.error = outcome.error ?? null;
    row.errorKind = outcome.errorKind ?? null;
    row.result = outcome.result
      ? structuredClone(outcome.result)
      : null;
  }

  async releaseCheckpoints(jobId: string): Promise<void> {
    this.check("releaseCheckpoints");

    for (const row of this.rows) {
      if (row.jobId === jobId) {
        row.result = null;
      }
    }
  }
}
