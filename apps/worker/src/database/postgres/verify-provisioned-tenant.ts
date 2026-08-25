import "dotenv/config";

import { pool } from "./connection.js";

const schemaName =
  "tenant_9e9e2e8b3df64bf69397f63e2fff6588";

async function verifyProvisionedTenant(): Promise<void> {
  try {
    const tenantResult = await pool.query(
      `
        SELECT
          id,
          slug,
          name,
          schema_name,
          status,
          plan
        FROM platform.tenants
        WHERE schema_name = $1
      `,
      [schemaName]
    );

    console.log("Platform tenant:");
    console.log(tenantResult.rows);

    const tablesResult = await pool.query(
      `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = $1
        ORDER BY table_name
      `,
      [schemaName]
    );

    console.log("Tenant tables:");
    console.log(tablesResult.rows);
  } catch (error) {
    console.error("Tenant verification: FAILED");

    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(error);
    }

    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

await verifyProvisionedTenant();