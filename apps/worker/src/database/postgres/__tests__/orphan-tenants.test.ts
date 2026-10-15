import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  deprovisionApproved,
  findOrphanCandidates,
  type OrphanQueryable,
} from "../orphan-tenant-commands.js";

const NOW = new Date("2026-10-15T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

interface Row {
  id: string;
  name: string;
  slug: string;
  status: string;
  created_at: Date;
  workspace_count: number;
  members: string[];
}

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const ROWS: Row[] = [
  /* real workspace, owned and active: never a candidate */
  { id: id(1), name: "nexflow", slug: "nexflow", status: "active", created_at: hoursAgo(900), workspace_count: 1, members: ["mumarnaved2@gmail.com"] },
  /* stuck provisioning, no workspace, no members */
  { id: id(2), name: "Test Company", slug: "test-company-1", status: "provisioning", created_at: hoursAgo(1500), workspace_count: 0, members: [] },
  /* active but nobody can reach it */
  { id: id(3), name: "Test Website", slug: "test-website", status: "active", created_at: hoursAgo(1400), workspace_count: 0, members: [] },
  /* workspace exists, its only member is gone */
  { id: id(4), name: "Ghost", slug: "ghost", status: "active", created_at: hoursAgo(800), workspace_count: 1, members: [] },
  /* another account, on a reserved test domain */
  { id: id(5), name: "Test Workspace", slug: "test-workspace", status: "active", created_at: hoursAgo(700), workspace_count: 1, members: ["test@example.com"] },
  /* provisioning for only 2 hours: still within its window */
  { id: id(6), name: "Fresh", slug: "fresh", status: "provisioning", created_at: hoursAgo(2), workspace_count: 1, members: ["mumarnaved2@gmail.com"] },
  /* provisioning for 30h WITH an owner: stuck, but belongs to an account */
  { id: id(7), name: "Slow", slug: "slow", status: "provisioning", created_at: hoursAgo(30), workspace_count: 1, members: ["mumarnaved2@gmail.com"] },
  /* a real other customer: never a candidate */
  { id: id(8), name: "Acme", slug: "acme", status: "active", created_at: hoursAgo(600), workspace_count: 1, members: ["boss@acme.com"] },
  /* mixed members (one real): not a test account */
  { id: id(9), name: "Mixed", slug: "mixed", status: "active", created_at: hoursAgo(600), workspace_count: 1, members: ["a@example.com", "real@acme.com"] },
  /* already deleted: the real query excludes these */
  { id: id(10), name: "Gone", slug: "gone", status: "deprovisioning", created_at: hoursAgo(600), workspace_count: 0, members: [] },
];

function fakeDb(): OrphanQueryable {
  return {
    async query(sql: string) {
      assert.match(sql, /orphans\.list/);
      /* Mirrors the SQL's own status filter. */
      assert.match(sql, /NOT IN \('deprovisioning', 'deprovisioned'\)/);
      assert.ok(
        !/\b(UPDATE|DELETE|INSERT|DROP)\b/i.test(sql),
        "listing must be read-only"
      );

      return {
        rows: ROWS.filter(
          (r) => r.status !== "deprovisioning" && r.status !== "deprovisioned"
        ),
      };
    },
  };
}

describe("findOrphanCandidates (phase 1, read only)", () => {
  it("lists exactly the unreachable, stuck and test-account tenants", async () => {
    const found = await findOrphanCandidates(fakeDb(), NOW);

    assert.deepEqual(
      found.map((c) => c.slug),
      ["test-company-1", "test-website", "ghost", "test-workspace", "slow"]
    );
  });

  it("never lists a real workspace, a fresh provisioning one, a mixed-member one or an already-deleted one", async () => {
    const slugs = (await findOrphanCandidates(fakeDb(), NOW)).map((c) => c.slug);

    for (const real of ["nexflow", "fresh", "acme", "mixed", "gone"]) {
      assert.ok(!slugs.includes(real), real);
    }
  });

  it("explains each candidate", async () => {
    const by = Object.fromEntries(
      (await findOrphanCandidates(fakeDb(), NOW)).map((c) => [c.slug, c])
    );

    assert.deepEqual(by["test-company-1"].reasons, [
      "no-workspace-no-members",
      "stuck-provisioning",
    ]);
    assert.deepEqual(by["test-website"].reasons, ["no-workspace-no-members"]);
    assert.deepEqual(by["ghost"].reasons, ["workspace-without-members"]);
    assert.deepEqual(by["test-workspace"].reasons, ["test-account"]);
    assert.deepEqual(by["slow"].reasons, ["stuck-provisioning"]);
  });

  it("flags tenants that belong to an account, e.g. test@example.com's Test Workspace", async () => {
    const by = Object.fromEntries(
      (await findOrphanCandidates(fakeDb(), NOW)).map((c) => [c.slug, c])
    );

    assert.equal(by["test-workspace"].belongsToAnotherAccount, true);
    assert.deepEqual(by["test-workspace"].members, ["test@example.com"]);
    assert.equal(by["slow"].belongsToAnotherAccount, true);
    assert.equal(by["test-website"].belongsToAnotherAccount, false);
    assert.equal(by["test-company-1"].belongsToAnotherAccount, false);
  });

  it("uses the 24 hour boundary for stuck provisioning", async () => {
    const rows: Row[] = [
      { ...ROWS[6], id: id(20), slug: "edge-23h", created_at: hoursAgo(23.9) },
      { ...ROWS[6], id: id(21), slug: "edge-24h", created_at: hoursAgo(24.1) },
    ];

    const db: OrphanQueryable = { query: async () => ({ rows }) };
    const slugs = (await findOrphanCandidates(db, NOW)).map((c) => c.slug);

    assert.deepEqual(slugs, ["edge-24h"]);
  });
});

describe("deprovisionApproved (phase 2, existing flow, approved ids only)", () => {
  const run = async (ids: string[], dryRun = false) => {
    const scheduled: string[] = [];

    const outcome = await deprovisionApproved(fakeDb(), ids, {
      schedule: async (tenantId) => {
        scheduled.push(tenantId);
      },
      dryRun,
      now: NOW,
    });

    return { outcome, scheduled };
  };

  it("runs the existing flow on exactly the approved ids, nothing else", async () => {
    const { outcome, scheduled } = await run([id(2), id(5)]);

    assert.deepEqual(scheduled, [id(2), id(5)]);
    assert.equal(outcome.refused.length, 0);
    assert.equal(outcome.scheduled.length, 2);
  });

  it("refuses a real workspace's id and touches NOTHING, even the valid ids in the same call", async () => {
    const { outcome, scheduled } = await run([id(2), id(1)]);

    assert.deepEqual(scheduled, []);
    assert.equal(outcome.refused.length, 1);
    assert.equal(outcome.refused[0].id, id(1));
    assert.match(outcome.refused[0].why, /not an orphan candidate/);
  });

  it("refuses unknown, already-deleted and malformed ids", async () => {
    const { outcome, scheduled } = await run([id(99), id(10), "not-a-uuid"]);

    assert.deepEqual(scheduled, []);
    assert.deepEqual(
      outcome.refused.map((r) => r.id).sort(),
      [id(10), id(99), "not-a-uuid"].sort()
    );
  });

  it("a dry run schedules nothing", async () => {
    const { outcome, scheduled } = await run([id(2)], true);

    assert.deepEqual(scheduled, []);
    assert.equal(outcome.dryRun, true);
    assert.equal(outcome.scheduled.length, 1);
  });

  it("de-duplicates ids and is case-insensitive", async () => {
    const { scheduled } = await run([id(2), id(2).toUpperCase(), ` ${id(2)} `]);

    assert.deepEqual(scheduled, [id(2)]);
  });

  it("requires at least one id", async () => {
    await assert.rejects(run([]), /No tenant ids/);
    await assert.rejects(run(["  "]), /No tenant ids/);
  });
});
