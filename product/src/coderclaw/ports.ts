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
 *   - IRemoteAgentDispatcher — dispatch tasks to peer claws
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
  emitTaskStart(
    workflowId: string,
    taskId: string,
    agentRole: string,
    description: string,
  ): void;
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

// ── Remote dispatch ───────────────────────────────────────────────────────────

export type RemoteDispatchResult = { status: "accepted"; error?: undefined } | { status: "failed"; error?: string };

export interface IRemoteAgentDispatcher {
  /** The local claw ID used as the callback address for remote result delivery. */
  readonly myClawId: string;
  selectByCapability(requiredCaps: string[]): Promise<{ id: number; name: string } | null>;
  dispatch(
    targetClawId: string,
    input: string,
    opts: { correlationId: string; callbackClawId: string },
  ): Promise<RemoteDispatchResult>;
  awaitResult(correlationId: string, timeoutMs: number): Promise<string>;
}

// ── Local result broker ───────────────────────────────────────────────────────

export interface ILocalResultBroker {
  awaitResult(runId: string, childSessionKey: string, timeoutMs: number): Promise<string>;
}
