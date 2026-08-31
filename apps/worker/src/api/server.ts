import "dotenv/config";

import express from "express";
import cors from "cors";

import { pool } from "../database/postgres/connection.js";
import { provisionTenant } from "../database/postgres/tenant-provisioning.js";

import {
  requireAuth,
  type AuthenticatedRequest,
} from "../auth/auth-middleware.js";

import {
  Stage1AuditPipeline,
} from "../agents/stage-1-audit-pipeline.js";

import {
  getLatestCitationVisibilityAudit,
  deriveCitationAuditMetrics,
  deriveQueryRecords,
  deriveResultRecords,
} from "../database/postgres/citation-visibility/citation-visibility-audit-repository.js";

import {
  saveContentPlan,
  getLatestContentPlan,
  approveContentPlan,
} from "../database/postgres/content-plan/content-plan-repository.js";

import {
  ContentPlanAgent,
} from "../agents/content-plan/index.js";

import {
  ContentProductionAgent,
} from "../agents/content-production/index.js";

import {
  TechnicalFixAgent,
} from "../agents/technical-fix/index.js";

import {
  PublishingAgent,
} from "../agents/publishing/index.js";

import {
  MonitoringAgent,
} from "../agents/monitoring/index.js";

import {
  ReportGenerationAgent,
} from "../agents/report-generation/index.js";

import {
  getLatestMonitoringSnapshot,
} from "../database/postgres/monitoring/monitoring-snapshots-repository.js";

import {
  getLatestReport,
} from "../database/postgres/reports/reports-repository.js";

import {
  buildGoogleAuthUrl,
  discoverGa4Property,
  discoverSearchConsoleSite,
  exchangeCodeForTokens,
  type GoogleTokenBundle,
} from "../lib/google-oauth-client.js";

import {
  buildOAuthState,
  verifyOAuthState,
} from "../lib/google-oauth-state.js";

import {
  getCredential,
  revokeCredential as revokeVaultCredential,
  storeCredential,
} from "../database/postgres/credential-vault/credential-vault-service.js";

import {
  listExecutionTasks,
  approveExecutionTask,
} from "../database/postgres/execution-tasks/execution-tasks-repository.js";

import {
  getTenantById,
  markDomainVerified,
  setScanStatus,
} from "../database/postgres/tenant-registry.js";

import {
  getBrandNameFromWebsite,
} from "../lib/brand-name.js";

import {
  runAutomaticScan,
} from "../services/automatic-scan.js";

import {
  verifyDnsTxtRecord,
  verifyFileUpload,
} from "../database/postgres/domain-verification/domain-verification-service.js";

import {
  scheduleTenantDeprovisioning,
  runDueDeprovisioning,
} from "../database/postgres/tenant-deprovisioning.js";

import {
  createUniqueTenantSlug,
  createUniqueWorkspaceSlug,
} from "../auth/auth-service.js";

import authRouter from "../auth/routes/auth-routes.js";

import {
  createCheckoutSession,
  verifyStripeWebhookSignature,
} from "../lib/stripe-client.js";

import {
  countTenantsOwnedByUser,
  getEffectivePlanForTenant,
  getEffectivePlanForUser,
} from "../database/postgres/billing/billing-repository.js";

import {
  PLAN_WEBSITE_LIMITS,
  getPriceIdForPlan,
  isSelfServePlanTier,
  planHasPaidFeatureAccess,
} from "../services/billing-service.js";

import {
  handleStripeWebhookEvent,
} from "../services/stripe-webhook-handler.js";

const app: express.Express = express();

const PORT = Number(
  process.env.PORT ??
    process.env.API_PORT ??
    4000
);

/* ========================================
   MIDDLEWARE
======================================== */

app.use(
  cors({
    origin:
      process.env.WEB_APP_URL ??
      "http://localhost:3000",
  })
);

/* ========================================
   STRIPE WEBHOOK

   Registered before express.json() and
   without requireAuth - Stripe calls this
   directly with no session, and signature
   verification needs the raw request body,
   which a JSON-parsing middleware earlier
   in the chain would have already consumed.
======================================== */

app.post(
  "/api/stripe/webhook",
  express.raw({
    type: "application/json",
  }),
  async (req, res) => {
    try {
      const webhookSecret =
        process.env
          .STRIPE_WEBHOOK_SECRET;

      const signatureHeader =
        req.headers[
          "stripe-signature"
        ];

      if (
        !webhookSecret ||
        typeof signatureHeader !==
          "string"
      ) {
        return res
          .status(400)
          .json({
            success: false,
            error:
              "Webhook is not configured or signature is missing.",
          });
      }

      const rawBody =
        Buffer.isBuffer(req.body)
          ? req.body.toString(
              "utf8"
            )
          : "";

      const isValid =
        verifyStripeWebhookSignature(
          rawBody,
          signatureHeader,
          webhookSecret
        );

      if (!isValid) {
        return res
          .status(400)
          .json({
            success: false,
            error:
              "Invalid webhook signature.",
          });
      }

      const event =
        JSON.parse(rawBody);

      await handleStripeWebhookEvent(
        event
      );

      return res.json({
        success: true,
      });
    } catch (error) {
      console.error(
        "Stripe webhook handling failed:",
        error
      );

      return res
        .status(500)
        .json({
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Webhook handling failed.",
        });
    }
  }
);

app.use(express.json());

/* ========================================
   PUBLIC AUTH ROUTES
======================================== */

app.use(
  "/api/auth",
  authRouter
);

/* ========================================
   AUTHENTICATION PROTECTION
======================================== */

/*
 * Authentication is required for all
 * application APIs below.
 *
 * /api/auth/* remains public so users
 * can signup and login.
 */

app.use(
  "/api/tenants",
  requireAuth
);

app.use(
  "/api/citation-audit",
  requireAuth
);

app.use(
  "/api/billing",
  requireAuth
);

/* ========================================
   HELPERS
======================================== */

/* ========================================
   HEALTH
======================================== */

app.get(
  "/health",
  async (_req, res) => {
    try {
      await pool.query(
        "SELECT 1"
      );

      return res.json({
        success: true,
        service: "worker-api",
        database: "connected",
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        service: "worker-api",
        database: "disconnected",
        error:
          error instanceof Error
            ? error.message
            : "Database connection failed.",
      });
    }
  }
);

/* ========================================
   LIST TENANTS

   Returns every tenant the authenticated
   user belongs to (via workspace membership),
   newest first. Powers the tenant switcher -
   /api/tenants/latest only ever returns the
   single most-recently-created one, which is
   wrong whenever a user has more than one
   tenant and wants to keep working in an
   older one.
======================================== */

