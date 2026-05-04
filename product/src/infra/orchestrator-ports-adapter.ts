/**
 * Concrete implementations of the domain port interfaces (coderclaw/ports.ts).
 *
 * These adapters live in the infra layer and are injected into AgentOrchestrator
 * at gateway startup. The domain layer never imports this file — the gateway
 * (server-startup.ts) wires everything together.
 */

import type {
  IAgentMemoryService,
  ILocalResultBroker,
  ITelemetryService,
} from "../coderclaw/ports.js";
import { awaitLocalSubagentResult } from "./local-result-broker.js";
import { getSsmMemoryService } from "./ssm-memory-service.js";
import {
  emitTaskEnd,
  emitTaskStart,
  emitWorkflowEnd,
  emitWorkflowStart,
  initTelemetry,
} from "./workflow-telemetry.js";

// ── Telemetry adapter ─────────────────────────────────────────────────────────

export class WorkflowTelemetryAdapter implements ITelemetryService {
  init(opts: {
    projectRoot: string;
    clawId?: string | null;
    linkApiUrl?: string | null;
    linkApiKey?: string | null;
  }): void {
    initTelemetry(opts);
  }

  emitWorkflowStart(workflowId: string, description?: string): void {
    emitWorkflowStart(workflowId, description);
  }

  emitWorkflowEnd(workflowId: string, failed: boolean): void {
    emitWorkflowEnd(workflowId, failed);
  }

  emitTaskStart(
    workflowId: string,
    taskId: string,
    agentRole: string,
    description: string,
  ): void {
    emitTaskStart(workflowId, taskId, agentRole, description);
  }

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
  ): void {
    emitTaskEnd(workflowId, taskId, agentRole, startedAt, error, metrics);
  }
}

// ── Memory adapter ────────────────────────────────────────────────────────────

export class SsmMemoryAdapter implements IAgentMemoryService {
  async buildTeamMemoryContext(): Promise<string> {
    return getSsmMemoryService()?.buildTeamMemoryContext() ?? Promise.resolve("");
  }

  async recallSimilar(
    query: string,
    limit: number,
  ): Promise<Array<{ key: string; content: string }>> {
    return getSsmMemoryService()?.recallSimilar(query, limit) ?? Promise.resolve([]);
  }
}

// ── Local result broker adapter ───────────────────────────────────────────────

export class LocalResultBrokerAdapter implements ILocalResultBroker {
  async awaitResult(
    runId: string,
    childSessionKey: string,
    timeoutMs: number,
  ): Promise<string> {
    return awaitLocalSubagentResult(runId, childSessionKey, timeoutMs);
  }
}
