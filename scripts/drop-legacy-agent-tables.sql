-- Drops the retired website-analysis / ai-visibility agent tables
-- from every tenant schema.
--
-- These tables were created ad hoc by application code
-- (ensureWebsiteAnalysisTable / ensureAIVisibilityTables) the first
-- time each agent ran for a tenant, so they are NOT part of the
-- static tenant-template migrations and will not be dropped by
-- re-running migrations. Run this manually once you've confirmed
-- the retired agents/routes are no longer in use.
--
-- Safe to run more than once (IF EXISTS on every statement).
--
-- Usage:
--   psql "$DATABASE_URL" -f scripts/drop-legacy-agent-tables.sql

DO $$
DECLARE
  tenant_schema TEXT;
BEGIN
  FOR tenant_schema IN
    SELECT schema_name
    FROM information_schema.schemata
    WHERE schema_name LIKE 'tenant_%'
  LOOP
    EXECUTE format(
      'DROP TABLE IF EXISTS %I.ai_visibility_results CASCADE',
      tenant_schema
    );

    EXECUTE format(
      'DROP TABLE IF EXISTS %I.ai_visibility_queries CASCADE',
      tenant_schema
    );

    EXECUTE format(
      'DROP TABLE IF EXISTS %I.website_analyses CASCADE',
      tenant_schema
    );

    RAISE NOTICE 'Dropped legacy agent tables in schema: %', tenant_schema;
  END LOOP;
END $$;
