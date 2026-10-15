import { AsyncLocalStorage } from "node:async_hooks";

/* ========================================
   USAGE CONTEXT

   The provider clients (Firecrawl, SerpApi,
   OpenRouter) are plain functions with no
   tenant argument, and they are called several
   layers below the agents. Rather than thread a
   tenant id through every signature, whoever
   starts tenant work (the job runner, the
   automatic scan) wraps it in this context and
   meter() reads it back. AsyncLocalStorage
   follows the awaits, so concurrent jobs in one
   process never see each other's tenant.

   rateLimited is written by meter() when the
   per-tenant limiter rejects a call. Agents
   catch errors and report { success: false },
   which hides the original RateLimitError from
   the job runner; this flag survives that, so
   the runner can still tell "rate limited" from
   "really failed".
======================================== */

export interface UsageContext {
  tenantId: string;
  jobId: string | null;

  /*
   * Epoch ms by which the current function invocation must
   * be done (set by the job runner). The orchestrator will
   * not START a new step too close to it; the job continues
   * in a fresh invocation from its checkpoints instead.
   */
  deadlineAt: number | null;
  rateLimited: {
    provider: string;
    retryAfterSeconds: number;
    message: string;
  } | null;
}

const storage = new AsyncLocalStorage<UsageContext>();

export function createUsageContext(
  tenantId: string,
  jobId: string | null = null,
  deadlineAt: number | null = null
): UsageContext {
  return { tenantId, jobId, deadlineAt, rateLimited: null };
}

export function runInUsageContext<T>(
  context: UsageContext,
  fn: () => Promise<T>
): Promise<T> {
  return storage.run(context, fn);
}

export function getUsageContext():
  | UsageContext
  | undefined {
  return storage.getStore();
}
