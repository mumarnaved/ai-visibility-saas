import { z } from "zod";

export const technicalFixInputSchema =
  z.object({
    tenantId: z.string().uuid(),
  });

export type TechnicalFixInput =
  z.infer<
    typeof technicalFixInputSchema
  >;
