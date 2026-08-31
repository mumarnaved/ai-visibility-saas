# AI Visibility SaaS

A multi-tenant SaaS platform that audits how businesses show up in AI-driven search and
answer engines — citations, entity recognition, competitor comparisons — then turns those
findings into a content plan, executes approved fixes, and monitors real traffic and
rankings over time.

**Live demo:** [ai-visibility-saas-web.vercel.app](https://ai-visibility-saas-web.vercel.app)

## Why this exists

A complete, end-to-end SaaS build meant to showcase full-stack product engineering and
multi-agent AI architecture together: real multi-tenant data isolation, a real billing
system, real third-party integrations (not mocked demos), and an agent pipeline that goes
from audit to shipped content with a human approval gate in between.

## What it does

The core product is a four-stage pipeline, run per tenant:

1. **Audit** — technical SEO, content/entity quality, AI-citation visibility, and
   competitor benchmarking agents run in parallel and roll up into one aggregated score.
2. **Content Plan** — turns audit findings into a prioritized content/fix plan, which the
   tenant reviews and approves before anything is produced.
3. **Execution** — produces content drafts and applies technical fixes for the approved
   plan items; each task still requires explicit approval before it's marked published.
4. **Monitoring & Reporting** — tracks real Search Console/GA4 traffic and keyword
   rankings against the audit baseline over time, and generates period reports.

Other key features:

- **Real integrations, not mocks** — Google Search Console & GA4 (OAuth), Firecrawl for
  JS-rendered page crawling, SerpApi for competitor signal estimation, OpenRouter for the
  underlying LLM calls (with automatic retry and a fallback model for free-tier
  reliability).
- **Stripe billing with real plan tiers** — Free Audit (no card required), Growth, and
  Scale as self-serve Stripe Checkout subscriptions with webhook-driven sync; Enterprise
  and White-Label are contact-us tiers, deliberately outside automated checkout.
- **Feature and usage gating by plan** — e.g. the free tier is audit-only, and website
  count is capped per plan, enforced server-side at the point a tenant tries to exceed it.

## Architecture note: tenant isolation

Each tenant gets its own **Postgres schema**, not a shared set of tables with a
`tenant_id` column. A platform-level schema holds cross-tenant concerns (accounts,
billing, auth), while every tenant's audits, content plans, execution tasks, and
monitoring history live in their own schema, provisioned and torn down per tenant. This
trades a bit of operational complexity (per-tenant migrations, connection pooling
tuned for it) for genuine data isolation and the option to scale or move a single
tenant independently later.

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, Tailwind CSS 4 |
| Backend | Express 5 on Node.js, TypeScript throughout (ESM) |
| Database | PostgreSQL — schema-per-tenant |
| AI | OpenRouter (LLM calls), Firecrawl (crawling), SerpApi (competitor signals) |
| Integrations | Google OAuth (Search Console + GA4), Stripe (billing) |
| Deployment | Vercel (frontend), Railway (API worker) |
| Tooling | pnpm workspaces (monorepo), Zod validation |

## Repo layout

```
apps/
  web/      Next.js dashboard - audits, content plan, execution, monitoring,
            reports, billing/settings, onboarding, auth
  worker/   Express API + the audit/content/monitoring agent pipeline

packages/
  agent-contracts/  Shared TypeScript contracts for agent input/output and
                     tenant context, used by every agent and the orchestrator

database/
  platform/         Migrations for the shared platform schema (tenants, auth,
                     billing, credential vault)
  tenant-template/  Migrations for the per-tenant schema template
```

## Local development

```bash
pnpm install
pnpm --filter worker dev   # Express API on :4000
pnpm --filter web dev      # Next.js dashboard on :3000
```

Each app reads its own `.env` (worker) / `.env.local` (web) for API keys and connection
strings — see `apps/worker/src` and `apps/web/src` for the specific environment
variables each integration expects. None of these are committed to the repo.
