-- One row per orchestrated agent run: who (tenant), what (agent), how it went
-- (status, attempts, error) and a hash of the input. The input itself is NOT
-- stored, so no prompts, URLs or other request data land here; error text is
-- redacted and truncated before it is written.
--
-- result is a checkpoint: the output of a step that SUCCEEDED inside a queued
-- job. If the job is retried or deferred (rate limit, time budget), the
-- orchestrator returns this instead of running the step again, so Firecrawl /
-- SerpApi / OpenRouter are not paid twice. It is cleared when the job
-- finishes, so it only exists while its job is unfinished.
CREATE TABLE IF NOT EXISTS platform.agent_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    tenant_id UUID NOT NULL,

    job_id UUID,

    agent TEXT NOT NULL,

    status TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN (
            'running',
            'succeeded',
            'failed'
        )),

    attempts INTEGER NOT NULL DEFAULT 1,

    input_hash TEXT NOT NULL,

    error TEXT,

    error_kind TEXT,

    result JSONB,

    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    finished_at TIMESTAMPTZ,

    CONSTRAINT fk_agent_runs_tenant
        FOREIGN KEY (tenant_id)
        REFERENCES platform.tenants(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_agent_runs_job
        FOREIGN KEY (job_id)
        REFERENCES platform.jobs(id)
        ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_tenant_started
    ON platform.agent_runs(tenant_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_runs_job_agent
    ON platform.agent_runs(job_id, agent)
    WHERE job_id IS NOT NULL;
