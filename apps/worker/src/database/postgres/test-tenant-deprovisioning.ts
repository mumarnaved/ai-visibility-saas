import "dotenv/config";

import { pool } from "./connection.js";

import {
  provisionTenant,
} from "./tenant-provisioning.js";

import {
  runDueDeprovisioning,
  scheduleTenantDeprovisioning,
} from "./tenant-deprovisioning.js";

try {
  const tenant =
    await provisionTenant({
      name: "Deprovisioning Test Company",
      slug: `deprovisioning-test-${Date.now()}`,
      websiteUrl: "https://example.com",
    });

  console.log(
    `Provisioned tenant: ${tenant.id} (${tenant.schemaName})`
  );

  await scheduleTenantDeprovisioning(
    tenant.id
  );

  const scheduled =
    await pool.query(
      `SELECT status, deprovision_at FROM platform.tenants WHERE id = $1`,
      [tenant.id]
    );

  console.log(
    "After scheduling:",
    scheduled.rows[0]
  );

  if (
    scheduled.rows[0].status !==
    "deprovisioning"
  ) {
    throw new Error(
      "Expected status to be deprovisioning."
    );
  }

  if (!scheduled.rows[0].deprovision_at) {
    throw new Error(
      "Expected deprovision_at to be set."
    );
  }

  /*
   * Force it due now, instead of waiting
   * for the real retention window.
   */
  await pool.query(
    `UPDATE platform.tenants SET deprovision_at = NOW() - INTERVAL '1 day' WHERE id = $1`,
    [tenant.id]
  );

  const torn =
    await runDueDeprovisioning();

  console.log(
    "Torn down tenants:",
    torn
  );

  const wasTorn = torn.some(
    (entry) =>
      entry.tenantId === tenant.id
  );

  if (!wasTorn) {
    throw new Error(
      "Expected this tenant to be in the torn-down list."
    );
  }

  const schemaCheck =
    await pool.query(
      `SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1`,
      [tenant.schemaName]
    );

  if (schemaCheck.rows.length !== 0) {
    throw new Error(
      "Expected tenant schema to be dropped."
    );
  }

  const finalStatus =
    await pool.query(
      `SELECT status FROM platform.tenants WHERE id = $1`,
      [tenant.id]
    );

  if (
    finalStatus.rows[0].status !==
    "deprovisioned"
  ) {
    throw new Error(
      `Expected status deprovisioned, got ${finalStatus.rows[0].status}`
    );
  }

  console.log(
    "Tenant deprovisioning test: OK"
  );
} catch (error) {
  console.error(
    "Tenant deprovisioning test: FAILED"
  );

  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
} finally {
  await pool.end();
}
