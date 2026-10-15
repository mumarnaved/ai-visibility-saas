# AI Visibility SaaS: Completion Plan

Source of truth: `ai-visibility-saas-spec_1.pdf`. This plan covers what is still missing or mocked, in build order.
Rule for every phase: finish it, run it, verify the acceptance checks, then move on. Do not start the next phase with the current one half done.

Repo facts (verified): pnpm monorepo. `apps/worker` (Express 5, TS, ESM), `apps/web` (Next.js), `packages/agent-contracts`, SQL in `database/platform` and `database/tenant-template`. Auth is custom (bcrypt + sessions), LLM is OpenRouter, crawling is Firecrawl, competitor data is SerpApi.

Hosting and decisions made: the worker is hosted on Vercel (Railway is no longer used). Storage is Supabase Storage (decision 5 below is resolved).

Status: Phase 0 DONE. Phase 1 steps 1, 2, 3 and 5 DONE. Steps 4, 6 and 7 are open.

---

## Phase 0: Security fix (do first, before anything else) — DONE

**Problem:** `/api/tenants/:tenantId/*` routes in `apps/worker/src/api/server.ts` require login (`requireAuth`) but never check that the user owns the tenant. `resolveTenantSchema()` looks up the schema by ID only.

**Do:**
1. Add `requireTenantAccess` middleware: load `req.auth.user.id`, check `platform.workspace_members` joined to `platform.workspaces.tenant_id = :tenantId`. Return 404 (not 403) if no membership.
2. Mount it on every `/api/tenants/:tenantId/*` route (not on `GET /api/tenants`, `POST /api/tenants`, or `/api/oauth/google/callback`).
3. Also verify the Google OAuth callback ties the `state` to the user and tenant (see `lib/google-oauth-state.ts`).
4. Make `requirePaidFeatureAccess` run after it.

**Accept:** two test accounts; account B calling any tenant route of account A gets 404. Add an automated test for this.

---

## Phase 1: Foundation (spec §6, §7.12, §10, §15, §18)

1. **[DONE] Versioned migration runner.** Add `schema_migrations(version, applied_at)` inside each tenant schema. Replace the naive `split(";")` in `tenant-schema-provisioner.ts` with proper execution of each file as one transaction (use `pool.query(fileContents)`). Write `migrate-all-tenants` that loops all active tenants and applies only unapplied versions. Same idea for `platform` migrations.
2. **[DONE] `tenant_manifest.json`.** On provisioning, write the manifest (schema, storage prefix, vault namespace, vector namespace) to the tenant's storage prefix and return it from the Provisioning Agent. Make `Provisioning Agent` own the full Stage 0: schema, storage prefix, vault entry, vector namespace, manifest, then trigger the first audit.
3. **[DONE] Durable storage.** Implemented as `SupabaseStorageAdapter` behind `StorageAdapter`, selected with `STORAGE_BACKEND=supabase`; smoke-tested against the real bucket. The local filesystem adapter will not survive Vercel restarts. Keep the `..` path-escape guard. Fix teardown so it uses the same prefix function as writes (single `buildTenantContext` helper, currently duplicated in `server.ts`, `automatic-scan.ts`).
4. **One `buildTenantContext`.** Move it into `packages/agent-contracts` or `context/`, delete the copies. Make the Orchestrator the only way routes run agents (routes currently call pipelines directly). Orchestrator must: inject context, record each run (tenant, agent, status, duration, error), retry with backoff, and reject payloads whose tenantId differs from the context.
5. **[DONE] Postgres-backed job queue.** `platform.jobs` (migration 010), claimed with `FOR UPDATE SKIP LOCKED`, exponential-backoff retries, stuck-job requeue. Stage 1 to 4 routes enqueue and return 202 with a job id; the web app polls `GET /api/tenants/:tenantId/jobs/:jobId`. Deviation from the original plan: there is no Railway worker loop (Railway is no longer used). Jobs are drained by the `CRON_SECRET`-protected `POST /api/jobs/run` (fails closed when the secret is unset, 250s budget), which is triggered by the worker itself (kick via `waitUntil` after enqueue) and by a Supabase `pg_cron` job every minute as a safety net (SQL is run manually, not a migration).
6. **Usage metering** (`usage/` is empty). Table `platform.usage_events(tenant_id, provider, units, cost_estimate, created_at)`. Wrap every Firecrawl, SerpApi, OpenRouter, DataForSEO call in a `meter()` helper. Add a per-tenant usage endpoint and show it on the settings page.
7. **Per-tenant rate limiting** at the platform level for shared APIs (token bucket per tenant per provider), so one tenant cannot exhaust a shared quota.

**Accept:** provision a tenant, see manifest + versioned migrations; add a new tenant migration and roll it to all tenants; run a Stage 1 audit through the queue; usage rows appear.

---

## Phase 2: Integrations (spec §8)

