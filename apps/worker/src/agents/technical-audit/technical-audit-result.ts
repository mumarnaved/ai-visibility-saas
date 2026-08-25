export interface TechnicalAuditFinding {
  category: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  title: string;
  description: string;
  recommendation: string;
}

export interface TechnicalAuditResult {
  tenantId: string;
  schemaName: string;

  id: string;

  websiteUrl: string;
  finalUrl: string;

  status: "completed";

  score: number;

  summary: string;

  findings: TechnicalAuditFinding[];

  crawlData: {
    finalUrl: string;
    statusCode: number;
    contentType: string;
    https: boolean;
    redirected: boolean;

    title: string | null;
    description: string | null;

    headings: {
      h1: string[];
      h2: string[];
      h3: string[];
    };

    links: {
      total: number;
      internal: number;
      external: number;
    };

    images: {
      total: number;
      withAlt: number;
      withoutAlt: number;
    };

    wordCount: number;
  };

  seoData: {
    hasTitle: boolean;
    titleLength: number;

    hasDescription: boolean;
    descriptionLength: number;

    h1Count: number;

    imagesWithoutAlt: number;

    robotsTxtAvailable: boolean;
    sitemapAvailable: boolean;

    serverHeaders: Record<string, string>;
  };

  createdAt: string;
}