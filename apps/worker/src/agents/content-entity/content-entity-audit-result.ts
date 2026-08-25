export interface ContentEntityFinding {
  category: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  title: string;
  description: string;
  recommendation: string;
}

export interface ContentEntityAuditResult {
  tenantId: string;
  schemaName: string;

  id: string;

  websiteUrl: string;
  status: "completed";

  score: number;

  summary: string;

  contentFindings: ContentEntityFinding[];

  entityFindings: ContentEntityFinding[];

  recommendations: string[];

  contentData: {
    title: string | null;
    description: string | null;

    headings: {
      h1: string[];
      h2: string[];
      h3: string[];
    };

    wordCount: number;

    links: {
      total: number;
      internal: number;
      external: number;
    };
  };

  entityData: {
    titleSignals: string[];
    headingSignals: string[];
    topicSignals: string[];
  };

  createdAt: string;
}