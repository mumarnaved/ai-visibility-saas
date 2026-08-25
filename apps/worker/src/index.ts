import "dotenv/config";

import {
  validateTenantContext,
} from "agent-contracts";

import {
  Orchestrator,
} from "./orchestrator/orchestrator.js";

import {
  ProvisioningAgent,
} from "./agents/provisioning/index.js";

import {
  TechnicalAuditAgent,
} from "./agents/technical-audit/index.js";

import {
  ContentEntityAuditAgent,
} from "./agents/content-entity/index.js";

import {
  CitationVisibilityAuditAgent,
} from "./agents/citation-visibility/index.js";

import {
  CompetitorBenchmarkAgent,
} from "./agents/competitor-benchmark/index.js";

import {
  AuditAggregatorAgent,
} from "./agents/audit-aggregator/index.js";

/* ========================================
   TENANT CONTEXT
======================================== */

const tenantContext =
  validateTenantContext({
    tenantId:
      "tenant_example",

    schema:
      "tenant_example",

    storagePrefix:
      "tenants/tenant_example",

    credentialNamespace:
      "tenant_example",

    vectorNamespace:
      "tenant_example",
  });

/* ========================================
   ORCHESTRATOR
======================================== */

const orchestrator =
  new Orchestrator();

/* ========================================
   REGISTER EXISTING AGENTS
======================================== */

orchestrator.registerAgent(
  new ProvisioningAgent()
);

orchestrator.registerAgent(
  new TechnicalAuditAgent()
);

orchestrator.registerAgent(
  new ContentEntityAuditAgent()
);

/* ========================================
   REGISTER STAGE 1 AGENTS
======================================== */

orchestrator.registerAgent(
  new CitationVisibilityAuditAgent()
);

orchestrator.registerAgent(
  new CompetitorBenchmarkAgent()
);

orchestrator.registerAgent(
  new AuditAggregatorAgent()
);

/* ========================================
   PROVISIONING TEST
======================================== */

const provisioningResult =
  await orchestrator.execute(
    "provisioning",
    tenantContext,
    {
      tenantId:
        "tenant_example",

      tenantName:
        "Example Tenant",

      slug:
        "example-tenant",
    }
  );

console.log(
  "Provisioning result:"
);

console.log(
  provisioningResult
);

/* ========================================
   REGISTERED AGENTS
======================================== */

console.log(
  "Registered agents:"
);

console.log(
  orchestrator
    .getAgent("provisioning")
    .name
);

console.log(
  orchestrator
    .getAgent("technical-audit")
    .name
);

console.log(
  orchestrator
    .getAgent("content-entity-audit")
    .name
);

console.log(
  orchestrator
    .getAgent("citation-visibility-audit")
    .name
);

console.log(
  orchestrator
    .getAgent("competitor-benchmark")
    .name
);

console.log(
  orchestrator
    .getAgent("audit-aggregator")
    .name
);