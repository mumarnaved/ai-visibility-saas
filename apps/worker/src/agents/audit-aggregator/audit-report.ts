export interface AuditCategoryScore {
  score: number;
  status: "excellent" | "good" | "needs-improvement" | "critical";
  summary: string;
}

export interface AuditReport {
  tenantId: string;
  websiteUrl: string;
  brandName: string;

  scores: {
    technicalSEO: AuditCategoryScore;
    contentQuality: AuditCategoryScore;
    aioReadiness: AuditCategoryScore;
    geoCitationStatus: AuditCategoryScore;
    competitorGap: AuditCategoryScore;
    overall: number;
  };

  summary: string;

  priorities: string[];

  sourceAudits: {
    technical: unknown;
    contentEntity: unknown;
    citationVisibility: unknown;
    competitorBenchmark: unknown;
  };

  generatedAt: string;
}