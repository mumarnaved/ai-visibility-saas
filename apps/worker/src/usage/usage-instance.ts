import { createMeter } from "./meter.js";
import { createRateLimiter } from "./rate-limiter.js";
import { createUsageRepository } from "./usage-repository.js";

/* ========================================
   REAL INSTANCES

   Bound to the shared pool, but the pool is
   imported on first use, not at module load.
   The provider clients import this file, and
   connection.js throws when DATABASE_URL is
   missing, which must not happen just because a
   script or test imported a client. The adapter
   also calls pool.query at call time, so a test
   that swaps pool.query is honoured.
======================================== */

const db = {
  async query(sql: string, params?: unknown[]) {
    const { pool } = await import(
      "../database/postgres/connection.js"
    );

    return pool.query(sql, params);
  },
};

export const usageRepository = createUsageRepository(db);

export const rateLimiter = createRateLimiter(db);

export const { meter } = createMeter({
  recorder: usageRepository,
  limiter: rateLimiter,
});
