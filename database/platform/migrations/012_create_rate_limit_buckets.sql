-- Per-tenant, per-provider token buckets. Kept in Postgres (not memory)
-- because every serverless invocation is a separate process. One row per
-- (tenant, provider); a call takes a token in a single atomic upsert, and
-- tokens refill continuously from updated_at (see usage/rate-limiter.ts).
CREATE TABLE IF NOT EXISTS platform.rate_limit_buckets (
    tenant_id UUID NOT NULL,

    provider TEXT NOT NULL,

    tokens DOUBLE PRECISION NOT NULL,

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (tenant_id, provider),

    CONSTRAINT fk_rate_limit_buckets_tenant
        FOREIGN KEY (tenant_id)
        REFERENCES platform.tenants(id)
        ON DELETE CASCADE
);
