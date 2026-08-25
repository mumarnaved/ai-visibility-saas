import type { TenantContext } from "../tenant/tenant-context.js";

export interface AgentInput<TPayload = unknown> {
  tenantContext: TenantContext;
  payload: TPayload;
}