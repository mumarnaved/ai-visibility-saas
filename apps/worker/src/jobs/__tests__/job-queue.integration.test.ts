import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { createJobQueue, STUCK_AFTER_SECONDS } from "../job-queue.js";

/* ========================================
   REAL POSTGRES (opt-in)

   Runs the queue's actual SQL, including
   FOR UPDATE SKIP LOCKED across separate
   connections. Skipped unless TEST_DATABASE_URL
   is set. It creates a throwaway schema
   (jobs_test_<random>) holding a stub tenants
   table and the real 010_create_jobs.sql
   rewritten to that schema, and drops it
   afterwards. It never touches platform.*.

     TEST_DATABASE_URL=postgres://... pnpm test
======================================== */

const url = process.env.TEST_DATABASE_URL;

const here = dirname(fileURLToPath(import.meta.url));

describe("job queue on real Postgres", { skip: !url }, () => {
  const schema = `jobs_test_${randomBytes(6).toString("hex")}`;
  const tenantA = randomUUID();
  const tenantB = randomUUID();

  let pool: pg.Pool;

  const queue = () => createJobQueue(pool, `${schema}.jobs`);

  before(async () => {
    pool = new pg.Pool({ connectionString: url, max: 8 });

    const sql = (
      await readFile(
        resolve(
          here,
          "../../../../../database/platform/migrations/010_create_jobs.sql"
        ),
        "utf8"
      )
    ).replaceAll("platform.", `${schema}.`);

    await pool.query(`CREATE SCHEMA ${schema}`);
    await pool.query(
      `CREATE TABLE ${schema}.tenants (id UUID PRIMARY KEY)`
    );
    await pool.query(
      `INSERT INTO ${schema}.tenants (id) VALUES ($1), ($2)`,
      [tenantA, tenantB]
    );
    await pool.query(sql);
  });

  after(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.end();
  });

  it("the migration is idempotent", async () => {
    const sql = (
      await readFile(
        resolve(
          here,
          "../../../../../database/platform/migrations/010_create_jobs.sql"
        ),
        "utf8"
      )
    ).replaceAll("platform.", `${schema}.`);

    await pool.query(sql);
  });

  it("enqueue, claim, succeed", async () => {
    const q = queue();
    const id = await q.enqueue(tenantA, "t", { n: 1 });
    const job = await q.claimNext();

    assert.equal(job?.id, id);
    assert.equal(job?.status, "running");
    assert.equal(job?.attempts, 1);

    await q.markSucceeded(id, { ok: true });

    const read = await q.getJobForTenant(tenantA, id);
    assert.equal(read?.status, "succeeded");
    assert.deepEqual(read?.result, { ok: true });
    assert.equal(await q.getJobForTenant(tenantB, id), null);
  });

  it("concurrent claimers on separate connections never get the same job", async () => {
    const q = queue();
    const ids = new Set<string>();

    for (let i = 0; i < 30; i++) {
      ids.add(await q.enqueue(tenantA, "burst", { i }));
    }

    const claims = await Promise.all(
      Array.from({ length: 40 }, () => q.claimNext())
    );

    const claimed = claims.filter((c) => c !== null).map((c) => c!.id);

    assert.equal(claimed.length, 30);
    assert.equal(new Set(claimed).size, 30);
    assert.deepEqual(new Set(claimed), ids);
  });

  it("a locked row is skipped, not waited on", async () => {
    const q = queue();
    const id = await q.enqueue(tenantA, "locked");

    const holder = await pool.connect();

    try {
      await holder.query("BEGIN");
      await holder.query(
        `SELECT id FROM ${schema}.jobs WHERE id = $1 FOR UPDATE`,
        [id]
      );

      const started = Date.now();
      const claimed = await q.claimNext();

      assert.equal(claimed, null);
      assert.ok(Date.now() - started < 2000, "claim must not block");
    } finally {
      await holder.query("ROLLBACK");
      holder.release();
    }

    assert.equal((await q.claimNext())?.id, id);
  });

  it("retry sets a later run_at; give-up fails the job", async () => {
    const q = queue();
    const id = await q.enqueue(tenantA, "retry", {}, { maxAttempts: 2 });

    let job = (await q.claimNext())!;
    assert.equal(await q.markFailed(job, "boom"), "retry");
    assert.equal(await q.claimNext(), null);

    await pool.query(
      `UPDATE ${schema}.jobs SET run_at = NOW() WHERE id = $1`,
      [id]
    );

    job = (await q.claimNext())!;
    assert.equal(job.attempts, 2);
    assert.equal(await q.markFailed(job, "boom again"), "failed");
    assert.equal((await q.getJobForTenant(tenantA, id))?.status, "failed");
  });

  it("requeues a stuck running job", async () => {
    const q = queue();
    const id = await q.enqueue(tenantA, "stuck");

    await q.claimNext();
    await pool.query(
      `UPDATE ${schema}.jobs
       SET locked_at = NOW() - make_interval(secs => $2)
       WHERE id = $1`,
      [id, STUCK_AFTER_SECONDS + 5]
    );

    const recovered = await q.requeueStuck();

    assert.equal(recovered.requeued, 1);
    assert.equal((await q.getJobForTenant(tenantA, id))?.status, "queued");
  });

  it("enqueueOnce dedupes an identical active job", async () => {
    const q = queue();
    const first = await q.enqueueOnce(tenantB, "dedupe", { a: 1 });
    const again = await q.enqueueOnce(tenantB, "dedupe", { a: 1 });

    assert.equal(again.id, first.id);
    assert.equal(again.deduplicated, true);
  });
});
