import "dotenv/config";

import { validateTenantContext } from "agent-contracts";

import { Orchestrator } from "./orchestrator.js";
import { TechnicalAuditAgent } from "../agents/technical-audit/index.js";

const tenantId = "79ab8279-9a49-4ece-a868-a1166e3f9fdf";

const tenantContext = validateTenantContext({
  tenantId,
  schema: "tenant_79ab82799a494ecea868a1166e3f9fdf",
  storagePrefix: `tenants/${tenantId}`,
  credentialNamespace: tenantId,
  vectorNamespace: tenantId,
});

const orchestrator = new Orchestrator();

orchestrator.registerAgent(
  new TechnicalAuditAgent()
);

const result = await orchestrator.execute(
  "technical-audit",
  tenantContext,
  {
    tenantId,
    websiteUrl: "https://softwaredome.com/",
  }
);

console.log("Technical Audit Orchestrator result:");
console.log(JSON.stringify(result, null, 2));