CREATE SCHEMA IF NOT EXISTS platform;

CREATE TABLE IF NOT EXISTS platform.credential_vault (
    id UUID PRIMARY KEY,

    tenant_id UUID NOT NULL
        REFERENCES platform.tenants(id),

    provider TEXT NOT NULL,

    encrypted_value TEXT NOT NULL,

    iv TEXT NOT NULL,

    auth_tag TEXT NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    revoked_at TIMESTAMPTZ,

    UNIQUE (tenant_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_credential_vault_tenant_id
    ON platform.credential_vault(tenant_id);
