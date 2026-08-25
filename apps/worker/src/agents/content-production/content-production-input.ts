import { z } from "zod";

export const contentProductionInputSchema =
  z.object({
    tenantId: z.string().uuid(),
  });

export type ContentProductionInput =
  z.infer<
    typeof contentProductionInputSchema
  >;
