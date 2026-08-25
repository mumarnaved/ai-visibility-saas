import "dotenv/config";

import { validateTenantContext } from "agent-contracts";

import { Orchestrator } from "./orchestrator.js";
import { ContentEntityAuditAgent } from "../agents/content-entity/index.js";

const tenantId = "79ab8279-9a49-4ece-a868-a1166e3f9fdf";

const tenantContext = validateTenantContext({
  tenantId,
  schema: `tenant_${tenantId.replace(/-/g, "")}`,
  storagePrefix: `tenants/${tenantId}`,
  credentialNamespace: tenantId,
  vectorNamespace: tenantId,
});

const orchestrator = new Orchestrator();

orchestrator.registerAgent(
  new ContentEntityAuditAgent()
);

const result = await orchestrator.execute(
  "content-entity-audit",
  tenantContext,
  {
    tenantId,
    websiteUrl: "https://softwaredome.com/",
  }
);

console.log("Content Entity Audit Orchestrator result:");
console.log(JSON.stringify(result, null, 2));