app.get(
  "/api/tenants",
  async (
    req: AuthenticatedRequest,
    res
  ) => {
    try {
      const userId =
        req.auth?.user.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error:
            "Authentication required.",
        });
      }

      const result =
        await pool.query(
          `
            SELECT
              t.id,
              t.slug,
              t.name,
              t.website_url,
              t.schema_name,
              t.status,
              t.plan,
              t.verification_token,
              t.domain_verified_at,
              t.scan_status,
              t.scan_error,
              t.created_at,
              t.updated_at
            FROM platform.tenants t
            JOIN platform.workspaces w
              ON w.tenant_id = t.id
            JOIN platform.workspace_members wm
              ON wm.workspace_id = w.id
            WHERE wm.user_id = $1
            ORDER BY t.created_at DESC
          `,
          [userId]
        );

      return res.json({
        success: true,
        data: result.rows,
      });
    } catch (error) {
      console.error(
        "Failed to list tenants:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to list tenants.",
      });
    }
  }
);

/* ========================================
   GET LATEST TENANT

   Returns the authenticated user's own
   tenant (via their workspace membership),
   not the globally most-recently-created
   tenant.
======================================== */

app.get(
  "/api/tenants/latest",
  async (
    req: AuthenticatedRequest,
    res
  ) => {
    try {
      const userId =
        req.auth?.user.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error:
            "Authentication required.",
        });
      }

      const result =
        await pool.query(
          `
            SELECT
              t.id,
              t.slug,
              t.name,
              t.website_url,
              t.schema_name,
              t.status,
              t.plan,
              t.verification_token,
              t.domain_verified_at,
              t.scan_status,
              t.scan_error,
              t.created_at,
              t.updated_at
            FROM platform.tenants t
            JOIN platform.workspaces w
              ON w.tenant_id = t.id
            JOIN platform.workspace_members wm
              ON wm.workspace_id = w.id
            WHERE wm.user_id = $1
            ORDER BY t.created_at DESC
            LIMIT 1
          `,
          [userId]
        );

      if (
        result.rows.length === 0
      ) {
        return res.status(404).json({
          success: false,
          error: "No tenant found.",
        });
      }

      return res.json({
        success: true,
        data: result.rows[0],
      });
    } catch (error) {
      console.error(
        "Failed to load latest tenant:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load tenant.",
      });
    }
  }
);

/* ========================================
   CREATE TENANT
======================================== */

app.post(
  "/api/tenants",
  async (
    req: AuthenticatedRequest,
    res
  ) => {
    try {
      const userId =
        req.auth?.user.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error:
            "Authentication required.",
        });
      }

      const {
        tenantName,
        websiteUrl,
      } = req.body;

      if (
        typeof tenantName !==
          "string" ||
        !tenantName.trim()
      ) {
        return res.status(400).json({
          success: false,
          error:
            "tenantName is required.",
        });
      }

      if (
        typeof websiteUrl !==
          "string" ||
        !websiteUrl.trim()
      ) {
        return res.status(400).json({
          success: false,
          error:
            "websiteUrl is required.",
        });
      }

      const website =
        websiteUrl.trim();

      try {
        new URL(website);
      } catch {
        return res.status(400).json({
          success: false,
          error:
            "websiteUrl must be a valid URL.",
        });
      }

      /*
       * Website-count gate: only applies to
       * creating a NEW tenant, never to
       * tenants the user already owns - an
       * account that already exceeds its
       * plan's limit (from before billing
       * existed, or after a downgrade) keeps
       * full access to everything it already
       * has.
       */
      const [
        effectivePlan,
        existingTenantCount,
      ] = await Promise.all([
        getEffectivePlanForUser(userId),
        countTenantsOwnedByUser(userId),
      ]);

      if (
        existingTenantCount >=
        effectivePlan.websiteLimit
      ) {
        return res.status(403).json({
          success: false,
          error: `Your current plan (${effectivePlan.planTier}) allows up to ${effectivePlan.websiteLimit} website(s). Upgrade your plan to add another website.`,
        });
      }

      /*
       * The slug is derived server-side
       * (uniqueness-checked) rather than
       * trusted from the client, the same
       * way signup() already does it -
       * client-supplied slugs have no
       * uniqueness guarantee and platform
       * .tenants.slug is UNIQUE.
       */
      const tenantSlug =
        await createUniqueTenantSlug(
          tenantName.trim()
        );

      const tenant =
        await provisionTenant({
          name:
            tenantName.trim(),
          slug:
            tenantSlug,
          websiteUrl:
            website,
        });

      /*
       * provisionTenant() only creates the
       * tenant + its schema - it has no
       * concept of who owns it. Without a
       * workspace + workspace_members row
       * linking this tenant to the calling
       * user, it would never show up from
       * /api/tenants/latest (which joins
       * through workspace_members). This
       * mirrors what signup() already does
       * for a user's first tenant.
       */
      const workspaceSlug =
        await createUniqueWorkspaceSlug(
          tenantName.trim()
        );

      const workspaceResult =
        await pool.query<{
          id: string;
        }>(
          `
            INSERT INTO platform.workspaces (
              id,
              name,
              slug,
              tenant_id
            )
            VALUES (
              gen_random_uuid(),
              $1,
              $2,
              $3
            )
            RETURNING id
          `,
          [
            tenantName.trim(),
            workspaceSlug,
            tenant.id,
          ]
        );

      const workspaceId =
        workspaceResult.rows[0]?.id;

      if (!workspaceId) {
        throw new Error(
          "Workspace could not be created for the new tenant."
        );
      }

      await pool.query(
        `
          INSERT INTO platform.workspace_members (
            id,
            workspace_id,
            user_id,
            role
          )
          VALUES (
            gen_random_uuid(),
            $1,
            $2,
            'owner'
          )
        `,
        [workspaceId, userId]
      );

      return res.status(201).json({
        success: true,
        data: {
          id: tenant.id,
          slug: tenant.slug,
          name: tenant.name,
          websiteUrl:
            tenant.websiteUrl,
          schemaName:
            tenant.schemaName,
          status:
            tenant.status,
          plan:
            tenant.plan,
          verificationToken:
            tenant.verificationToken,
          domainVerifiedAt:
            tenant.domainVerifiedAt,
        },
        metadata: {
          operation:
            "create-tenant",
        },
      });
    } catch (error) {
      console.error(
        "Tenant creation failed:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Tenant creation failed.",
      });
    }
  }
);

/* ========================================
   BILLING STATUS

   Returns the authenticated user's current
   plan, along with how many websites they
   own vs their plan's limit, for the
   Settings/Billing page.
======================================== */

app.get(
  "/api/billing/status",
  async (
    req: AuthenticatedRequest,
    res
  ) => {
    try {
      const userId =
        req.auth?.user.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error:
            "Authentication required.",
        });
      }

      const [
        effectivePlan,
        tenantCount,
      ] = await Promise.all([
        getEffectivePlanForUser(
          userId
        ),
        countTenantsOwnedByUser(
          userId
        ),
      ]);

      return res.json({
        success: true,
        data: {
          planTier:
            effectivePlan.planTier,
          status:
            effectivePlan.status,
          websiteLimit:
            effectivePlan.websiteLimit ===
            Number.POSITIVE_INFINITY
              ? null
              : effectivePlan.websiteLimit,
          tenantCount,
          currentPeriodEnd:
            effectivePlan.currentPeriodEnd,
        },
      });
    } catch (error) {
      console.error(
        "Failed to load billing status:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load billing status.",
      });
    }
  }
);

