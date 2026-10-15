import { createHash } from "node:crypto";

import { ZodError } from "zod";

import {
  validateTenantContext,
  type Agent,
  type AgentInput,
  type AgentOutput,
  type TenantContext,
} from "agent-contracts";

import { RateLimitError } from "../usage/rate-limiter.js";
import { getUsageContext } from "../usage/usage-context.js";
import type { AgentRunStore } from "./agent-run-store.js";

/* ========================================
   ORCHESTRATOR

   The only way routes and jobs run agents. For each run it:

   1. refuses a payload whose tenantId differs from the
      context's, and a tenant that is not usable (failed,
      deleted, ...), before anything is spent;
   2. skips the step entirely if it already SUCCEEDED in the
      same job with the same input (checkpoint), so a retry or
      a rate-limit / time-budget continuation never pays
      Firecrawl, SerpApi or OpenRouter twice for it;
   3. records the run in platform.agent_runs (tenant, agent,
      status, attempts, error, input HASH; never the input);
   4. retries transient failures with exponential backoff, and
      never retries validation, rate-limit or unknown failures.

   Agents report most failures as { success: false } instead of
   throwing, so both shapes are classified.
======================================== */

export type FailureKind =
  | "transient"
  | "rate_limit"
  | "validation"
  | "permanent";

export type OrchestratorErrorCode =
  | "tenant_mismatch"
  | "invalid_input"
  | "unknown_agent"
  | "not_configured";

export class OrchestratorError extends Error {
  readonly code: OrchestratorErrorCode;

  constructor(code: OrchestratorErrorCode, message: string) {
    super(message);
    this.name = "OrchestratorError";
    this.code = code;
  }
}

/*
 * Thrown before a step starts when the invocation is nearly
 * out of time. The job runner defers the job (no attempt
 * used) and the next invocation resumes from the checkpoints.
 */
export class StepBudgetExceededError extends Error {
  constructor(agent: string) {
    super(
      `Not enough time left in this invocation to start "${agent}"; the job continues in a new one.`
    );
    this.name = "StepBudgetExceededError";
  }
}

export type AgentRunner = (
  agentName: string,
  payload: unknown
) => Promise<AgentOutput>;

export interface RunOptions {
  /* Set for steps inside a queued job: enables checkpoints. */
  jobId?: string | null;
  maxAttempts?: number;
}

export interface OrchestratorDeps {
  store: AgentRunStore;

  /* Throws (e.g. TenantNotUsableError) when the tenant may not be worked on. */
  assertTenantUsable(tenantId: string): Promise<void>;

  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  backoffBaseMs?: number;
  defaultMaxAttempts?: number;
  minStepWindowMs?: number;

  log?: {
    warn(message: string, ...rest: unknown[]): void;
    error(message: string, ...rest: unknown[]): void;
  };
}

/* ========================================
   FAILURE CLASSIFICATION

   Only a failure positively recognised as transient is
   retried. Anything unknown is permanent: retrying an
   unrecognised failure risks paying for it again.
======================================== */

const TRANSIENT =
  /ECONNRESET|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EPIPE|UND_ERR|socket hang up|fetch failed|network error|timed? ?out|connection terminated|too many connections|\((?:429|500|502|503|504)\)|\b(?:502|503|504)\b|overloaded|temporar(?:y|ily) unavailable|try again/i;

const VALIDATION =
  /validation|invalid|is required|are required|must be|does not match|expected (?:string|number|object|array)/i;

export function classifyFailure(
  source: unknown
): FailureKind {
  if (source instanceof RateLimitError) {
    return "rate_limit";
  }

  if (source instanceof ZodError) {
    return "validation";
  }

  const message =
    source instanceof Error
      ? source.message
      : String(source ?? "");

  const code =
    source instanceof Error
      ? String((source as { code?: unknown }).code ?? "")
      : "";

  if (/rate limit exceeded/i.test(message)) {
    return "rate_limit";
  }

  if (VALIDATION.test(message)) {
    return "validation";
  }

  if (TRANSIENT.test(`${code} ${message}`)) {
    return "transient";
  }

  return "permanent";
}

