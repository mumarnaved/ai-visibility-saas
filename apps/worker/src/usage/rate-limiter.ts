import {
  USAGE_PROVIDERS,
  type UsageProvider,
} from "./usage-rates.js";

/* ========================================
   PER-TENANT RATE LIMITER (TOKEN BUCKET)

   Stops one tenant from exhausting a shared
   provider quota. State lives in
   platform.rate_limit_buckets, not memory:
   serverless instances share nothing, so an
   in-process counter would let a tenant spread
   calls over instances and never be limited.

   One bucket per (tenant, provider). It holds
   up to `capacity` tokens and refills
   continuously at `refillPerMinute`. A call
   takes one token. Buckets are independent per
   tenant and per provider, so one tenant being
   limited never affects another.

   Taking a token is ONE atomic statement (an
   upsert whose UPDATE only fires when enough
   tokens are available), so concurrent
   invocations cannot both spend the last token.
   A rejected call changes nothing.
======================================== */

export interface RateLimitQueryable {
  query(
    sql: string,
    params?: unknown[]
  ): Promise<{ rows: any[] }>;
}

export interface RateLimitConfig {
  /* Burst size: tokens a full bucket holds. */
  capacity: number;
  /* Sustained rate: tokens added per minute. */
  refillPerMinute: number;
}

/*
 * Defaults, per tenant. A Stage 1 audit makes
 * roughly one OpenRouter call per query, a few
 * Firecrawl scrapes and one SerpApi search per
 * competitor, so these leave normal use well
 * clear of the limit while stopping a runaway
 * loop. Override with, for example:
 *   RATE_LIMIT_OPENROUTER_CAPACITY=60
 *   RATE_LIMIT_OPENROUTER_REFILL_PER_MINUTE=60
 */
export const DEFAULT_RATE_LIMITS: Record<
  UsageProvider,
  RateLimitConfig
> = {
  openrouter: { capacity: 30, refillPerMinute: 30 },
  firecrawl: { capacity: 20, refillPerMinute: 20 },
  serpapi: { capacity: 10, refillPerMinute: 10 },
};

function positiveNumber(
  value: string | undefined
): number | null {
  if (value === undefined || value.trim() === "") {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : null;
}

/*
 * Env wins when it is a positive number;
 * anything else (unset, blank, zero, garbage)
 * falls back to the default. capacity is kept
 * at 1 or more so a bucket can always hold the
 * token a call needs.
 */
export function rateLimitConfigFor(
  provider: UsageProvider,
  env: NodeJS.ProcessEnv = process.env
): RateLimitConfig {
  const key = provider.toUpperCase();
  const defaults = DEFAULT_RATE_LIMITS[provider];

  const capacity = positiveNumber(
    env[`RATE_LIMIT_${key}_CAPACITY`]
  );

  const refill = positiveNumber(
    env[`RATE_LIMIT_${key}_REFILL_PER_MINUTE`]
  );

  return {
    capacity: Math.max(1, capacity ?? defaults.capacity),
    refillPerMinute:
      refill ?? defaults.refillPerMinute,
  };
}

export function allRateLimitConfigs(
  env: NodeJS.ProcessEnv = process.env
): Record<UsageProvider, RateLimitConfig> {
  return Object.fromEntries(
    USAGE_PROVIDERS.map((provider) => [
      provider,
      rateLimitConfigFor(provider, env),
    ])
  ) as Record<UsageProvider, RateLimitConfig>;
}

/* ========================================
   RATE LIMIT ERROR
======================================== */

export class RateLimitError extends Error {
  readonly provider: string;
  readonly tenantId: string;
  readonly retryAfterSeconds: number;

  constructor(
    provider: string,
    tenantId: string,
    retryAfterSeconds: number
  ) {
    super(
      `Rate limit exceeded for ${provider}. Retry in ${retryAfterSeconds}s.`
    );

    this.name = "RateLimitError";
    this.provider = provider;
    this.tenantId = tenantId;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/* ========================================
   LIMITER
======================================== */

export function createRateLimiter(
  db: RateLimitQueryable,
  options: {
    env?: NodeJS.ProcessEnv;
  } = {}
) {
  const env = options.env ?? process.env;

  /*
   * $3 capacity, $4 refill per SECOND, $5 cost.
   * Tokens refill from updated_at, capped at
   * capacity; GREATEST(0, ...) guards against a
   * transaction whose NOW() is slightly earlier
   * than the last update. The WHERE makes the
   * UPDATE a no-op (no row returned) when the
   * refilled bucket cannot cover the cost. A
   * first-ever call inserts a full bucket minus
   * the cost.
   */
  async function tryTake(
    tenantId: string,
    provider: UsageProvider,
    cost = 1
  ): Promise<boolean> {
    const { capacity, refillPerMinute } =
      rateLimitConfigFor(provider, env);

    const result = await db.query(
      `
        /* ratelimit.take */
        INSERT INTO platform.rate_limit_buckets AS b
          (tenant_id, provider, tokens, updated_at)
        VALUES
          ($1::uuid, $2, $3::double precision - $5::double precision, NOW())
        ON CONFLICT (tenant_id, provider) DO UPDATE
        SET
          tokens = LEAST(
            $3::double precision,
            b.tokens + GREATEST(0, EXTRACT(EPOCH FROM (NOW() - b.updated_at))) * $4::double precision
          ) - $5::double precision,
          updated_at = NOW()
        WHERE LEAST(
            $3::double precision,
            b.tokens + GREATEST(0, EXTRACT(EPOCH FROM (NOW() - b.updated_at))) * $4::double precision
          ) >= $5::double precision
        RETURNING tokens
      `,
      [
        tenantId,
        provider,
        capacity,
        refillPerMinute / 60,
        cost,
      ]
    );

    return result.rows.length > 0;
  }

  /* Seconds until `cost` tokens will be available. */
  async function secondsUntilAvailable(
    tenantId: string,
    provider: UsageProvider,
    cost = 1
  ): Promise<number> {
    const { capacity, refillPerMinute } =
      rateLimitConfigFor(provider, env);

    const perSecond = refillPerMinute / 60;

    const result = await db.query(
      `
        /* ratelimit.peek */
        SELECT
          LEAST(
            $3::double precision,
            tokens + GREATEST(0, EXTRACT(EPOCH FROM (NOW() - updated_at))) * $4::double precision
          ) AS available
        FROM platform.rate_limit_buckets
        WHERE tenant_id = $1::uuid
          AND provider = $2
      `,
      [tenantId, provider, capacity, perSecond]
    );

    const available = Number(
      result.rows[0]?.available ?? capacity
    );

    /* The epsilon keeps float noise (6.000000000000001) from adding a second. */
    return Math.max(
      1,
      Math.ceil((cost - available) / perSecond - 1e-9)
    );
  }

  /*
   * Takes a token or throws RateLimitError with
   * how long to wait. Any other error (database
   * down, bad id) propagates as itself; meter()
   * decides what to do with it.
   */
  async function take(
    tenantId: string,
    provider: UsageProvider,
    cost = 1
  ): Promise<void> {
    if (await tryTake(tenantId, provider, cost)) {
      return;
    }

    throw new RateLimitError(
      provider,
      tenantId,
      await secondsUntilAvailable(
        tenantId,
        provider,
        cost
      )
    );
  }

  return { take, tryTake, secondsUntilAvailable };
}

export type RateLimiter = ReturnType<
  typeof createRateLimiter
>;