/* ========================================
   CREATE CHECKOUT SESSION

   Starts a Stripe Checkout session for the
   Growth or Scale plan. Enterprise and
   White-Label are "Contact us" only and are
   rejected here rather than silently
   accepted.
======================================== */

app.post(
  "/api/billing/checkout",
  async (
    req: AuthenticatedRequest,
    res
  ) => {
    try {
      const userId =
        req.auth?.user.id;

      const userEmail =
        req.auth?.user.email;

      if (!userId || !userEmail) {
        return res.status(401).json({
          success: false,
          error:
            "Authentication required.",
        });
      }

      const { planTier } = req.body;

      if (
        typeof planTier !== "string" ||
        !isSelfServePlanTier(planTier)
      ) {
        return res.status(400).json({
          success: false,
          error:
            "planTier must be 'growth' or 'scale'. Enterprise and White-Label are handled by contacting sales, not automated checkout.",
        });
      }

      const priceId =
        getPriceIdForPlan(planTier);

      const webAppUrl =
        process.env.WEB_APP_URL ??
        "http://localhost:3000";

      const session =
        await createCheckoutSession({
          priceId,
          customerEmail: userEmail,
          clientReferenceId: userId,

          successUrl: `${webAppUrl}/settings?checkout=success`,

          cancelUrl: `${webAppUrl}/settings?checkout=canceled`,

          metadata: {
            userId,
            planTier,
          },
        });

      if (!session.url) {
        return res.status(502).json({
          success: false,
          error:
            "Stripe did not return a checkout URL.",
        });
      }

      return res.json({
        success: true,
        data: { url: session.url },
      });
    } catch (error) {
      console.error(
        "Failed to create checkout session:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to create checkout session.",
      });
    }
  }
);

/* ========================================
   GET CITATION AUDIT METRICS

   Replaces the old /api/ai-visibility/metrics
   endpoint. Derives the same metrics shape
   from the latest Stage 1 citation_audits row
   instead of the retired ai_visibility_queries
   / ai_visibility_results tables.
======================================== */

app.get(
  "/api/citation-audit/metrics",
  async (req, res) => {
    try {
      const tenantId =
        req.query.tenantId;

      if (
        typeof tenantId !==
          "string" ||
        !tenantId.trim()
      ) {
        return res.status(400).json({
          success: false,
          error:
            "tenantId is required.",
        });
      }

      const schemaResult =
        await pool.query(
          `
            SELECT
              schema_name
            FROM platform.tenants
            WHERE id = $1
            LIMIT 1
          `,
          [tenantId.trim()]
        );

      if (
        schemaResult.rows.length ===
        0
      ) {
        return res.status(404).json({
          success: false,
          error:
            "Tenant not found.",
        });
      }

      const schemaName =
        schemaResult.rows[0]
          .schema_name;

      const latestAudit =
        await getLatestCitationVisibilityAudit(
          schemaName
        );

      const metrics =
        deriveCitationAuditMetrics(
          latestAudit
        );

      return res.json({
        success: true,
        data: metrics,
        metadata: {
          operation:
            "get-citation-audit-metrics",
        },
      });
    } catch (error) {
      console.error(
        "Failed to load citation audit metrics:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load citation audit metrics.",
      });
    }
  }
);

/* ========================================
   GET CITATION AUDIT QUERIES

   Replaces the old
   /api/ai-visibility/queries endpoint.
======================================== */

app.get(
  "/api/citation-audit/queries",
  async (req, res) => {
    try {
      const tenantId =
        req.query.tenantId;

      if (
        typeof tenantId !==
          "string" ||
        !tenantId.trim()
      ) {
        return res.status(400).json({
          success: false,
          error:
            "tenantId is required.",
        });
      }

      const schemaResult =
        await pool.query(
          `
            SELECT
              schema_name
            FROM platform.tenants
            WHERE id = $1
            LIMIT 1
          `,
          [tenantId.trim()]
        );

      if (
        schemaResult.rows.length ===
        0
      ) {
        return res.status(404).json({
          success: false,
          error:
            "Tenant not found.",
        });
      }

      const schemaName =
        schemaResult.rows[0]
          .schema_name;

      const latestAudit =
        await getLatestCitationVisibilityAudit(
          schemaName
        );

      const queries =
        deriveQueryRecords(
          latestAudit
        );

      return res.json({
        success: true,
        data: queries,
        metadata: {
          operation:
            "get-citation-audit-queries",
        },
      });
    } catch (error) {
      console.error(
        "Failed to load citation audit queries:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load citation audit queries.",
      });
    }
  }
);

/* ========================================
   GET LATEST CITATION AUDIT RESULTS

   Replaces the old /api/ai-visibility/latest
   endpoint.
======================================== */

app.get(
  "/api/citation-audit/latest",
  async (req, res) => {
    try {
      const tenantId =
        req.query.tenantId;

      if (
        typeof tenantId !==
          "string" ||
        !tenantId.trim()
      ) {
        return res.status(400).json({
          success: false,
          error:
            "tenantId is required.",
        });
      }

      const schemaResult =
        await pool.query(
          `
            SELECT
              schema_name
            FROM platform.tenants
            WHERE id = $1
            LIMIT 1
          `,
          [tenantId.trim()]
        );

      if (
        schemaResult.rows.length ===
        0
      ) {
        return res.status(404).json({
          success: false,
          error:
            "Tenant not found.",
        });
      }

      const schemaName =
        schemaResult.rows[0]
          .schema_name;

      const latestAudit =
        await getLatestCitationVisibilityAudit(
          schemaName
        );

      const results =
        deriveResultRecords(
          latestAudit
        );

      return res.json({
        success: true,
        data: results,
        metadata: {
          operation:
            "get-latest-citation-audit-results",
        },
      });
    } catch (error) {
      console.error(
        "Failed to load citation audit results:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load citation audit results.",
      });
    }
  }
);

/* ========================================
   RUN STAGE 1 AUDIT
======================================== */

