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
  listExecutionTasks,
  approveExecutionTask,
} from "../database/postgres/execution-tasks/execution-tasks-repository.js";

import {
  getTenantById,
  markDomainVerified,
} from "../database/postgres/tenant-registry.js";

import {
  verifyDnsTxtRecord,
  verifyFileUpload,
} from "../database/postgres/domain-verification/domain-verification-service.js";

import {
  scheduleTenantDeprovisioning,
} from "../database/postgres/tenant-deprovisioning.js";

import {
  createUniqueTenantSlug,
  createUniqueWorkspaceSlug,
} from "../auth/auth-service.js";

import {
  startDeprovisioningScheduler,
} from "../scheduler/deprovisioning-scheduler.js";

import authRouter from "../auth/routes/auth-routes.js";

const app = express();

const PORT = Number(
  process.env.API_PORT ?? 4000
);

/* ========================================
   MIDDLEWARE
======================================== */

app.use(
  cors({
    origin: "http://localhost:3000",
  })
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

/* ========================================
   HELPERS
======================================== */

function getBrandNameFromWebsite(
  websiteUrl: string
): string {
  try {
    const parsedUrl = new URL(
      websiteUrl
    );

    const hostname =
      parsedUrl.hostname
        .toLowerCase()
        .replace(
          /^www\./,
          ""
        );

    const parts =
      hostname.split(".");

    if (
      parts.length === 0
    ) {
      return "";
    }

    return parts[0]
      .replace(
        /[-_]+/g,
        " "
      )
      .trim();
  } catch {
    return "";
  }
}

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
   STAGE 3 — PRODUCE CONTENT DRAFTS
======================================== */

app.post(
  "/api/tenants/:tenantId/stage3-produce",
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
   START SERVER
======================================== */

app.listen(
  PORT,
  () => {
    console.log(
      `Worker API running on http://localhost:${PORT}`
    );

    startDeprovisioningScheduler();
  }
);