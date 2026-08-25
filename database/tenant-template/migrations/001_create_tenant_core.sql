CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY,
    email TEXT NOT NULL,
    full_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workspaces (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY,
    actor_id UUID,
    action TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
    ON audit_logs(created_at);

/* ========================================
   STAGE 1 — TECHNICAL AUDIT
======================================== */

CREATE TABLE IF NOT EXISTS technical_audits (
    id UUID PRIMARY KEY,
    website_url TEXT NOT NULL,
    final_url TEXT,
    status TEXT NOT NULL DEFAULT 'completed',
    score NUMERIC(5,2),
    summary TEXT,
    findings JSONB NOT NULL DEFAULT '[]'::jsonb,
    crawl_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    seo_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_technical_audits_created_at
    ON technical_audits(created_at);

/* ========================================
   STAGE 1 — CONTENT & ENTITY AUDIT
======================================== */

CREATE TABLE IF NOT EXISTS content_entity_audits (
    id UUID PRIMARY KEY,
    website_url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'completed',
    score NUMERIC(5,2),
    summary TEXT,
    content_findings JSONB NOT NULL DEFAULT '[]'::jsonb,
    entity_findings JSONB NOT NULL DEFAULT '[]'::jsonb,
    recommendations JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_content_entity_audits_created_at
    ON content_entity_audits(created_at);

/* ========================================
   STAGE 1 — CITATION / VISIBILITY AUDIT
======================================== */

CREATE TABLE IF NOT EXISTS citation_audits (
    id UUID PRIMARY KEY,
    website_url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'completed',
    score NUMERIC(5,2),
    summary TEXT,
    queries JSONB NOT NULL DEFAULT '[]'::jsonb,
    citations JSONB NOT NULL DEFAULT '[]'::jsonb,
    visibility_findings JSONB NOT NULL DEFAULT '[]'::jsonb,
    recommendations JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_citation_audits_created_at
    ON citation_audits(created_at);

/* ========================================
   STAGE 1 — COMPETITOR BENCHMARK
======================================== */

CREATE TABLE IF NOT EXISTS competitor_benchmarks (
    id UUID PRIMARY KEY,
    website_url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'completed',
    score NUMERIC(5,2),
    summary TEXT,
    competitors JSONB NOT NULL DEFAULT '[]'::jsonb,
    comparison JSONB NOT NULL DEFAULT '[]'::jsonb,
    gaps JSONB NOT NULL DEFAULT '[]'::jsonb,
    recommendations JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_competitor_benchmarks_created_at
    ON competitor_benchmarks(created_at);

/* ========================================
   STAGE 1 — UNIFIED AUDIT REPORT
======================================== */

CREATE TABLE IF NOT EXISTS audit_reports (
    id UUID PRIMARY KEY,
    website_url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'completed',

    overall_score NUMERIC(5,2),

    technical_seo_score NUMERIC(5,2),
    content_quality_score NUMERIC(5,2),
    aio_readiness_score NUMERIC(5,2),
    geo_citation_score NUMERIC(5,2),
    competitor_gap_score NUMERIC(5,2),

    summary TEXT,

    technical_audit JSONB NOT NULL DEFAULT '{}'::jsonb,
    content_entity_audit JSONB NOT NULL DEFAULT '{}'::jsonb,
    citation_audit JSONB NOT NULL DEFAULT '{}'::jsonb,
    competitor_benchmark JSONB NOT NULL DEFAULT '{}'::jsonb,

    priorities JSONB NOT NULL DEFAULT '[]'::jsonb,
    recommendations JSONB NOT NULL DEFAULT '[]'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_reports_created_at
    ON audit_reports(created_at);

/* ========================================
   STAGE 2 — CONTENT PLAN FOUNDATION
======================================== */

CREATE TABLE IF NOT EXISTS content_plans (
    id UUID PRIMARY KEY,
    audit_report_id UUID,
    status TEXT NOT NULL DEFAULT 'draft',
    summary TEXT,
    content_gaps JSONB NOT NULL DEFAULT '[]'::jsonb,
    entity_plan JSONB NOT NULL DEFAULT '[]'::jsonb,
    technical_plan JSONB NOT NULL DEFAULT '[]'::jsonb,
    roadmap JSONB NOT NULL DEFAULT '{}'::jsonb,
    approval_status TEXT NOT NULL DEFAULT 'pending',
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_content_plans_created_at
    ON content_plans(created_at);

/* ========================================
   STAGE 3 — EXECUTION FOUNDATION
======================================== */

CREATE TABLE IF NOT EXISTS execution_tasks (
    id UUID PRIMARY KEY,
    content_plan_id UUID,
    task_type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    approval_status TEXT NOT NULL DEFAULT 'pending',
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    result JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_execution_tasks_status
    ON execution_tasks(status);

CREATE TABLE IF NOT EXISTS publish_logs (
    id UUID PRIMARY KEY,
    execution_task_id UUID,
    destination TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    approval_status TEXT NOT NULL DEFAULT 'pending',
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    response JSONB NOT NULL DEFAULT '{}'::jsonb,
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_publish_logs_created_at
    ON publish_logs(created_at);

/* ========================================
   STAGE 4 — MONITORING FOUNDATION
======================================== */

CREATE TABLE IF NOT EXISTS monitoring_snapshots (
    id UUID PRIMARY KEY,
    snapshot_date DATE NOT NULL,
    visibility_score NUMERIC(5,2),
    citation_score NUMERIC(5,2),
    technical_score NUMERIC(5,2),
    content_score NUMERIC(5,2),
    competitor_score NUMERIC(5,2),
    metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_monitoring_snapshots_date
    ON monitoring_snapshots(snapshot_date);