app.post(
  "/api/tenants/:tenantId/stage1-audit",
  async (req, res) => {
    try {
      const tenantId =
        req.params.tenantId;

      if (
        typeof tenantId !== "string" ||
        !tenantId.trim()
      ) {
        return res.status(400).json({
          success: false,
          error:
            "tenantId is required.",
        });
      }

      const {
        websiteUrl,
        brandName,
        queries,
        competitors,
      } = req.body ?? {};

      if (
        typeof websiteUrl !== "string" ||
        !websiteUrl.trim()
      ) {
        return res.status(400).json({
          success: false,
          error:
            "websiteUrl is required.",
        });
      }

      if (
        !Array.isArray(queries) ||
        queries.length === 0
      ) {
        return res.status(400).json({
          success: false,
          error:
            "At least one AI visibility query is required.",
        });
      }

      /*
       * Competitors are optional - not every
       * workspace knows its competitors up
       * front, and Stage1AuditPipeline skips
       * competitor benchmarking gracefully
       * when none are supplied.
       */
      const competitorList: Array<{
        name: string;
        websiteUrl?: string;
      }> = Array.isArray(competitors)
        ? competitors
        : [];

      /*
       * Look up the tenant's schema the same way
       * the existing /api/ai-visibility/metrics
       * route already does in this file.
       */
      const schemaResult =
        await pool.query(
          `
            SELECT
              schema_name,
              domain_verified_at
            FROM platform.tenants
            WHERE id = $1
            LIMIT 1
          `,
          [tenantId.trim()]
        );

      if (schemaResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: "Tenant not found.",
        });
      }

      const schemaName =
        schemaResult.rows[0].schema_name;

      if (
        !schemaResult.rows[0]
          .domain_verified_at
      ) {
        return res.status(403).json({
          success: false,
          error:
            "Domain must be verified before running an audit.",
        });
      }

      const resolvedBrandName =
        typeof brandName === "string" &&
        brandName.trim()
          ? brandName.trim()
          : getBrandNameFromWebsite(
              websiteUrl.trim()
            );

      /*
       * storagePrefix / credentialNamespace /
       * vectorNamespace are placeholders until
       * Stage 0's storage bucket, credential
       * vault, and vector namespace pieces are
       * actually built (flagged as missing in
       * the audit). They're deterministic so the
       * same tenant always gets the same values.
       */
      const tenantContext = {
        tenantId: tenantId.trim(),
        schema: schemaName,
        storagePrefix: `tenant-${tenantId.trim()}`,
        credentialNamespace: `credentials/tenant-${tenantId.trim()}`,
        vectorNamespace: `vector-tenant-${tenantId.trim()}`,
      };

      const pipeline =
        new Stage1AuditPipeline();

      const result =
        await pipeline.execute({
          tenantContext,
          websiteUrl: websiteUrl.trim(),
          brandName: resolvedBrandName,
          queries,
          competitors:
            competitorList,
        });

      return res.status(201).json({
        success: true,
        data: result,
        metadata: {
          operation: "stage1-audit",
        },
      });
    } catch (error) {
      console.error(
        "Stage 1 audit failed:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Stage 1 audit failed.",
      });
    }
  }
);

/* ========================================
   GENERATE + SAVE STAGE 2 CONTENT PLAN

   Runs ContentPlanAgent against the
   tenant's latest Stage 1 audit_reports row
   and persists its output. Column mapping
   (content_plans has 4 JSONB columns, the
   agent produces 4 artifacts):

     technical_plan -> prioritizedFixList
     content_gaps   -> contentGapMap
     entity_plan    -> entitySchemaPlan
     roadmap        -> roadmap
======================================== */

app.post(
  "/api/tenants/:tenantId/stage2-plan",
  requirePaidFeatureAccess,
  async (req, res) => {
    try {
      const tenantId =
        req.params.tenantId;

      if (
        typeof tenantId !== "string" ||
        !tenantId.trim()
      ) {
        return res.status(400).json({
          success: false,
          error:
            "tenantId is required.",
        });
      }

      const schemaResult =
        await pool.query(
          `
            SELECT
              schema_name
            FROM platform.tenants
            WHERE id = $1
            LIMIT 1
          `,
          [tenantId.trim()]
        );

      if (
        schemaResult.rows.length === 0
      ) {
        return res.status(404).json({
          success: false,
          error:
            "Tenant not found.",
        });
      }

      const schemaName =
        schemaResult.rows[0]
          .schema_name;

      const tenantContext = {
        tenantId: tenantId.trim(),
        schema: schemaName,
        storagePrefix: `tenant-${tenantId.trim()}`,
        credentialNamespace: `credentials/tenant-${tenantId.trim()}`,
        vectorNamespace: `vector-tenant-${tenantId.trim()}`,
      };

      const agent = new ContentPlanAgent();

      const agentOutput =
        await agent.execute({
          tenantContext,
          payload: {
            tenantId: tenantId.trim(),
          },
        });

      if (
        !agentOutput.success ||
        !agentOutput.data
      ) {
        return res.status(422).json({
          success: false,
          error:
            agentOutput.error ||
            "Content plan generation failed.",
        });
      }

      const generated = agentOutput.data;

      const saved =
        await saveContentPlan(
          schemaName,
          {
            auditReportId:
              generated.auditReportId,

            summary: generated.summary,

            contentGaps:
              generated.contentGapMap,

            entityPlan:
              generated.entitySchemaPlan,

            technicalPlan:
              generated.prioritizedFixList,

            roadmap: generated.roadmap,
          }
        );

      return res.status(201).json({
        success: true,
        data: saved,
        metadata: {
          operation:
            "generate-and-save-stage2-plan",
        },
      });
    } catch (error) {
      console.error(
        "Failed to generate Stage 2 content plan:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate Stage 2 content plan.",
      });
    }
  }
);

/* ========================================
   GET LATEST STAGE 2 CONTENT PLAN
======================================== */

app.get(
  "/api/tenants/:tenantId/stage2-plan/latest",
  async (req, res) => {
    try {
      const tenantId =
        req.params.tenantId;

      if (
        typeof tenantId !== "string" ||
        !tenantId.trim()
      ) {
        return res.status(400).json({
          success: false,
          error:
            "tenantId is required.",
        });
      }

      const schemaResult =
        await pool.query(
          `
            SELECT
              schema_name
            FROM platform.tenants
            WHERE id = $1
            LIMIT 1
          `,
          [tenantId.trim()]
        );

      if (
        schemaResult.rows.length === 0
      ) {
        return res.status(404).json({
          success: false,
          error:
            "Tenant not found.",
        });
      }

      const schemaName =
        schemaResult.rows[0]
          .schema_name;

      const plan =
        await getLatestContentPlan(
          schemaName
        );

      if (!plan) {
        return res.status(404).json({
          success: false,
          error:
            "No content plan found.",
        });
      }

      return res.json({
        success: true,
        data: plan,
        metadata: {
          operation:
            "get-latest-stage2-plan",
        },
      });
    } catch (error) {
      console.error(
        "Failed to load latest Stage 2 content plan:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load latest Stage 2 content plan.",
      });
    }
  }
);

/* ========================================
   APPROVE STAGE 2 CONTENT PLAN
======================================== */

