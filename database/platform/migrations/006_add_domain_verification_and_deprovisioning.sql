ALTER TABLE platform.tenants
    ADD COLUMN IF NOT EXISTS verification_token TEXT,
    ADD COLUMN IF NOT EXISTS domain_verified_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deprovision_at TIMESTAMPTZ;

ALTER TABLE platform.tenants
    DROP CONSTRAINT IF EXISTS tenants_status_check;

ALTER TABLE platform.tenants
    ADD CONSTRAINT tenants_status_check
    CHECK (status IN (
        'provisioning',
        'active',
        'suspended',
        'failed',
        'deprovisioning',
        'deprovisioned'
    ));
