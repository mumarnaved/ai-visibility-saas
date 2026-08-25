export interface AppliedFixSummary {
  executionTaskId: string;
  taskType: "entity_fix" | "technical_fix";
  title: string;
  success: boolean;
}

export interface TechnicalFixAgentResult {
  tenantId: string;
  schemaName: string;

  contentPlanId: string;

  fixes: AppliedFixSummary[];

  generatedAt: string;
}