app.post(
  "/api/tenants/:tenantId/stage2-plan/:planId/approve",
  requirePaidFeatureAccess,
  async (req, res) => {
    try {
      const tenantId =
        req.params.tenantId;

      const planId =
        req.params.planId;

      if (
        typeof tenantId !== "string" ||
        !tenantId.trim()
      ) {
        return res.status(400).json({
          success: false,
          error:
            "tenantId is required.",
        });
      }

      if (
        typeof planId !== "string" ||
        !planId.trim()
      ) {
        return res.status(400).json({
          success: false,
          error:
            "planId is required.",
        });
      }

      const schemaResult =
        await pool.query(
          `
            SELECT
              schema_name
            FROM platform.tenants
            WHERE id = $1
            LIMIT 1
          `,
          [tenantId.trim()]
        );

      if (
        schemaResult.rows.length === 0
      ) {
        return res.status(404).json({
          success: false,
          error:
            "Tenant not found.",
        });
      }

      const schemaName =
        schemaResult.rows[0]
          .schema_name;

      const approved =
        await approveContentPlan(
          schemaName,
          planId.trim()
        );

      if (!approved) {
        return res.status(404).json({
          success: false,
          error:
            "Content plan not found.",
        });
      }

      return res.json({
        success: true,
        data: approved,
        metadata: {
          operation:
            "approve-stage2-plan",
        },
      });
    } catch (error) {
      console.error(
        "Failed to approve Stage 2 content plan:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to approve Stage 2 content plan.",
      });
    }
  }
);

/* ========================================
   STAGE 3 — SHARED HELPER

   Every Stage 3 route below needs the same
   tenantId -> schemaName lookup plus a
   TenantContext for the agent it calls.
======================================== */

async function resolveTenantSchema(
  tenantId: string
): Promise<string | null> {
  const schemaResult =
    await pool.query(
      `
        SELECT
          schema_name
        FROM platform.tenants
        WHERE id = $1
        LIMIT 1
      `,
      [tenantId]
    );

  return (
    schemaResult.rows[0]?.schema_name ??
    null
  );
}

function buildTenantContext(
  tenantId: string,
  schemaName: string
) {
  return {
    tenantId,
    schema: schemaName,
    storagePrefix: `tenant-${tenantId}`,
    credentialNamespace: `credentials/tenant-${tenantId}`,
    vectorNamespace: `vector-tenant-${tenantId}`,
  };
}

/* ========================================
   REQUIRE PAID FEATURE ACCESS

   Gates content-plan generation, content
   production/fixes, task approval/
   publishing, and monitoring/reporting
   behind a paid plan - the Free Audit tier
   is Stage 1 only. Read-only endpoints
   (viewing an already-generated plan,
   report, or monitoring snapshot) are
   deliberately left ungated so existing
   data stays visible regardless of plan.
======================================== */

async function requirePaidFeatureAccess(
  req: express.Request<
    Record<string, string>
  >,
  res: express.Response,
  next: express.NextFunction
): Promise<void> {
  try {
    const tenantId =
      req.params.tenantId?.trim();

    if (!tenantId) {
      res.status(400).json({
        success: false,
        error:
          "tenantId is required.",
      });

      return;
    }

    const effectivePlan =
      await getEffectivePlanForTenant(
        tenantId
      );

    if (
      !planHasPaidFeatureAccess(
        effectivePlan.planTier
      )
    ) {
      res.status(403).json({
        success: false,
        error:
          "This feature requires the Growth plan or above. The Free Audit tier includes the Stage 1 audit only.",
      });

      return;
    }

    next();
  } catch (error) {
    console.error(
      "Failed to check plan access:",
      error
    );

    res.status(500).json({
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to check plan access.",
    });
  }
}

/* ========================================
   STAGE 3 — PRODUCE CONTENT DRAFTS
======================================== */

app.post(
  "/api/tenants/:tenantId/stage3-produce",
  requirePaidFeatureAccess,
  async (req, res) => {
    try {
      const tenantId =
        req.params.tenantId?.trim();

      if (!tenantId) {
        return res.status(400).json({
          success: false,
          error:
            "tenantId is required.",
        });
      }

      const schemaName =
        await resolveTenantSchema(
          tenantId
        );

      if (!schemaName) {
        return res.status(404).json({
          success: false,
          error:
            "Tenant not found.",
        });
      }

      const agent =
        new ContentProductionAgent();

      const agentOutput =
        await agent.execute({
          tenantContext:
            buildTenantContext(
              tenantId,
              schemaName
            ),
          payload: { tenantId },
        });

      if (
        !agentOutput.success ||
        !agentOutput.data
      ) {
        return res.status(422).json({
          success: false,
          error:
            agentOutput.error ||
            "Content production failed.",
        });
      }

      return res.status(201).json({
        success: true,
        data: agentOutput.data,
        metadata: {
          operation: "stage3-produce",
        },
      });
    } catch (error) {
      console.error(
        "Failed to run Stage 3 content production:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to run Stage 3 content production.",
      });
    }
  }
);

/* ========================================
   STAGE 3 — APPLY TECHNICAL/ENTITY FIXES
======================================== */

app.post(
  "/api/tenants/:tenantId/stage3-fix",
  requirePaidFeatureAccess,
  async (req, res) => {
    try {
      const tenantId =
        req.params.tenantId?.trim();

      if (!tenantId) {
        return res.status(400).json({
          success: false,
          error:
            "tenantId is required.",
        });
      }

      const schemaName =
        await resolveTenantSchema(
          tenantId
        );

      if (!schemaName) {
        return res.status(404).json({
          success: false,
          error:
            "Tenant not found.",
        });
      }

      const agent = new TechnicalFixAgent();

      const agentOutput =
        await agent.execute({
          tenantContext:
            buildTenantContext(
              tenantId,
              schemaName
            ),
          payload: { tenantId },
        });

      if (
        !agentOutput.success ||
        !agentOutput.data
      ) {
        return res.status(422).json({
          success: false,
          error:
            agentOutput.error ||
            "Technical fix run failed.",
        });
      }

      return res.status(201).json({
        success: true,
        data: agentOutput.data,
        metadata: {
          operation: "stage3-fix",
        },
      });
    } catch (error) {
      console.error(
        "Failed to run Stage 3 technical fixes:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to run Stage 3 technical fixes.",
      });
    }
  }
);

/* ========================================
   STAGE 3 — LIST EXECUTION TASKS
======================================== */

app.get(
  "/api/tenants/:tenantId/execution-tasks",
  async (req, res) => {
    try {
      const tenantId =
        req.params.tenantId?.trim();

      if (!tenantId) {
        return res.status(400).json({
          success: false,
          error:
            "tenantId is required.",
        });
      }

      const schemaName =
        await resolveTenantSchema(
          tenantId
        );

      if (!schemaName) {
        return res.status(404).json({
          success: false,
          error:
            "Tenant not found.",
        });
      }

      const tasks =
        await listExecutionTasks(
          schemaName
        );

      return res.json({
        success: true,
        data: tasks,
        metadata: {
          operation:
            "list-execution-tasks",
        },
      });
    } catch (error) {
      console.error(
        "Failed to list execution tasks:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to list execution tasks.",
      });
    }
  }
);

