import { z } from "zod";

export const publishingInputSchema =
  z.object({
    tenantId: z.string().uuid(),
    executionTaskId: z.string().uuid(),
  });

export type PublishingInput =
  z.infer<typeof publishingInputSchema>;
