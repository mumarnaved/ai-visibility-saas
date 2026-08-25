import type {
  Agent,
  AgentInput,
  AgentOutput,
} from "agent-contracts";

import {
  validateTenantContext,
} from "agent-contracts";

import {
  provisioningInputSchema,
  type ProvisioningInput,
} from "./provisioning-input.js";

import type {
  ProvisioningResult,
} from "./provisioning-result.js";

import {
  provisionTenantSchema,
} from "../../database/postgres/tenant-schema-provisioner.js";

export class ProvisioningAgent
  implements Agent<ProvisioningInput, ProvisioningResult>
{
  readonly name = "provisioning";

  async execute(
    input: AgentInput<ProvisioningInput>
  ): Promise<AgentOutput<ProvisioningResult>> {
    try {
      const tenantContext = validateTenantContext(
        input.tenantContext
      );

      const provisioningInput =
        provisioningInputSchema.parse(input.payload);

      if (
        tenantContext.tenantId !==
        provisioningInput.tenantId
      ) {
        throw new Error(
          "Tenant context does not match provisioning input."
        );
      }

      const schemaName = tenantContext.schema;

      await provisionTenantSchema(schemaName);

      return {
        success: true,
        data: {
          tenantId: provisioningInput.tenantId,
          schemaName,
          storagePrefix:
            tenantContext.storagePrefix,
          credentialNamespace:
            tenantContext.credentialNamespace,
          vectorNamespace:
            tenantContext.vectorNamespace,
        },
        metadata: {
          agent: this.name,
          operation: "provision",
        },
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Provisioning failed.",
        metadata: {
          agent: this.name,
          operation: "provision",
        },
      };
    }
  }
}