/* ========================================
   HELPERS
======================================== */

/* Strips things that look like credentials and caps the length. */
export function redact(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b(sk|pk|rk)-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(
      /\b(api[_-]?key|token|secret|password|authorization)(["']?\s*[:=]\s*["']?)[^\s"'&,;]+/gi,
      "$1$2[redacted]"
    )
    .slice(0, 500);
}

/* Stable across key order, so equal inputs hash equally. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value ?? null);
}

export function hashInput(
  agent: string,
  payload: unknown
): string {
  return createHash("sha256")
    .update(`${agent}\n${canonical(payload)}`)
    .digest("hex");
}

const realSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/* ========================================
   ORCHESTRATOR
======================================== */

export class Orchestrator {
  private readonly agents = new Map<string, Agent>();

  constructor(private readonly deps?: OrchestratorDeps) {}

  registerAgent(agent: Agent): void {
    if (this.agents.has(agent.name)) {
      throw new Error(
        `Agent "${agent.name}" is already registered.`
      );
    }

    this.agents.set(agent.name, agent);
  }

  getAgent(name: string): Agent {
    const agent = this.agents.get(name);

    if (!agent) {
      throw new OrchestratorError(
        "unknown_agent",
        `Agent "${name}" is not registered.`
      );
    }

    return agent;
  }

  /*
   * Bare dispatch with no guards, recording or retries. Kept
   * only for the local dev scripts; routes and jobs use run().
   */
  async execute(
    agentName: string,
    tenantContext: TenantContext,
    payload: unknown
  ): Promise<AgentOutput> {
    const input: AgentInput = { tenantContext, payload };

    return this.getAgent(agentName).execute(input);
  }

  /* An AgentRunner bound to one context, e.g. for a multi-step pipeline. */
  runner(
    context: TenantContext,
    options: RunOptions = {}
  ): AgentRunner {
    return (agentName, payload) =>
      this.run(context, agentName, payload, options);
  }

  async releaseCheckpoints(jobId: string): Promise<void> {
    try {
      await this.deps?.store.releaseCheckpoints(jobId);
    } catch (error) {
      this.log().error(
        `[orchestrator] could not release checkpoints for job ${jobId}:`,
        redact(String(error))
      );
    }
  }

  /* ======================================
     RUN
  ====================================== */

  async run(
    context: TenantContext,
    agentName: string,
    input: unknown,
    options: RunOptions = {}
  ): Promise<AgentOutput> {
    const deps = this.deps;

    if (!deps) {
      throw new OrchestratorError(
        "not_configured",
        "This orchestrator has no store; use the shared orchestrator instance."
      );
    }

    const agent = this.getAgent(agentName);

    /* 1. Guards: nothing is spent until these pass. */
    const tenantContext = validateTenantContext(context);

    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input)
    ) {
      throw new OrchestratorError(
        "invalid_input",
        `Input for "${agentName}" must be an object.`
      );
    }

    const supplied = (input as { tenantId?: unknown }).tenantId;

    if (
      supplied !== undefined &&
      supplied !== tenantContext.tenantId
    ) {
      throw new OrchestratorError(
        "tenant_mismatch",
        `Input tenantId does not match the tenant context for "${agentName}".`
      );
    }

    const payload = {
      ...(input as Record<string, unknown>),
      tenantId: tenantContext.tenantId,
    };

    await deps.assertTenantUsable(tenantContext.tenantId);

    /* 2. Checkpoint: this step already succeeded in this job. */
    const jobId = options.jobId ?? null;
    const inputHash = hashInput(agentName, payload);

    if (jobId) {
      const saved = await this.safely(
        () =>
          deps.store.findCheckpoint(
            tenantContext.tenantId,
            jobId,
            agentName,
            inputHash
          ),
        "read checkpoint"
      );

      if (saved) {
        return {
          ...saved,
          metadata: {
            ...(saved.metadata ?? {}),
            resumedFromCheckpoint: true,
          },
        };
      }
    }

    /*
     * 3. A rate limit already hit in this job: spend nothing
     *    more now. The job is deferred and resumes from the
     *    checkpoints once the bucket has refilled.
     */
    const usage = getUsageContext();

    if (usage?.rateLimited) {
      throw new RateLimitError(
        usage.rateLimited.provider,
        tenantContext.tenantId,
        usage.rateLimited.retryAfterSeconds
      );
    }

    /* 4. Time: do not start a step we cannot finish. */
    const now = deps.now ?? Date.now;

    if (
      usage?.deadlineAt &&
      now() >
        usage.deadlineAt - (deps.minStepWindowMs ?? 45_000)
    ) {
      throw new StepBudgetExceededError(agentName);
    }

    /* 5. Run, record, retry. */
    const maxAttempts = Math.max(
      1,
      options.maxAttempts ?? deps.defaultMaxAttempts ?? 2
    );

    const runId = await this.safely(
      () =>
        deps.store.start({
          tenantId: tenantContext.tenantId,
          jobId,
          agent: agentName,
          inputHash,
        }),
      "record run"
    );

    const sleep = deps.sleep ?? realSleep;
    const base = deps.backoffBaseMs ?? 1000;

    let attempt = 0;

    while (true) {
      attempt += 1;

      let output: AgentOutput | null = null;
      let thrown: unknown = null;

      try {
        output = await agent.execute({
          tenantContext,
          payload,
        });
      } catch (error) {
        thrown = error;
      }

      if (output?.success) {
        await this.finish(runId, {
          status: "succeeded",
          attempts: attempt,
          /* The checkpoint: only worth keeping for a step inside a job. */
          result: jobId ? output : null,
        });

        return output;
      }

      const failure = thrown ?? output?.error ?? "Agent failed.";
      const message = redact(
        thrown instanceof Error
          ? thrown.message
          : String(output?.error ?? "Agent failed.")
      );

      /* An agent that swallowed a RateLimitError still left the flag on the usage context. */
      const kind: FailureKind =
        usage?.rateLimited && thrown === null
          ? "rate_limit"
          : classifyFailure(failure);

      if (kind === "transient" && attempt < maxAttempts) {
        await this.safely(
          () =>
            runId
              ? deps.store.recordAttempt(runId, attempt, message, kind)
              : Promise.resolve(),
          "record attempt"
        );

        await sleep(base * 2 ** (attempt - 1));

        continue;
      }

      await this.finish(runId, {
        status: "failed",
        attempts: attempt,
        error: message,
        errorKind: kind,
      });

      /* The caller (job runner) must see a rate limit as one. */
      if (thrown instanceof RateLimitError) {
        throw thrown;
      }

      if (thrown !== null) {
        if (thrown instanceof StepBudgetExceededError) {
          throw thrown;
        }

        return {
          success: false,
          error:
            thrown instanceof Error
              ? thrown.message
              : String(thrown),
          metadata: { failureKind: kind, attempts: attempt },
        };
      }

      return {
        ...output!,
        metadata: {
          ...(output!.metadata ?? {}),
          failureKind: kind,
          attempts: attempt,
        },
      };
    }
  }

  /* ---------------------------------------- */

  private log() {
    return this.deps?.log ?? console;
  }

  /* Bookkeeping must never break, or hide, the run itself. */
  private async safely<T>(
    fn: () => Promise<T>,
    what: string
  ): Promise<T | null> {
    try {
      return await fn();
    } catch (error) {
      this.log().error(
        `[orchestrator] could not ${what}:`,
        redact(error instanceof Error ? error.message : String(error))
      );

      return null;
    }
  }

  private async finish(
    runId: string | null,
    outcome: Parameters<AgentRunStore["finish"]>[1]
  ): Promise<void> {
    if (!runId || !this.deps) {
      return;
    }

    await this.safely(
      () => this.deps!.store.finish(runId, outcome),
      "finish run"
    );
  }
}
