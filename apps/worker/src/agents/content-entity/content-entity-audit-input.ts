import { z } from "zod";

export const contentEntityAuditInputSchema = z.object({
  tenantId: z.string().uuid(),
  websiteUrl: z.string().url(),
});

export type ContentEntityAuditInput =
  z.infer<typeof contentEntityAuditInputSchema>;