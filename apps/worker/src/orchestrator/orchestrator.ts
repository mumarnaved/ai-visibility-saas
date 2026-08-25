import type {
  Agent,
  AgentInput,
  AgentOutput,
  TenantContext,
} from "agent-contracts";

/* ========================================
   ORCHESTRATOR
======================================== */

export class Orchestrator {
  private readonly agents =
    new Map<string, Agent>();

  /* ========================================
     REGISTER AGENT
  ======================================== */

  registerAgent(agent: Agent): void {
    if (
      this.agents.has(agent.name)
    ) {
      throw new Error(
        `Agent "${agent.name}" is already registered.`
      );
    }

    this.agents.set(
      agent.name,
      agent
    );
  }

  /* ========================================
     GET AGENT
  ======================================== */

  getAgent(name: string): Agent {
    const agent =
      this.agents.get(name);

    if (!agent) {
      throw new Error(
        `Agent "${name}" is not registered.`
      );
    }

    return agent;
  }

  /* ========================================
     EXECUTE SINGLE AGENT
  ======================================== */

  async execute(
    agentName: string,
    tenantContext: TenantContext,
    payload: unknown
  ): Promise<AgentOutput> {
    const agent =
      this.getAgent(agentName);

    const input: AgentInput = {
      tenantContext,
      payload,
    };

    return agent.execute(input);
  }
}