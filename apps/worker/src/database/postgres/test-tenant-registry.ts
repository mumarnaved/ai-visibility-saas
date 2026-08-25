import "dotenv/config";

import { createTenantRecord } from "./tenant-registry.js";

try {
  const tenant = await createTenantRecord(
    "Registry Test Company",
    `registry-test-${Date.now()}`,
    "https://example.com"
  );

  console.log("Tenant registry test: OK");
  console.log(tenant);
} catch (error) {
  console.error("Tenant registry test: FAILED");

  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
}