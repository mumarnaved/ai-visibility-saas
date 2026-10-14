import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { buildTenantManifest } from "../../../context/tenant-manifest.js";
import {
  runTenantDeprovisioning,
  type DeprovisioningFlowDeps,
} from "../deprovisioning-flow.js";
import { FakePg } from "./fake-pg.js";

/*
 * tenant-deprovisioning.ts imports connection.ts,
 * which throws without DATABASE_URL. The pool is
 * lazy and nothing here uses it.
 */
process.env.DATABASE_URL ??=
  "postgres://test:test@127.0.0.1:1/test";

const { markTenantDeprovisioned } = await import(
  "../tenant-deprovisioning.js"
);

const id = randomUUID();
const schemaName = `tenant_${id.replaceAll("-", "")}`;

const tenant = {
  tenantId: id,
  schemaName,
  storagePrefix: `tenant-${id}`,
};

function setup(failAt?: string) {
  const fake = new FakePg({
    tenants: [
      {
        id,
        name: "Acme",
        schema_name: schemaName,
        status: "deprovisioning",
        manifest: buildTenantManifest({ id, schemaName }),
      },
    ],
  });

  const calls: string[] = [];

  const step =
    (name: string) => async (): Promise<void> => {
      calls.push(name);

      if (name === failAt) {
        throw new Error(`${name} boom`);
      }
    };

  const deps: DeprovisioningFlowDeps = {
    dropSchema: step("schema"),
    purgeStorage: step("storage"),
    revokeCredentials: step("credentials"),
    markDeprovisioned: async (tenantId) => {
      calls.push("mark");

      if (failAt === "mark") {
        throw new Error("mark boom");
      }

      await markTenantDeprovisioned(fake, tenantId);
    },
  };

  return { fake, deps, calls };
}

describe("tenant deprovisioning", () => {
  it("runs schema, storage, credentials, then the final status update", async () => {
    const { deps, calls } = setup();

    await runTenantDeprovisioning(deps, tenant);

    assert.deepEqual(calls, [
      "schema",
      "storage",
      "credentials",
      "mark",
    ]);
  });

  it("clears the manifest in the final update, together with the status", async () => {
    const { fake, deps } = setup();

    assert.ok(fake.tenant(id)?.manifest);

    await runTenantDeprovisioning(deps, tenant);

    assert.equal(fake.tenant(id)?.status, "deprovisioned");
    assert.equal(fake.tenant(id)?.manifest, null);
  });

  it("the final update is the only statement that touches the manifest", async () => {
    const { fake, deps } = setup();

    await runTenantDeprovisioning(deps, tenant);

    const statements = fake.writes();

    assert.equal(statements.length, 1);
    assert.match(statements[0], /status = 'deprovisioned'/);
    assert.match(statements[0], /manifest = NULL/);
  });

  for (const failAt of [
    "schema",
    "storage",
    "credentials",
    "mark",
  ]) {
    it(`a failure at ${failAt} leaves the manifest and status in place`, async () => {
      const { fake, deps, calls } = setup(failAt);
      const before = fake.tenant(id)?.manifest;

      await assert.rejects(
        () => runTenantDeprovisioning(deps, tenant),
        new RegExp(`${failAt} boom`)
      );

      assert.deepEqual(fake.tenant(id)?.manifest, before);
      assert.equal(fake.tenant(id)?.status, "deprovisioning");
      assert.equal(calls.at(-1), failAt);
    });
  }

  it("later steps do not run after a failure", async () => {
    const { deps, calls } = setup("storage");

    await assert.rejects(() =>
      runTenantDeprovisioning(deps, tenant)
    );

    assert.deepEqual(calls, ["schema", "storage"]);
  });
});
