import { z } from "zod";

export const reportGenerationInputSchema =
  z.object({
    tenantId: z.string().uuid(),
  });

export type ReportGenerationInput =
  z.infer<
    typeof reportGenerationInputSchema
  >;
