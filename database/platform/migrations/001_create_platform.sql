CREATE SCHEMA IF NOT EXISTS platform;

CREATE TABLE IF NOT EXISTS platform.tenants (
    id UUID PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    schema_name TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'provisioning'
        CHECK (status IN (
            'provisioning',
            'active',
            'suspended',
            'failed',
            'deprovisioning'
        )),
    plan TEXT NOT NULL DEFAULT 'starter',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_tenants_status
    ON platform.tenants(status);

CREATE INDEX IF NOT EXISTS idx_platform_tenants_schema_name
    ON platform.tenants(schema_name);