import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  runTenantProvisioning,
  type ProvisioningFlowDeps,
} from "../provisioning-flow.js";
import type { TenantRecord } from "../tenant-registry.js";

/* tenant-provisioning.ts imports the pool, which needs DATABASE_URL at load. */
process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:1/test";

const { rollbackProvisioning } = await import("../tenant-provisioning.js");

const request = {
  name: "mutedwear",
  slug: "mutedwear",
  websiteUrl: "https://mutedwear.store",
};

const TENANT_ID = "39762188-a074-4914-9a8c-330ad937f532";

const record: TenantRecord = {
  id: TENANT_ID,
  slug: "mutedwear",
  name: "mutedwear",
  websiteUrl: "https://mutedwear.store",
  schemaName: `tenant_${TENANT_ID.replaceAll("-", "")}`,
  status: "provisioning",
  plan: "starter",
  verificationToken: "tok",
  domainVerifiedAt: null,
} as TenantRecord;

function setup(overrides: Partial<ProvisioningFlowDeps> = {}) {
  const events: string[] = [];

  const deps: ProvisioningFlowDeps = {
    createTenantRecord: async () => {
      events.push("create");
      return { ...record };
    },
    provisionTenantSchema: async () => {
      events.push("schema");
    },
    persistManifest: async () => {
      events.push("manifest");
      return { tenantId: TENANT_ID } as never;
    },
    activateTenant: async () => {
      events.push("activate");
    },
    failTenant: async () => {
      events.push("fail");
    },
    rollbackTenant: async (tenant) => {
      events.push(`rollback:${tenant.id}`);
    },
    ...overrides,
  };

  return { deps, events };
}

/* The exact error from the failed production attempt. */
const ENOENT = Object.assign(
  new Error(
    "ENOENT: no such file or directory, scandir '/database/tenant-template/migrations'"
  ),
  { code: "ENOENT" }
);

describe("provisioning that throws partway", () => {
  it("marks the tenant failed, rolls back, and rethrows the ORIGINAL error", async () => {
    const { deps, events } = setup({
      provisionTenantSchema: async () => {
        events.push("schema");
        throw ENOENT;
      },
    });

    await assert.rejects(
      () => runTenantProvisioning(deps, request),
      (error) => error === ENOENT
    );

    assert.deepEqual(events, ["create", "schema", "fail", `rollback:${TENANT_ID}`]);
    assert.ok(!events.includes("activate"), "never activated");
  });

  it("fails and rolls back when the manifest step throws after the schema was built", async () => {
    const { deps, events } = setup({
      persistManifest: async () => {
        events.push("manifest");
        throw new Error("storage down");
      },
    });

    await assert.rejects(() => runTenantProvisioning(deps, request), /storage down/);

    assert.deepEqual(events, [
      "create",
      "schema",
      "manifest",
      "fail",
      `rollback:${TENANT_ID}`,
    ]);
  });

  it("marking failed is retried once, so a database blip cannot leave the tenant 'provisioning'", async () => {
    let attempts = 0;

    const { deps, events } = setup({
      provisionTenantSchema: async () => {
        throw new Error("boom");
      },
      failTenant: async () => {
        attempts += 1;

        if (attempts === 1) {
          throw new Error("connection reset");
        }

        events.push("fail");
      },
    });

    await assert.rejects(() => runTenantProvisioning(deps, request), /boom/);

    assert.equal(attempts, 2);
    assert.ok(events.includes("fail"));
    assert.ok(events.includes(`rollback:${TENANT_ID}`));
  });

  it("if marking failed keeps failing, it still rolls back and still reports the original error", async () => {
    const original = new Error("original");
    const errors: unknown[] = [];
    const log = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };

    try {
      const { deps, events } = setup({
        provisionTenantSchema: async () => {
          throw original;
        },
        failTenant: async () => {
          throw new Error("db down");
        },
      });

      await assert.rejects(
        () => runTenantProvisioning(deps, request),
        (error) => error === original
      );

      assert.ok(events.includes(`rollback:${TENANT_ID}`));
      assert.ok(errors.length >= 1, "the failure to mark was logged");
    } finally {
      console.error = log;
    }
  });

  it("a failing rollback never replaces the original error", async () => {
    const original = new Error("original");
    const log = console.error;
    console.error = () => undefined;

    try {
      const { deps } = setup({
        provisionTenantSchema: async () => {
          throw original;
        },
        rollbackTenant: async () => {
          throw new Error("could not drop schema");
        },
      });

      await assert.rejects(
        () => runTenantProvisioning(deps, request),
        (error) => error === original
      );
    } finally {
      console.error = log;
    }
  });

  it("a successful provisioning is not rolled back", async () => {
    const { deps, events } = setup();

    const tenant = await runTenantProvisioning(deps, request);

    assert.equal(tenant.status, "active");
    assert.deepEqual(events, ["create", "schema", "manifest", "activate"]);
  });

  it("works with deps that have no rollback hook (older callers)", async () => {
    const { deps, events } = setup({
      provisionTenantSchema: async () => {
        throw new Error("boom");
      },
      rollbackTenant: undefined,
    });

    await assert.rejects(() => runTenantProvisioning(deps, request), /boom/);

    assert.deepEqual(events, ["create", "fail"]);
  });
});

describe("rollbackProvisioning", () => {
  it("drops this tenant's schema and purges only its storage prefix", async () => {
    const dropped: string[] = [];
    const purged: string[] = [];

    await rollbackProvisioning(
      { id: TENANT_ID, schemaName: record.schemaName },
      {
        dropSchema: async (name) => {
          dropped.push(name);
        },
        purgeStorage: async (prefix) => {
          purged.push(prefix);
        },
      }
    );

    assert.deepEqual(dropped, [record.schemaName]);
    assert.deepEqual(purged, [`tenant-${TENANT_ID}`]);
  });

  it("still purges storage when dropping the schema fails, then reports both problems", async () => {
    const purged: string[] = [];

    await assert.rejects(
      rollbackProvisioning(
        { id: TENANT_ID, schemaName: record.schemaName },
        {
          dropSchema: async () => {
            throw new Error("schema locked");
          },
          purgeStorage: async (prefix) => {
            purged.push(prefix);
          },
        }
      ),
      (error: unknown) =>
        error instanceof AggregateError &&
        /incomplete/.test(error.message) &&
        error.errors.length === 1
    );

    assert.equal(purged.length, 1);
  });
});
