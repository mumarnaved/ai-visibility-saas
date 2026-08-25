import "dotenv/config";

import { pool } from "./connection.js";

async function verifyPlatform(): Promise<void> {
  try {
    const result = await pool.query(
      `
        SELECT table_schema, table_name
        FROM information_schema.tables
        WHERE table_schema = 'platform'
          AND table_name = 'tenants'
      `
    );

    console.log("Platform table check:");
    console.log(result.rows);
  } catch (error) {
    console.error("Platform table check: FAILED");

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

await verifyPlatform();