/* ========================================
   STAGE 3 — APPROVE EXECUTION TASK
======================================== */

app.post(
  "/api/tenants/:tenantId/execution-tasks/:taskId/approve",
  requirePaidFeatureAccess,
  async (req, res) => {
    try {
      const tenantId =
        req.params.tenantId?.trim();

      const taskId =
        req.params.taskId?.trim();

      if (!tenantId) {
        return res.status(400).json({
          success: false,
          error:
            "tenantId is required.",
        });
      }

      if (!taskId) {
        return res.status(400).json({
          success: false,
          error:
            "taskId is required.",
        });
      }

      const schemaName =
        await resolveTenantSchema(
          tenantId
        );

      if (!schemaName) {
        return res.status(404).json({
          success: false,
          error:
            "Tenant not found.",
        });
      }

      const approved =
        await approveExecutionTask(
          schemaName,
          taskId
        );

      if (!approved) {
        return res.status(404).json({
          success: false,
          error:
            "Execution task not found.",
        });
      }

      return res.json({
        success: true,
        data: approved,
        metadata: {
          operation:
            "approve-execution-task",
        },
      });
    } catch (error) {
      console.error(
        "Failed to approve execution task:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to approve execution task.",
      });
    }
  }
);

/* ========================================
   STAGE 3 — PUBLISH EXECUTION TASK

   Requires the task to already be
   approval_status = 'approved' (set only
   by the route above). The PublishingAgent
   re-checks this itself, so there is no
   path to publish without prior approval.
======================================== */

app.post(
  "/api/tenants/:tenantId/execution-tasks/:taskId/publish",
  requirePaidFeatureAccess,
  async (req, res) => {
    try {
      const tenantId =
        req.params.tenantId?.trim();

      const taskId =
        req.params.taskId?.trim();

      if (!tenantId) {
        return res.status(400).json({
          success: false,
          error:
            "tenantId is required.",
        });
      }

      if (!taskId) {
        return res.status(400).json({
          success: false,
          error:
            "taskId is required.",
        });
      }

      const schemaName =
        await resolveTenantSchema(
          tenantId
        );

      if (!schemaName) {
        return res.status(404).json({
          success: false,
          error:
            "Tenant not found.",
        });
      }

      const agent = new PublishingAgent();

      const agentOutput =
        await agent.execute({
          tenantContext:
            buildTenantContext(
              tenantId,
              schemaName
            ),
          payload: {
            tenantId,
            executionTaskId: taskId,
          },
        });

      if (
        !agentOutput.success ||
        !agentOutput.data
      ) {
        return res.status(422).json({
          success: false,
          error:
            agentOutput.error ||
            "Publishing failed.",
        });
      }

      return res.status(201).json({
        success: true,
        data: agentOutput.data,
        metadata: {
          operation:
            "publish-execution-task",
        },
      });
    } catch (error) {
      console.error(
        "Failed to publish execution task:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to publish execution task.",
      });
    }
  }
);

/* ========================================
   STAGE 4 — RUN MONITORING CHECK
======================================== */

app.post(
  "/api/tenants/:tenantId/stage4-monitor",
  requirePaidFeatureAccess,
  async (req, res) => {
    try {
      const tenantId =
        req.params.tenantId?.trim();

      if (!tenantId) {
        return res.status(400).json({
          success: false,
          error:
            "tenantId is required.",
        });
      }

      const schemaName =
        await resolveTenantSchema(
          tenantId
        );

      if (!schemaName) {
        return res.status(404).json({
          success: false,
          error:
            "Tenant not found.",
        });
      }

      const agent =
        new MonitoringAgent();

      const agentOutput =
        await agent.execute({
          tenantContext:
            buildTenantContext(
              tenantId,
              schemaName
            ),
          payload: { tenantId },
        });

      if (
        !agentOutput.success ||
        !agentOutput.data
      ) {
        return res.status(422).json({
          success: false,
          error:
            agentOutput.error ||
            "Monitoring run failed.",
        });
      }

      return res.status(201).json({
        success: true,
        data: agentOutput.data,
        metadata: {
          operation: "stage4-monitor",
        },
      });
    } catch (error) {
      console.error(
        "Failed to run Stage 4 monitoring check:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to run Stage 4 monitoring check.",
      });
    }
  }
);

/* ========================================
   STAGE 4 — GENERATE REPORT
======================================== */

app.post(
  "/api/tenants/:tenantId/stage4-report",
  requirePaidFeatureAccess,
  async (req, res) => {
    try {
      const tenantId =
        req.params.tenantId?.trim();

      if (!tenantId) {
        return res.status(400).json({
          success: false,
          error:
            "tenantId is required.",
        });
      }

      const schemaName =
        await resolveTenantSchema(
          tenantId
        );

      if (!schemaName) {
        return res.status(404).json({
          success: false,
          error:
            "Tenant not found.",
        });
      }

      const agent =
        new ReportGenerationAgent();

      const agentOutput =
        await agent.execute({
          tenantContext:
            buildTenantContext(
              tenantId,
              schemaName
            ),
          payload: { tenantId },
        });

      if (
        !agentOutput.success ||
        !agentOutput.data
      ) {
        return res.status(422).json({
          success: false,
          error:
            agentOutput.error ||
            "Report generation failed.",
        });
      }

      return res.status(201).json({
        success: true,
        data: agentOutput.data,
        metadata: {
          operation: "stage4-report",
        },
      });
    } catch (error) {
      console.error(
        "Failed to generate Stage 4 report:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate Stage 4 report.",
      });
    }
  }
);

/* ========================================
   STAGE 4 — GET LATEST MONITORING SNAPSHOT
======================================== */

app.get(
  "/api/tenants/:tenantId/monitoring/latest",
  async (req, res) => {
    try {
      const tenantId =
        req.params.tenantId?.trim();

      if (!tenantId) {
        return res.status(400).json({
          success: false,
          error:
            "tenantId is required.",
        });
      }

      const schemaName =
        await resolveTenantSchema(
          tenantId
        );

      if (!schemaName) {
        return res.status(404).json({
          success: false,
          error:
            "Tenant not found.",
        });
      }

      const snapshot =
        await getLatestMonitoringSnapshot(
          schemaName
        );

      return res.json({
        success: true,
        data: snapshot,
        metadata: {
          operation:
            "get-latest-monitoring-snapshot",
        },
      });
    } catch (error) {
      console.error(
        "Failed to load latest monitoring snapshot:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load latest monitoring snapshot.",
      });
    }
  }
);

/* ========================================
   STAGE 4 — GET LATEST REPORT
======================================== */

