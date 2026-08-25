export interface CompetitorBenchmarkMetric {
  competitor: string;
  websiteUrl: string | null;

  domainAuthority: number | null;
  organicKeywords: number | null;
  estimatedTraffic: number | null;
  backlinks: number | null;

  structuralScore: number | null;
  contentScore: number | null;

  strengths: string[];
  gaps: string[];
}

export interface CompetitorBenchmarkResult {
  tenantId: string;

  /*
   * Added so this result matches the shape of
   * TechnicalAuditResult / ContentEntityAuditResult /
   * CitationVisibilityAuditResult, and so it can be
   * persisted and looked up the same way.
   */
  schemaName: string;
  id: string;
  status: "completed";
  score: number;

  websiteUrl: string;

  brandName: string;

  competitors: CompetitorBenchmarkMetric[];

  tenantBaseline: {
    domainAuthority: number | null;
    organicKeywords: number | null;
    estimatedTraffic: number | null;
    backlinks: number | null;
    structuralScore: number | null;
    contentScore: number | null;
  };

  priorityGaps: string[];

  recommendations: string[];

  summary: string;

  generatedAt: string;

  createdAt: string;
}