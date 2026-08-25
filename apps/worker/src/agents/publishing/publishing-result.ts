export interface PublishingAgentResult {
  tenantId: string;
  schemaName: string;

  executionTaskId: string;
  publishLogId: string;

  success: boolean;
  url: string | null;
  externalId: string | null;

  publishedAt: string;
}
