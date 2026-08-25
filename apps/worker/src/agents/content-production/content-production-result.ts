export interface ContentDraftFaqItem {
  question: string;
  answer: string;
}

export interface ContentDraft {
  title: string;
  body: string;
  metaTitle: string;
  metaDescription: string;
  faq: ContentDraftFaqItem[];
}

export interface ContentProductionTaskSummary {
  executionTaskId: string;
  gapArea: string;
  title: string;
}

export interface ContentProductionAgentResult {
  tenantId: string;
  schemaName: string;

  contentPlanId: string;

  tasks: ContentProductionTaskSummary[];

  generatedAt: string;
}