app.get(
  "/api/tenants/:tenantId/reports/latest",
  async (req, res) => {
    try {
      const tenantId =
        req.params.tenantId?.trim();

      if (!tenantId) {
        return res.status(400).json({
          success: false,
          error:
            "tenantId is required.",
        });
      }

      const schemaName =
        await resolveTenantSchema(
          tenantId
        );

      if (!schemaName) {
        return res.status(404).json({
          success: false,
          error:
            "Tenant not found.",
        });
      }

      const report =
        await getLatestReport(
          schemaName
        );

      return res.json({
        success: true,
        data: report,
        metadata: {
          operation:
            "get-latest-report",
        },
      });
    } catch (error) {
      console.error(
        "Failed to load latest report:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load latest report.",
      });
    }
  }
);

/* ========================================
   GOOGLE OAUTH — START

   Protected (falls under the /api/tenants
   requireAuth middleware registered above).
   Returns an authUrl for the frontend to
   navigate the browser to directly - this
   can't be a plain fetch, since Google's
   consent screen needs a real top-level
   navigation.
======================================== */

app.get(
  "/api/tenants/:tenantId/oauth/google/start",
  async (req, res) => {
    try {
      const tenantId =
        req.params.tenantId?.trim();

      if (!tenantId) {
        return res.status(400).json({
          success: false,
          error:
            "tenantId is required.",
        });
      }

      const schemaName =
        await resolveTenantSchema(
          tenantId
        );

      if (!schemaName) {
        return res.status(404).json({
          success: false,
          error:
            "Tenant not found.",
        });
      }

      const state =
        buildOAuthState(tenantId);

      const authUrl =
        buildGoogleAuthUrl(state);

      return res.json({
        success: true,
        data: { authUrl },
        metadata: {
          operation:
            "oauth-google-start",
        },
      });
    } catch (error) {
      console.error(
        "Failed to start Google OAuth flow:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to start Google OAuth flow.",
      });
    }
  }
);

/* ========================================
   GOOGLE OAUTH — CALLBACK

   Public - Google redirects the browser here
   directly, carrying none of our auth
   headers. The signed `state` param (built
   in the start route above) is what proves
   which tenant this belongs to and that the
   request wasn't forged.
======================================== */

app.get(
  "/api/oauth/google/callback",
  async (req, res) => {
    const redirectBase =
      `${
        process.env.WEB_APP_URL ??
        "http://localhost:3000"
      }/monitoring`;

    try {
      const {
        code,
        state,
        error: oauthError,
      } = req.query;

      if (
        typeof oauthError ===
        "string"
      ) {
        return res.redirect(
          `${redirectBase}?google=error&reason=${encodeURIComponent(
            oauthError
          )}`
        );
      }

      if (
        typeof code !== "string" ||
        typeof state !== "string"
      ) {
        return res.redirect(
          `${redirectBase}?google=error&reason=missing_params`
        );
      }

      const verifiedState =
        verifyOAuthState(state);

      if (!verifiedState) {
        return res.redirect(
          `${redirectBase}?google=error&reason=invalid_state`
        );
      }

      const { tenantId } =
        verifiedState;

      const tenant =
        await getTenantById(
          tenantId
        );

      if (!tenant?.websiteUrl) {
        return res.redirect(
          `${redirectBase}?google=error&reason=tenant_not_found`
        );
      }

      const tokens =
        await exchangeCodeForTokens(
          code
        );

      const [
        ga4Discovery,
        gscDiscovery,
      ] = await Promise.all([
        discoverGa4Property(
          tokens.accessToken
        ),
        discoverSearchConsoleSite(
          tokens.accessToken,
          tenant.websiteUrl
        ),
      ]);

      const discoveryIssues = [
        ga4Discovery.issue,
        gscDiscovery.issue,
      ].filter(
        (issue): issue is string =>
          issue !== null
      );

      if (discoveryIssues.length > 0) {
        console.warn(
          `[google-oauth] Tenant ${tenantId} connected Google but discovery had issues:`,
          discoveryIssues
        );
      }

      const bundle: GoogleTokenBundle =
        {
          accessToken:
            tokens.accessToken,
          refreshToken:
            tokens.refreshToken,
          expiresAt:
            tokens.expiresAt,
          ga4PropertyId:
            ga4Discovery.value,
          gscSiteUrl:
            gscDiscovery.value,
          connectedAt:
            new Date().toISOString(),
          discoveryIssues,
        };

      await storeCredential(
        tenantId,
        "google",
        JSON.stringify(bundle)
      );

      return res.redirect(
        `${redirectBase}?google=connected`
      );
    } catch (error) {
      console.error(
        "Google OAuth callback failed:",
        error
      );

      return res.redirect(
        `${redirectBase}?google=error&reason=server_error`
      );
    }
  }
);

/* ========================================
   GOOGLE OAUTH — STATUS
======================================== */

app.get(
  "/api/tenants/:tenantId/oauth/google/status",
  async (req, res) => {
    try {
      const tenantId =
        req.params.tenantId?.trim();

      if (!tenantId) {
        return res.status(400).json({
          success: false,
          error:
            "tenantId is required.",
        });
      }

      const raw =
        await getCredential(
          tenantId,
          "google"
        );

      if (!raw) {
        return res.json({
          success: true,
          data: {
            connected: false,
          },
        });
      }

      try {
        const bundle = JSON.parse(
          raw
        ) as GoogleTokenBundle;

        return res.json({
          success: true,
          data: {
            connected: true,
            ga4PropertyId:
              bundle.ga4PropertyId,
            gscSiteUrl:
              bundle.gscSiteUrl,
            connectedAt:
              bundle.connectedAt,
            discoveryIssues:
              bundle.discoveryIssues ??
              [],
          },
        });
      } catch {
        return res.json({
          success: true,
          data: {
            connected: false,
          },
        });
      }
    } catch (error) {
      console.error(
        "Failed to load Google OAuth status:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load Google OAuth status.",
      });
    }
  }
);

/* ========================================
   GOOGLE OAUTH — DISCONNECT
======================================== */

app.post(
  "/api/tenants/:tenantId/oauth/google/disconnect",
  async (req, res) => {
    try {
      const tenantId =
        req.params.tenantId?.trim();

      if (!tenantId) {
        return res.status(400).json({
          success: false,
          error:
            "tenantId is required.",
        });
      }

      await revokeVaultCredential(
        tenantId,
        "google"
      );

      return res.json({
        success: true,
        data: {
          disconnected: true,
        },
      });
    } catch (error) {
      console.error(
        "Failed to disconnect Google OAuth:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to disconnect Google OAuth.",
      });
    }
  }
);

/* ========================================
   VERIFY TENANT DOMAIN
======================================== */

