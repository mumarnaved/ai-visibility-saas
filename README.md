# AI Visibility SaaS

A multi-tenant SaaS platform that audits and improves how businesses show up in AI-driven
search/answer engines (e.g. citations, entity recognition, competitor comparisons). It's a
pnpm monorepo with a Next.js web app, a Node/Express worker service that runs a pipeline of
audit "agents," and Postgres-based multi-tenant storage.

## Layout

```
apps/
  web/      Next.js 16 frontend (dashboard: agents, ai-visibility, content-plan,
            integrations, onboarding, queries, reports, settings, login/signup)
  worker/   Express API + background worker that runs the audit agent pipeline

packages/
  agent-contracts/  Shared TypeScript types/contracts (agent I/O, tenant context)
  config/           Shared config (currently empty/placeholder)
  shared/           Shared utilities (currently empty/placeholder)

database/
  platform/         SQL migrations for the shared/platform schema (tenants, auth,
                     credential vault, vector extension, domain verification)
  tenant-template/  SQL migrations for the per-tenant schema template

infrastructure/    Placeholders for cron, deployment, docker, and secrets configs
docs/               Placeholders for agents/api/architecture/integrations/security docs
scripts/            One-off DB scripts (e.g. drop-legacy-agent-tables.sql)
```

## How it works

- **apps/worker** is the core: it registers "agents" (Provisioning, Technical Audit,
  Content Entity Audit, Citation Visibility Audit, Competitor Benchmark, Audit
  Aggregator) with an `Orchestrator` (`src/orchestrator/orchestrator.ts`) and executes
  them against a tenant context. It also exposes an Express API (`src/api/server.ts`),
  handles auth/sessions, a credential vault, tenant-scoped storage, usage tracking, and
  a deprovisioning scheduler.
- **apps/web** is the tenant-facing dashboard for viewing audit results, content plans,
  integrations, and account/report settings.
- **packages/agent-contracts** defines the shared TypeScript contracts (agent input/output
  shapes, tenant context validation) used by both the worker's agents and orchestrator.
- **database/** holds raw SQL migrations for a platform (shared) schema and a per-tenant
  schema template, implying a schema-per-tenant multi-tenancy model.

## Getting started

```bash
pnpm install
pnpm --filter worker dev   # runs apps/worker (tsx src/api/server.ts)
pnpm --filter web dev      # runs apps/web (next dev)
```

Note: `infrastructure/`, `docs/`, and `packages/config` & `packages/shared` are currently
empty scaffolding — not yet populated.
