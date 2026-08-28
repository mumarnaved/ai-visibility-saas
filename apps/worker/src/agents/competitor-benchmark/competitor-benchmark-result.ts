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

  /*
   * Explains what could/couldn't be derived
   * from SerpApi's free tier for this
   * competitor (e.g. why domainAuthority/
   * estimatedTraffic/backlinks stayed null,
   * or that organicKeywords is an indexed-
   * page estimate rather than a verified
   * keyword count).
   */
  dataNotes: string[];
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
    dataNotes: string[];
  };

  priorityGaps: string[];

  recommendations: string[];

  summary: string;

  generatedAt: string;

  createdAt: string;
}