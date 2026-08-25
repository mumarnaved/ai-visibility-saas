import { z } from "zod";

export const auditAggregatorInputSchema =
  z.object({
    tenantId: z.string().uuid(),

    websiteUrl: z.string().url(),

    brandName: z.string().min(1),

    technicalAudit: z.record(
      z.string(),
      z.unknown()
    ),

    contentEntityAudit: z.record(
      z.string(),
      z.unknown()
    ),

    citationVisibilityAudit: z.record(
      z.string(),
      z.unknown()
    ),

    competitorBenchmark: z.record(
      z.string(),
      z.unknown()
    ),
  });

export type AuditAggregatorInput =
  z.infer<
    typeof auditAggregatorInputSchema
  >;