export interface MonitoringInsight {
  type: string;
  message: string;
}

export interface MonitoringAgentResult {
  tenantId: string;
  schemaName: string;

  snapshotId: string;
  snapshotDate: string;

  visibilityScore: number | null;
  citationScore: number | null;
  technicalScore: number | null;
  contentScore: number | null;
  competitorScore: number | null;

  publishedTaskCount: number;

  insights: MonitoringInsight[];

  generatedAt: string;
}
