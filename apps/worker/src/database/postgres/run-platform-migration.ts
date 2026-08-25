import "dotenv/config";

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { pool } from "./connection.js";

const migrationsPath = resolve(
  process.cwd(),
  "..",
  "..",
  "database",
  "platform",
  "migrations"
);

try {
  const files = (await readdir(migrationsPath))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    throw new Error("No platform migrations found.");
  }

  for (const file of files) {
    const filePath = resolve(migrationsPath, file);

    console.log(`Running platform migration: ${file}`);

    const sql = await readFile(filePath, "utf8");

    await pool.query(sql);

    console.log(`Platform migration ${file}: OK`);
  }

  console.log("All platform migrations completed successfully.");
} catch (error) {
  console.error("Platform migrations FAILED");

  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
} finally {
  await pool.end();
}