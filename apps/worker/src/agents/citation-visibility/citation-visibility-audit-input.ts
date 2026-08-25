import { z } from "zod";

export const citationVisibilityAuditInputSchema =
  z.object({
    tenantId: z.string().uuid(),

    websiteUrl: z.string().url(),

    brandName: z.string().min(1),

    queries: z
      .array(
        z.object({
          query: z.string().min(1),

          category:
            z.string().nullable().optional(),
        })
      )
      .min(1),
  });

export type CitationVisibilityAuditInput =
  z.infer<
    typeof citationVisibilityAuditInputSchema
  >;