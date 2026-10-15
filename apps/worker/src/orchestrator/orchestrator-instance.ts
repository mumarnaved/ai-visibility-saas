import { pool } from "../database/postgres/connection.js";
import { assertTenantStillUsable } from "../context/tenant-context-instance.js";

import { TechnicalAuditAgent } from "../agents/technical-audit/technical-audit-agent.js";
import { ContentEntityAuditAgent } from "../agents/content-entity/content-entity-audit-agent.js";
import { CitationVisibilityAuditAgent } from "../agents/citation-visibility/citation-visibility-audit-agent.js";
import { CompetitorBenchmarkAgent } from "../agents/competitor-benchmark/competitor-benchmark-agent.js";
import { AuditAggregatorAgent } from "../agents/audit-aggregator/audit-aggregator-agent.js";
import { ContentPlanAgent } from "../agents/content-plan/content-plan-agent.js";
import { ContentProductionAgent } from "../agents/content-production/content-production-agent.js";
import { TechnicalFixAgent } from "../agents/technical-fix/technical-fix-agent.js";
import { MonitoringAgent } from "../agents/monitoring/monitoring-agent.js";
import { ReportGenerationAgent } from "../agents/report-generation/report-generation-agent.js";
import { PublishingAgent } from "../agents/publishing/publishing-agent.js";

import { createAgentRunStore } from "./agent-run-store.js";
import { Orchestrator } from "./orchestrator.js";

/* ========================================
   THE SHARED ORCHESTRATOR

   Bound to the real pool and tenant check, with every agent a
   route or job can run registered under its own name. Routes
   and job handlers import this; nothing else calls an agent's
   execute() directly.

   (Provisioning is not registered: it runs before a tenant is
   active, so there is no usable tenant context for it.)
======================================== */

const db = {
  query: (sql: string, params?: unknown[]) =>
    pool.query(sql, params),
};

export const orchestrator = new Orchestrator({
  store: createAgentRunStore(db),
  assertTenantUsable: assertTenantStillUsable,
});

for (const agent of [
  new TechnicalAuditAgent(),
  new ContentEntityAuditAgent(),
  new CitationVisibilityAuditAgent(),
  new CompetitorBenchmarkAgent(),
  new AuditAggregatorAgent(),
  new ContentPlanAgent(),
  new ContentProductionAgent(),
  new TechnicalFixAgent(),
  new MonitoringAgent(),
  new ReportGenerationAgent(),
  new PublishingAgent(),
]) {
  orchestrator.registerAgent(agent as never);
}
