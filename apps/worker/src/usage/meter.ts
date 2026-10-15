import { getUsageContext } from "./usage-context.js";
import { RateLimitError } from "./rate-limiter.js";
import {
  costForUnits,
  type UsageProvider,
} from "./usage-rates.js";

/* ========================================
   METER

   Wraps ONE external call:

   1. takes a token from the tenant's bucket for
      that provider (throws RateLimitError when
      empty, before any money is spent);
   2. runs the call;
   3. records a usage_events row: tenant,
      provider, operation, units, estimated cost
      and the job it ran in. A call that throws
      is recorded too (success = false, 0 units,
      0 cost) and the original error is rethrown.

   Metering must never break the call it wraps.
   If the insert fails or hangs, it is logged and
   the call's own result (or error) goes through
   untouched. The same goes for the limiter's own
   infrastructure: if the bucket table cannot be
   reached, the call is allowed and the problem
   is logged; only a clean "bucket is empty"
   answer rejects.

   Outside a usage context (no tenant known) the
   call runs unmetered and unlimited, with a
   one-time warning per provider.
======================================== */

export interface Measurement {
  units: number;
  costEstimate?: number;
}

export interface MeterOptions<T> {
  provider: UsageProvider;
  operation: string;

  /*
   * Units and cost for a successful result.
   * Default: 1 unit (one credit / one search)
   * priced at the provider's flat rate.
   */
  measure?: (result: T) => Measurement;
}

export interface MeterDeps {
  recorder: {
    recordEvent(event: {
      tenantId: string;
      jobId: string | null;
      provider: UsageProvider;
      operation: string;
      units: number;
      costEstimate: number;
      success: boolean;
      error: string | null;
    }): Promise<void>;
  };

  limiter: {
    take(
      tenantId: string,
      provider: UsageProvider
    ): Promise<void>;
  };

  log?: {
    warn(message: string, ...rest: unknown[]): void;
    error(message: string, ...rest: unknown[]): void;
  };

  /* Longest the insert may delay the caller. */
  recordTimeoutMs?: number;
}

const DEFAULT_RECORD_TIMEOUT_MS = 3000;

const MAX_ERROR_LENGTH = 500;

function describeError(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : String(error);

  return message.slice(0, MAX_ERROR_LENGTH);
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out after ${ms}ms`)),
      ms
    );

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export function createMeter(deps: MeterDeps) {
  const log = deps.log ?? console;

  const recordTimeoutMs =
    deps.recordTimeoutMs ?? DEFAULT_RECORD_TIMEOUT_MS;

  const warnedUnmetered = new Set<string>();

  async function safeRecord(
    event: Parameters<
      MeterDeps["recorder"]["recordEvent"]
    >[0]
  ): Promise<void> {
    try {
      await withTimeout(
        deps.recorder.recordEvent(event),
        recordTimeoutMs
      );
    } catch (error) {
      log.error(
        `[usage] Failed to record ${event.provider} usage for tenant ${event.tenantId}:`,
        describeError(error)
      );
    }
  }

  async function meter<T>(
    options: MeterOptions<T>,
    call: () => Promise<T>
  ): Promise<T> {
    const context = getUsageContext();

    if (!context) {
      if (!warnedUnmetered.has(options.provider)) {
        warnedUnmetered.add(options.provider);

        log.warn(
          `[usage] ${options.provider} call made outside a tenant usage context; it is not metered or rate limited.`
        );
      }

      return call();
    }

    /* 1. Rate limit. */
    try {
      await deps.limiter.take(
        context.tenantId,
        options.provider
      );
    } catch (error) {
      if (error instanceof RateLimitError) {
        context.rateLimited = {
          provider: error.provider,
          retryAfterSeconds: error.retryAfterSeconds,
          message: error.message,
        };

        throw error;
      }

      log.error(
        `[usage] Rate limiter unavailable for ${options.provider}; allowing the call:`,
        describeError(error)
      );
    }

    const base = {
      tenantId: context.tenantId,
      jobId: context.jobId,
      provider: options.provider,
      operation: options.operation,
    };

    /* 2. The call. */
    let result: T;

    try {
      result = await call();
    } catch (error) {
      await safeRecord({
        ...base,
        units: 0,
        costEstimate: 0,
        success: false,
        error: describeError(error),
      });

      throw error;
    }

    /* 3. Record the success. */
    let measurement: Measurement | undefined;

    try {
      measurement = options.measure?.(result);
    } catch (error) {
      log.error(
        `[usage] Could not measure ${options.provider} ${options.operation}; recording one default unit:`,
        describeError(error)
      );
    }

    const units = measurement?.units ?? 1;

    await safeRecord({
      ...base,
      units,
      costEstimate:
        measurement?.costEstimate ??
        costForUnits(options.provider, units),
      success: true,
      error: null,
    });

    return result;
  }

  return { meter };
}
