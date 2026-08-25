import { z } from "zod";

export const tenantContextSchema = z.object({
  tenantId: z.string().min(1),
  schema: z.string().min(1),
  storagePrefix: z.string().min(1),
  credentialNamespace: z.string().min(1),
  vectorNamespace: z.string().min(1),
});

export type TenantContext = z.infer<typeof tenantContextSchema>;

export function validateTenantContext(
  context: unknown
): TenantContext {
  return tenantContextSchema.parse(context);
}