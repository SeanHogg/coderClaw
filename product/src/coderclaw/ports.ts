/**
 * Domain port interfaces — abstractions the orchestrator depends on.
 *
 * These interfaces live in the domain layer (coderclaw/) so the orchestrator
 * has zero direct imports from infra/. Concrete adapters in infra/ implement
 * them and are injected at gateway startup (server-startup.ts).
 *
 * Port taxonomy (Hexagonal Architecture):
 *   - ITelemetryService  — emit workflow/task lifecycle spans
 *   - IAgentMemoryService — recall similar memories, build team memory context
 *   - IAgentTransport — unified discover + dispatch for local/remote claws
 *   - ILocalResultBroker — await results from locally-spawned subagents
 */

// ── Telemetry ─────────────────────────────────────────────────────────────────

export interface ITelemetryService {
  init(opts: {
    projectRoot: string;
    clawId?: string | null;
    linkApiUrl?: string | null;
    linkApiKey?: string | null;
  }): void;
  emitWorkflowStart(workflowId: string, description?: string): void;
  emitWorkflowEnd(workflowId: string, failed: boolean): void;
  emitTaskStart(workflowId: string, taskId: string, agentRole: string, description: string): void;
  emitTaskEnd(
    workflowId: string,
    taskId: string,
    agentRole: string,
    startedAt: Date,
    error?: string,
    metrics?: {
      model?: string;
      inputTokens?: number;
      outputTokens?: number;
      estimatedCostUsd?: number;
    },
  ): void;
}

// ── Memory ────────────────────────────────────────────────────────────────────

export interface IAgentMemoryService {
  buildTeamMemoryContext(): Promise<string>;
  recallSimilar(query: string, limit: number): Promise<Array<{ key: string; content: string }>>;
}

// ── Agent transport (unified local + remote dispatch) ─────────────────────────

export type AgentTransportKind = "local" | "remote";

export interface AgentTransportEntry {
  id: string;
  name: string;
  online: boolean;
  capabilities: string[];
  kind: AgentTransportKind;
}

export interface AgentTransportDispatchPayload {
  target: string;
  input: string;
  requiredCapabilities?: string[];
  correlationId?: string;
  callbackClawId?: string;
  timeoutMs?: number;
}

export type AgentTransportDispatchResult =
  | { status: "accepted"; targetId: string; output?: string; childSessionKey?: string }
  | { status: "failed"; error: string; targetId?: string };

/** Unified transport interface for local + remote claw dispatch. */
export interface IAgentTransport {
  discover(requiredCapabilities?: string[]): Promise<AgentTransportEntry[]>;
  dispatch(payload: AgentTransportDispatchPayload): Promise<AgentTransportDispatchResult>;
  register?(entry: AgentTransportEntry): Promise<void> | void;
}

// ── Local result broker ───────────────────────────────────────────────────────

export interface ILocalResultBroker {
  awaitResult(runId: string, childSessionKey: string, timeoutMs: number): Promise<string>;
}
