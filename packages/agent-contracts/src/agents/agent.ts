import type { AgentInput } from "./agent-input.js";
import type { AgentOutput } from "./agent-output.js";

export interface Agent<TPayload = unknown, TResult = unknown> {
  name: string;

  execute(
    input: AgentInput<TPayload>
  ): Promise<AgentOutput<TResult>>;
}