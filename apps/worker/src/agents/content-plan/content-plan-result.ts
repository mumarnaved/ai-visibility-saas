export type ContentPlanUrgency =
  | "critical"
  | "warning"
  | "good";

export interface PrioritizedFixItem {
  rank: number;
  category: string;
  score: number;
  status: ContentPlanUrgency;
  summary: string;
}

export interface ContentGapItem {
  area: string;
  score: number;
  status: ContentPlanUrgency;
  gap: string;
}

export interface EntitySchemaPlanItem {
  area: string;
  score: number;
  status: ContentPlanUrgency;
  plan: string;
}

export interface ContentPlanRoadmap {
  day30: PrioritizedFixItem[];
  day60: PrioritizedFixItem[];
  day90: PrioritizedFixItem[];
  immediatePriorities: string[];
}

export interface ContentPlanAgentResult {
  tenantId: string;
  schemaName: string;

  auditReportId: string;
  auditReportGeneratedAt: string;

  summary: string;

  prioritizedFixList: PrioritizedFixItem[];

  contentGapMap: ContentGapItem[];

  entitySchemaPlan: EntitySchemaPlanItem[];

  roadmap: ContentPlanRoadmap;

  generatedAt: string;
}
