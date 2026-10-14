-- Postgres-backed job queue. Workers claim rows with FOR UPDATE SKIP LOCKED,
-- so any number of serverless invocations can drain it safely. status moves
-- queued -> running -> succeeded | failed; a failed attempt with attempts left
-- goes back to queued with a later run_at (exponential backoff).
CREATE TABLE IF NOT EXISTS platform.jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    tenant_id UUID NOT NULL,

    type TEXT NOT NULL,

    payload JSONB NOT NULL DEFAULT '{}'::jsonb,

    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN (
            'queued',
            'running',
            'succeeded',
            'failed'
        )),

    attempts INTEGER NOT NULL DEFAULT 0,

    max_attempts INTEGER NOT NULL DEFAULT 3,

    run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    locked_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,

    result JSONB,
    error TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_jobs_tenant
        FOREIGN KEY (tenant_id)
        REFERENCES platform.tenants(id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_jobs_status_run_at
    ON platform.jobs(status, run_at);

CREATE INDEX IF NOT EXISTS idx_jobs_tenant_id
    ON platform.jobs(tenant_id, created_at DESC);
