export type CitationVisibilitySeverity =
  | "critical"
  | "high"
  | "medium"
  | "low";

export interface CitationVisibilityFinding {
  category: string;
  severity: CitationVisibilitySeverity;
  title: string;
  description: string;
  recommendation: string;
}

export interface CitationVisibilityQueryResult {
  query: string;
  category: string | null;

  provider: string;
  model: string | null;

  response: string;

  brandMentioned: boolean;
  brandPosition: number | null;

  citations: Array<{
    url: string;
    title: string;
  }>;

  competitors: string[];
}

export interface CitationVisibilityAuditResult {
  tenantId: string;
  schemaName: string;

  id: string;

  websiteUrl: string;
  status: "completed";

  score: number;
  summary: string;

  queries: CitationVisibilityQueryResult[];

  citations: Array<{
    url: string;
    title: string;
    query: string;
  }>;

  visibilityFindings: CitationVisibilityFinding[];

  recommendations: string[];

  createdAt: string;
}