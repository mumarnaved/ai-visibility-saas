export interface ScoreDelta {
  current: number | null;
  previous: number | null;
  delta: number | null;
}

export interface AuditDeltas {
  overallScore: ScoreDelta;
  technicalSeoScore: ScoreDelta;
  contentQualityScore: ScoreDelta;
  aioReadinessScore: ScoreDelta;
  geoCitationScore: ScoreDelta;
  competitorGapScore: ScoreDelta;
}

export interface PlanProgress {
  hasPlan: boolean;
  approvalStatus: string | null;
  totalTasks: number;
  tasksByStatus: Record<string, number>;
  tasksByApproval: Record<string, number>;
}

export interface ReportGenerationAgentResult {
  tenantId: string;
  schemaName: string;

  reportId: string;

  periodStart: string;
  periodEnd: string;

  summary: string;

  auditDeltas: AuditDeltas;
  planProgress: PlanProgress;
  trafficTrend: unknown;

  recommendations: string[];

  generatedAt: string;
}
