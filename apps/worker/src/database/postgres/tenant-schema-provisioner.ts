import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { pool } from "./connection.js";

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export async function provisionTenantSchema(
  schemaName: string
): Promise<void> {
  const safeSchemaName = quoteIdentifier(schemaName);

  await pool.query(
    `CREATE SCHEMA IF NOT EXISTS ${safeSchemaName}`
  );

  const migrationsPath = resolve(
    process.cwd(),
    "..",
    "..",
    "database",
    "tenant-template",
    "migrations"
  );

  const migrationFiles = (
    await readdir(migrationsPath)
  )
    .filter(
      (file) =>
        file.endsWith(".sql") &&
        !file.endsWith(".backup.sql")
    )
    .sort();

  for (const migrationFile of migrationFiles) {
    const migrationPath = resolve(
      migrationsPath,
      migrationFile
    );

    const migration = await readFile(
      migrationPath,
      "utf8"
    );

    const statements = migration
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean);

    for (const statement of statements) {
      await pool.query(
        `SET search_path TO ${safeSchemaName}, public`
      );

      await pool.query(statement);
    }
  }

  await pool.query(
    `SET search_path TO public`
  );
}