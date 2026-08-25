import "dotenv/config";

import { pool } from "./connection.js";

async function main() {
  try {
    const tenantResult = await pool.query(`
      SELECT
        id,
        slug,
        name,
        schema_name,
        status,
        plan
      FROM platform.tenants
      ORDER BY created_at DESC
      LIMIT 1
    `);

    console.log("Latest platform tenant:");
    console.log(tenantResult.rows);

    if (tenantResult.rows.length === 0) {
      console.log("No tenants found.");
      return;
    }

    const tenant = tenantResult.rows[0];

    const schemaResult = await pool.query(
      `
      SELECT schema_name
      FROM information_schema.schemata
      WHERE schema_name = $1
      `,
      [tenant.schema_name]
    );

    console.log("Tenant schema:");
    console.log(schemaResult.rows);

    const tablesResult = await pool.query(
      `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = $1
      ORDER BY table_name
      `,
      [tenant.schema_name]
    );

    console.log("Tenant tables:");
    console.log(tablesResult.rows);

    console.log("Verification complete.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Verification failed:");
  console.error(error);
  process.exit(1);
});