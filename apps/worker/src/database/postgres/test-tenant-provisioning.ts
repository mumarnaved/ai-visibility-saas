import "dotenv/config";

import { provisionTenant } from "./tenant-provisioning.js";

try {
  const tenant = await provisionTenant({
    name: "Provisioning Test Company",
    slug: `provisioning-test-${Date.now()}`,
    websiteUrl: "https://example.com",
  });

  console.log("Tenant provisioning test: OK");
  console.log(tenant);
} catch (error) {
  console.error("Tenant provisioning test: FAILED");

  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
}