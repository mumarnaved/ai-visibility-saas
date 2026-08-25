import "dotenv/config";

import {
  TechnicalAuditAgent,
} from "./technical-audit-agent.js";

const agent =
  new TechnicalAuditAgent();

const tenantId =
  "79ab8279-9a49-4ece-a868-a1166e3f9fdf";

const schema =
  "tenant_79ab82799a494ecea868a1166e3f9fdf";

const result =
  await agent.execute({
    tenantContext: {
      tenantId,
      schema,
      storagePrefix:
        `${schema}/`,
      credentialNamespace:
        schema,
      vectorNamespace:
        schema,
    },

    payload: {
      tenantId,
      websiteUrl:
        "https://softwaredome.com",
    },
  });

console.log(
  JSON.stringify(
    result,
    null,
    2
  )
);