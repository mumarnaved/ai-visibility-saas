import { z } from "zod";

export const technicalAuditInputSchema = z.object({
  tenantId: z.string().uuid(),
  websiteUrl: z.string().url(),
});

export type TechnicalAuditInput =
  z.infer<typeof technicalAuditInputSchema>;