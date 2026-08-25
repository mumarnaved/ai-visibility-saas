export interface AgentOutput<TData = unknown> {
  success: boolean;
  data?: TData;
  error?: string;
  metadata?: Record<string, unknown>;
}