1. **WordPress adapter.** Implement `CmsAdapter` for the WordPress REST API (application passwords stored in the vault per tenant). Replace `MockCmsAdapter` as the default when a CMS credential exists; keep the mock only for tests. Publishing agent should record the real destination and URL in `publish_logs`.
2. **GTM.** Add the Tag Manager OAuth scopes (read + edit containers), connect/disconnect routes, and the client used by Technical Fix (deploy JSON-LD/tags) and Monitoring (tag health).
3. **DataForSEO client** (platform-level key, metered): keyword data, SERP / AI Overview capture, rank tracking, competitor data, on-page. Wire into Content Audit, Citation Audit, Competitor Benchmark, Content Plan, Monitoring.
4. **GSC in the Technical Crawl:** indexing/coverage and Core Web Vitals (Search Console data plus the PageSpeed Insights API as a fallback).
5. **Screaming Frog and Ubersuggest:** see Decisions below before building.

**Accept:** each client has a smoke test against a real key; agents use them, and usage is metered.

---

## Phase 3: Agent completeness (spec §7)

1. **Technical Crawl:** orphan pages, duplicate meta, redirect chains, sitemap regeneration flags, Core Web Vitals flags in `technical_audit`.
2. **Citation Audit:** run prompts across several answer engines (ChatGPT, Perplexity, Gemini via their APIs or OpenRouter models), plus DataForSEO AI Overview capture. Flag zero-citation topics as top opportunities. Strip any tenant PII from prompts (§16).
3. **Content Plan:** weight fixes by GSC impact, add the 30/60/90-day roadmap if not present, use DataForSEO keyword data.
4. **Content Production:** per-tenant brand-voice settings, grade-5 readability check, heading rules, meta title/description, FAQ section; ideally via the Anthropic SDK (spec §10), or document the OpenRouter choice.
5. **Technical Fix:** JSON-LD generator, `llms.txt` generator, and real application through the WordPress/GTM adapters; keep a change log.
6. **Monitoring:** keep "ranking up, traffic flat" logic; add GTM tag health and DataForSEO rank tracking; when Google is not connected, label the data clearly as synthetic in the UI (never present mock numbers as real).
7. **Report Generation:** branded PDF (tenant name/logo), email delivery, and a dashboard copy. Schedule per plan (weekly Scale, monthly Growth) via tenant-tagged cron jobs through the queue.
8. **Per-tenant approval settings:** a `tenant_settings` row with `auto_approve_low_risk_fixes` (default off). The publish gate remains mandatory unless this is on.

**Accept:** a full run from signup to a published (to a test WordPress site) approved post, a monitoring snapshot, and an emailed PDF report.

---

## Phase 4: Plans, enterprise, white-label (spec §16, §17)

1. **Cadence by plan:** Growth monthly, Scale weekly, enforced by the scheduler.
2. **Cross-tenant admin path:** separate admin routes + role, every access written to a platform `admin_access_log`. Agents must never use this path.
3. **Dedicated DB tier:** add `database_url` (encrypted) to `platform.tenants`; connection resolver returns the pinned pool for enterprise tenants.
4. **White-label/reseller:** partner accounts, multi-client dashboard, branded reports and domain.
5. **Free tier:** confirm Stage 1 only, one site; Scale site limit matches the spec (the code uses 5 where the spec says "N").
6. Deferred from Phase 0: make the Google OAuth callback bind to the logged-in session by having the web app catch Google's redirect and relay code+state to the worker with the Bearer token (needs a redirect-URI change in Google Cloud and a new web page).

---

## Phase 5: Hardening

- Tests: tenant isolation, approval gates (cannot publish unapproved), migration runner, vault encrypt/decrypt, billing webhooks.
- Verify `.env` files stay git-ignored (`apps/worker/.env` exists; `.gitignore` covers `.env`, so confirm none was ever committed and rotate keys if it was).
- Delete repo clutter: `trace-resolution.txt` (1.2 MB), `server-current.txt`, `page.backup.tsx`, `*.backup.sql`, `ai-visibility-saas-clean.zip`, the stray zero-byte files at the repo root.
- Split `server.ts` (3,000+ lines) into route modules.
- Resolve the spec's §18 open questions in writing.

---

## Decisions needed from the owner

1. **Screaming Frog** needs a desktop licence and CLI, which is awkward on serverless. Keep it (run on a Railway worker), or replace it with the existing Firecrawl + custom crawler and update the spec?
2. **Ubersuggest** has no stable public API. Drop it (DataForSEO covers it) or keep a scraper-based option?
3. **SerpApi / OpenRouter vs. DataForSEO / Anthropic SDK:** keep the current providers, or move to the spec's?
4. **Auth:** keep the custom auth, or migrate to Supabase Auth as the spec says?
5. ~~**Storage backend:** S3 or Supabase Storage?~~ RESOLVED: Supabase Storage.
6. **Email provider** for reports (Resend, SES, etc.)?
7. **N** for the Scale tier website limit.