app.post(
  "/api/tenants/:tenantId/verify-domain",
  async (req, res) => {
    try {
      const tenantId =
        req.params.tenantId;

      if (
        typeof tenantId !== "string" ||
        !tenantId.trim()
      ) {
        return res.status(400).json({
          success: false,
          error:
            "tenantId is required.",
        });
      }

      const { method } =
        req.body ?? {};

      if (
        method !== "dns" &&
        method !== "file"
      ) {
        return res.status(400).json({
          success: false,
          error:
            "method must be \"dns\" or \"file\".",
        });
      }

      const tenant =
        await getTenantById(
          tenantId.trim()
        );

      if (!tenant) {
        return res.status(404).json({
          success: false,
          error: "Tenant not found.",
        });
      }

      if (!tenant.websiteUrl) {
        return res.status(400).json({
          success: false,
          error:
            "Tenant has no website URL to verify.",
        });
      }

      if (!tenant.verificationToken) {
        return res.status(400).json({
          success: false,
          error:
            "Tenant has no verification token.",
        });
      }

      const domain =
        new URL(
          tenant.websiteUrl
        ).hostname;

      const verified =
        method === "dns"
          ? await verifyDnsTxtRecord(
              domain,
              tenant.verificationToken
            )
          : await verifyFileUpload(
              domain,
              tenant.verificationToken
            );

      if (!verified) {
        return res.status(400).json({
          success: false,
          error:
            method === "dns"
              ? `Verification failed. Add a TXT record named "_ai-visibility-verify.${domain}" with the value "${tenant.verificationToken}".`
              : `Verification failed. Publish a file at "https://${domain}/.well-known/ai-visibility-verify.txt" containing exactly "${tenant.verificationToken}".`,
        });
      }

      await markDomainVerified(
        tenantId.trim()
      );

      /*
       * Set to "auditing" synchronously so the
       * client's next tenant fetch (right after
       * this response) already sees the scan as
       * in progress, then let the rest of the
       * scan run in the background - not awaited,
       * since verification shouldn't block on a
       * scan that can take a while.
       */
      await setScanStatus(
        tenantId.trim(),
        "auditing"
      );

      void runAutomaticScan(
        tenantId.trim(),
        tenant.websiteUrl,
        tenant.schemaName
      );

      return res.json({
        success: true,
        data: {
          domainVerified: true,
        },
        metadata: {
          operation: "verify-domain",
        },
      });
    } catch (error) {
      console.error(
        "Domain verification failed:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Domain verification failed.",
      });
    }
  }
);

/* ========================================
   QUICK VERIFY TENANT DOMAIN (DEV ONLY)

   Skips real DNS/file checks so local test
   domains can be verified without setting up
   actual DNS records. Hard-gated on NODE_ENV
   so this can never run in production, even
   if the client-side button is bypassed.
======================================== */

app.post(
  "/api/tenants/:tenantId/quick-verify-domain",
  async (req, res) => {
    if (
      process.env.NODE_ENV ===
      "production"
    ) {
      return res.status(404).json({
        success: false,
        error: "Not found.",
      });
    }

    try {
      const tenantId =
        req.params.tenantId;

      if (
        typeof tenantId !== "string" ||
        !tenantId.trim()
      ) {
        return res.status(400).json({
          success: false,
          error:
            "tenantId is required.",
        });
      }

      const tenant =
        await getTenantById(
          tenantId.trim()
        );

      if (!tenant) {
        return res.status(404).json({
          success: false,
          error: "Tenant not found.",
        });
      }

      await markDomainVerified(
        tenantId.trim()
      );

      if (tenant.websiteUrl) {
        await setScanStatus(
          tenantId.trim(),
          "auditing"
        );

        void runAutomaticScan(
          tenantId.trim(),
          tenant.websiteUrl,
          tenant.schemaName
        );
      }

      return res.json({
        success: true,
        data: {
          domainVerified: true,
        },
        metadata: {
          operation:
            "quick-verify-domain",
        },
      });
    } catch (error) {
      console.error(
        "Quick domain verification failed:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Quick domain verification failed.",
      });
    }
  }
);

/* ========================================
   CANCEL TENANT
======================================== */

app.post(
  "/api/tenants/:tenantId/cancel",
  async (req, res) => {
    try {
      const tenantId =
        req.params.tenantId;

      if (
        typeof tenantId !== "string" ||
        !tenantId.trim()
      ) {
        return res.status(400).json({
          success: false,
          error:
            "tenantId is required.",
        });
      }

      const tenant =
        await getTenantById(
          tenantId.trim()
        );

      if (!tenant) {
        return res.status(404).json({
          success: false,
          error: "Tenant not found.",
        });
      }

      await scheduleTenantDeprovisioning(
        tenantId.trim()
      );

      return res.json({
        success: true,
        data: {
          status: "deprovisioning",
        },
        metadata: {
          operation: "cancel-tenant",
        },
      });
    } catch (error) {
      console.error(
        "Tenant cancellation failed:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Tenant cancellation failed.",
      });
    }
  }
);

/* ========================================
   CRON - DEPROVISION DUE TENANTS

   Replaces the old node-cron in-process
   scheduler, which can't run inside a
   serverless function (nothing stays
   resident between invocations). Triggered
   once daily by a Vercel Cron Job (see
   vercel.json) hitting this route instead.

   Vercel automatically attaches
   `Authorization: Bearer <CRON_SECRET>` to
   requests it sends here when a CRON_SECRET
   env var is configured on the project -
   this checks that header so the endpoint
   can't be triggered by anyone who just
   finds the URL. Locally (no CRON_SECRET
   set), the check is skipped so `pnpm dev`
   still works untouched.
======================================== */

app.get(
  "/api/cron/deprovision",
  async (req, res) => {
    const cronSecret =
      process.env.CRON_SECRET;

    if (cronSecret) {
      const authHeader =
        req.headers.authorization;

      if (
        authHeader !==
        `Bearer ${cronSecret}`
      ) {
        return res.status(401).json({
          success: false,
          error: "Unauthorized.",
        });
      }
    }

    try {
      const torn =
        await runDueDeprovisioning();

      if (torn.length > 0) {
        console.log(
          `Deprovisioned ${torn.length} tenant(s): ${torn
            .map(
              (tenant) =>
                tenant.tenantId
            )
            .join(", ")}`
        );
      }

      return res.json({
        success: true,
        data: {
          deprovisionedCount:
            torn.length,
        },
      });
    } catch (error) {
      console.error(
        "Scheduled tenant deprovisioning failed:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Scheduled tenant deprovisioning failed.",
      });
    }
  }
);

/* ========================================
   START SERVER

   Only listens on a port for local dev -
   on Vercel, the app is exported and
   invoked per-request as a serverless
   function instead (see api/index.ts).
======================================== */

if (!process.env.VERCEL) {
  app.listen(
    PORT,
    () => {
      console.log(
        `Worker API running on http://localhost:${PORT}`
      );
    }
  );
}

export default app;