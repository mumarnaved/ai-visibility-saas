import "dotenv/config";

import { pool } from "../connection.js";

import {
  createTenantRecord,
} from "../tenant-registry.js";

import {
  provisionTenantSchema,
} from "../tenant-schema-provisioner.js";

import {
  getLatestAuditReport,
  saveAuditReport,
} from "./audit-report-repository.js";

import type {
  AuditReport,
} from "../../../agents/audit-aggregator/index.js";

const report: AuditReport = {
  tenantId: "placeholder",
  generatedAt: new Date().toISOString(),
  overallScore: 74,
  categories: {
    technicalSEO: {
      score: 80,
      status: "good",
      summary: "Technical summary.",
    },
    contentQuality: {
      score: 65,
      status: "warning",
      summary: "Content summary.",
    },
    aioReadiness: {
      score: 72,
      status: "warning",
      summary: "AIO summary.",
    },
    geoCitationStatus: {
      score: 90,
      status: "good",
      summary: "Citation summary.",
    },
    competitorGap: {
      score: 60,
      status: "warning",
      summary: "Competitor summary.",
    },
  },
  summary: "Overall audit summary.",
  priorities: [
    "Content Quality requires attention (score: 65/100).",
  ],
};

let tenantId: string | undefined;

try {
  const tenant =
    await createTenantRecord(
      "Audit Report Repo Test Co",
      `audit-report-repo-test-${Date.now()}`,
      "https://example.com"
    );

  tenantId = tenant.id;

  await provisionTenantSchema(
    tenant.schemaName
  );

  report.tenantId = tenant.id;

  const saved =
    await saveAuditReport(
      tenant.id,
      report
    );

  console.log("Saved:", saved);

  if (saved.websiteUrl !== "https://example.com") {
    throw new Error(
      `Expected websiteUrl to be looked up from platform.tenants, got: ${saved.websiteUrl}`
    );
  }

  if (saved.overallScore !== 74) {
    throw new Error(
      `Expected overallScore 74, got ${saved.overallScore}`
    );
  }

  if (saved.technicalSeoScore !== 80) {
    throw new Error(
      `Expected technicalSeoScore 80, got ${saved.technicalSeoScore}`
    );
  }

  if (saved.competitorGapScore !== 60) {
    throw new Error(
      `Expected competitorGapScore 60, got ${saved.competitorGapScore}`
    );
  }

  const latest =
    await getLatestAuditReport(
      tenant.id
    );

  if (!latest || latest.id !== saved.id) {
    throw new Error(
      "getLatestAuditReport did not return the saved report."
    );
  }

  console.log("Latest:", latest);

  console.log(
    "audit-report-repository test: OK"
  );
} catch (error) {
  console.error(
    "audit-report-repository test: FAILED"
  );

  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
} finally {
  if (tenantId) {
    const tenant = await pool.query(
      `SELECT schema_name FROM platform.tenants WHERE id = $1`,
      [tenantId]
    );

    const schemaName = tenant.rows[0]?.schema_name;

    if (schemaName && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schemaName)) {
      await pool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    }

    await pool.query(`DELETE FROM platform.tenants WHERE id = $1`, [tenantId]);
  }

  await pool.end();
}
