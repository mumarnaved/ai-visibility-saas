import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL environment variable is required."
  );
}

export const pool = new Pool({
  connectionString: databaseUrl,

  /*
   * Serverless (Vercel) runs many concurrent
   * function instances, each with its own pool -
   * a high per-instance max multiplies into a
   * connection-limit problem fast, even behind
   * Supabase's pooler. Low max is the standard
   * recommendation for pg.Pool in that
   * environment; harmless locally too.
   */
  max: 3,
});

export async function checkDatabaseConnection(): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("SELECT 1");
  } finally {
    client.release();
  }
}