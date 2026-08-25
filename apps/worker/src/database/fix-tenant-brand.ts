import "dotenv/config";

import fs from "fs";
import path from "path";

import { pool } from "./postgres/connection.js";

async function main() {
  try {
    const sqlPath = path.resolve(
      process.cwd(),
      "..",
      "..",
      "fix-tenant-brand.sql"
    );

    console.log(
      `Reading SQL file: ${sqlPath}`
    );

    const sql =
      fs.readFileSync(
        sqlPath,
        "utf8"
      );

    await pool.query(sql);

    console.log(
      "Tenant brand fixed successfully."
    );
  } catch (error) {
    console.error(
      "Failed to fix tenant brand:"
    );

    console.error(error);

    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();