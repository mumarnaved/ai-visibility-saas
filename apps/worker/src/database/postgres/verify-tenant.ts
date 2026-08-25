import "dotenv/config";

import { pool } from "./connection.js";

async function verifyTenant(): Promise<void> {
  try {
    const schemaResult = await pool.query(
      `
        SELECT schema_name
        FROM information_schema.schemata
        WHERE schema_name = 'tenant_example'
      `
    );

    console.log("Tenant schema:");
    console.log(schemaResult.rows);

    const tablesResult = await pool.query(
      `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'tenant_example'
        ORDER BY table_name
      `
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

await verifyTenant();