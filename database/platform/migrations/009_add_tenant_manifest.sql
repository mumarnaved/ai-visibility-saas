-- The tenant's isolated-system map (schema, storage prefix, credential
-- namespace, vector namespace). Source of truth for the manifest; a copy is
-- also written to tenant_manifest.json under the tenant's storage prefix.
-- NULL until provisioning (or the backfill) writes it.
ALTER TABLE platform.tenants
    ADD COLUMN IF NOT EXISTS manifest JSONB;
