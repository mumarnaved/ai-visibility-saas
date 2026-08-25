import { z } from "zod";

export const provisioningInputSchema = z.object({
  tenantId: z.string().min(1),
  tenantName: z.string().min(1),
  slug: z.string().min(1),
});

export type ProvisioningInput = z.infer<
  typeof provisioningInputSchema
>;