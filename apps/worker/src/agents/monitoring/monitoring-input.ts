import { z } from "zod";

export const monitoringInputSchema =
  z.object({
    tenantId: z.string().uuid(),
  });

export type MonitoringInput =
  z.infer<
    typeof monitoringInputSchema
  >;
