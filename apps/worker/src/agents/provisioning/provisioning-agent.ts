import type {
  Agent,
  AgentInput,
  AgentOutput,
} from "agent-contracts";

import {
  validateTenantContext,
} from "agent-contracts";

import {
  buildTenantManifest,
  type TenantManifest,
} from "../../context/tenant-manifest.js";

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

import {
  persistTenantManifestWithCopy,
} from "../../database/postgres/tenant-manifest-service.js";

export interface ProvisioningAgentDeps {
  provisionSchema(
    schemaName: string
  ): Promise<void>;

  persistManifest(
    manifest: TenantManifest
  ): Promise<TenantManifest>;
}

const defaultDeps: ProvisioningAgentDeps = {
  provisionSchema: provisionTenantSchema,
  persistManifest: persistTenantManifestWithCopy,
};

export class ProvisioningAgent
  implements Agent<ProvisioningInput, ProvisioningResult>
{
  readonly name = "provisioning";

  constructor(
    private readonly deps: ProvisioningAgentDeps = defaultDeps
  ) {}

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

      /*
       * The manifest records the namespaces the
       * platform actually uses. A context that
       * disagrees would make the manifest and the
       * context describe different systems, so
       * refuse before creating anything.
       */
      const manifest = buildTenantManifest({
        id: tenantContext.tenantId,
        schemaName,
      });

      for (const key of [
        "storagePrefix",
        "credentialNamespace",
        "vectorNamespace",
      ] as const) {
        if (tenantContext[key] !== manifest[key]) {
          throw new Error(
            `Tenant context ${key} "${tenantContext[key]}" does not match the platform convention "${manifest[key]}".`
          );
        }
      }

      await this.deps.provisionSchema(schemaName);

      const persisted =
        await this.deps.persistManifest(manifest);

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
          manifest: persisted,
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
