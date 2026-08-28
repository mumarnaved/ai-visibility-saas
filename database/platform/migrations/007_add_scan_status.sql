ALTER TABLE platform.tenants
    ADD COLUMN IF NOT EXISTS scan_status TEXT NOT NULL DEFAULT 'not_started',
    ADD COLUMN IF NOT EXISTS scan_error TEXT;

ALTER TABLE platform.tenants
    DROP CONSTRAINT IF EXISTS tenants_scan_status_check;

ALTER TABLE platform.tenants
    ADD CONSTRAINT tenants_scan_status_check
    CHECK (scan_status IN (
        'not_started',
        'auditing',
        'planning',
        'ready',
        'failed'
    ));
