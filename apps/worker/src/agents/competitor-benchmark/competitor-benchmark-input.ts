import { z } from "zod";

export const competitorBenchmarkInputSchema =
  z.object({
    tenantId: z.string().uuid(),

    websiteUrl: z.string().url(),

    brandName: z.string().min(1),

    competitors: z
      .array(
        z.object({
          name: z.string().min(1),
          websiteUrl: z.string().url().optional(),
        })
      )
      .min(1)
      .max(5),
  });

export type CompetitorBenchmarkInput =
  z.infer<
    typeof competitorBenchmarkInputSchema
  >;