import "dotenv/config";

import {
  ContentEntityAuditAgent,
} from "./content-entity-audit-agent.js";

const tenantId =
  "79ab8279-9a49-4ece-a868-a1166e3f9fdf";

const schemaName =
  "tenant_79ab82799a494ecea868a1166e3f9fdf";

const agent =
  new ContentEntityAuditAgent();

const result =
  await agent.execute({
    tenantContext: {
      tenantId,

      schema:
        schemaName,

      storagePrefix:
        `tenants/${tenantId}`,

      credentialNamespace:
        `tenant:${tenantId}:credentials`,

      vectorNamespace:
        `tenant:${tenantId}:vectors`,
    },

    payload: {
      tenantId,

      websiteUrl:
        "https://softwaredome.com/",
    },
  });

console.log(
  JSON.stringify(
    result,
    null,
    2
  )
);