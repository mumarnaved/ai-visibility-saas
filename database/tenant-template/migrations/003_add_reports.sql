/* ========================================
   STAGE 4 — REPORT GENERATION
======================================== */

CREATE TABLE IF NOT EXISTS reports (
    id UUID PRIMARY KEY,
    period_start DATE,
    period_end DATE,
    summary TEXT,
    audit_deltas JSONB NOT NULL DEFAULT '{}'::jsonb,
    plan_progress JSONB NOT NULL DEFAULT '{}'::jsonb,
    traffic_trend JSONB NOT NULL DEFAULT '{}'::jsonb,
    recommendations JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reports_created_at
    ON reports(created_at);
