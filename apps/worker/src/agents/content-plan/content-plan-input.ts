import { z } from "zod";

export const contentPlanInputSchema = z.object({
  tenantId: z.string().uuid(),
});

export type ContentPlanInput =
  z.infer<typeof contentPlanInputSchema>;
