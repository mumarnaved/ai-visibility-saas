-- Usage metering: one row per external provider call (Firecrawl, SerpApi,
-- OpenRouter). units is in the provider's own billing unit (credits, searches,
-- tokens); cost_estimate is units priced from the rates config, in USD, and is
-- an estimate, not an invoice. Failed calls are recorded too (success = FALSE,
-- units/cost 0) so error rates are visible. job_id is set when the call ran
-- inside a queued job.
CREATE TABLE IF NOT EXISTS platform.usage_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    tenant_id UUID NOT NULL,

    provider TEXT NOT NULL,

    operation TEXT NOT NULL,

    units NUMERIC NOT NULL DEFAULT 0
        CHECK (units >= 0),

    cost_estimate NUMERIC NOT NULL DEFAULT 0
        CHECK (cost_estimate >= 0),

    job_id UUID,

    success BOOLEAN NOT NULL DEFAULT TRUE,

    error TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_usage_events_tenant
        FOREIGN KEY (tenant_id)
        REFERENCES platform.tenants(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_usage_events_job
        FOREIGN KEY (job_id)
        REFERENCES platform.jobs(id)
        ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_usage_events_tenant_created
    ON platform.usage_events(tenant_id, created_at);
