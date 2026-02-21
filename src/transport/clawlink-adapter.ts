/**
 * ClawLink transport adapter
 *
 * Connects CoderClaw's orchestration engine to a running CoderClawLink
 * instance (https://github.com/SeanHogg/coderClawLink) over its Phase 2
 * HTTP runtime API.  Both sides share the same transport abstraction
 * contract, so CoderClaw can delegate task execution to CoderClawLink
 * seamlessly — local agents and remote ClawLink agents are interchangeable.
 *
 * CoderClawLink API surface used here:
 *   POST   /api/runtime/sessions
 *   POST   /api/runtime/tasks/submit
 *   GET    /api/runtime/tasks/{task_id}/state
 *   POST   /api/runtime/tasks/{task_id}/cancel
 *   GET    /api/runtime/agents
 *   GET    /api/runtime/skills
 */

import type {
  AgentInfo,
  ClawLinkConfig,
  SkillInfo,
  TaskState,
  TaskSubmitRequest,
  TaskStatus,
  TaskUpdateEvent,
  TransportAdapter,
} from "./types.js";

// ---------------------------------------------------------------------------
// ClawLink API response shapes (as documented in coderClawLink/app/api/runtime.py)
// ---------------------------------------------------------------------------

type ClawLinkSessionResponse = {
  session_id: string;
  user_id: string | null;
  created_at: string;
  last_activity: string;
  permissions: string[];
};

type ClawLinkTaskStateResponse = {
  task_id: string;
  execution_uuid: string;
  state: TaskStatus; // enum values are identical to CoderClaw's TaskStatus
  success: boolean;
  result?: unknown;
  error?: string | null;
  execution_time?: number | null;
  metadata?: Record<string, unknown> | null;
};

type ClawLinkAgentResponse = {
  agent_type: string;
  name: string;
  description?: string | null;
  available: boolean;
  capabilities?: string[] | null;
  metadata?: Record<string, unknown> | null;
};

type ClawLinkSkillResponse = {
  skill_id: string;
  name: string;
  description?: string | null;
  required_permissions?: string[] | null;
  metadata?: Record<string, unknown> | null;
};

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/**
 * Transport adapter that delegates execution to a CoderClawLink node.
 *
 * Usage:
 * ```ts
 * import { ClawLinkTransportAdapter } from "./transport/clawlink-adapter.js";
 * import { CoderClawRuntime } from "./transport/runtime.js";
 *
 * const adapter = new ClawLinkTransportAdapter({ baseUrl: "http://localhost:8000" });
 * await adapter.connect();               // creates a session on the ClawLink node
 * const runtime = new CoderClawRuntime(adapter, "remote-enabled");
 * ```
 */
export class ClawLinkTransportAdapter implements TransportAdapter {
  private readonly baseUrl: string;
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly userId: string | undefined;
  private readonly deviceId: string | undefined;

  /** Session ID returned by ClawLink after connect() */
  private sessionId: string | undefined;

  constructor(config: ClawLinkConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.pollIntervalMs = config.pollIntervalMs ?? 1000;
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.userId = config.userId;
    this.deviceId = config.deviceId;
  }

  /**
   * Create a session on the ClawLink node. Call this before submitting tasks.
   * Safe to call multiple times — subsequent calls are no-ops if already connected.
   */
  async connect(): Promise<void> {
    if (this.sessionId) {
      return;
    }

    const params = new URLSearchParams();
    if (this.userId) {
      params.set("user_id", this.userId);
    }
    if (this.deviceId) {
      params.set("device_id", this.deviceId);
    }

    const url = `${this.baseUrl}/api/runtime/sessions${params.size > 0 ? `?${params}` : ""}`;
    const response = await this.post<ClawLinkSessionResponse>(url, null);
    this.sessionId = response.session_id;
  }

  // -------------------------------------------------------------------------
  // TransportAdapter implementation
  // -------------------------------------------------------------------------

  async submitTask(request: TaskSubmitRequest): Promise<TaskState> {
    await this.connect();

    const body = {
      agent_type: request.agentId ?? "general-purpose",
      prompt: request.input,
      context: {
        description: request.description,
        model: request.model,
        thinking: request.thinking,
        parentTaskId: request.parentTaskId,
        ...request.metadata,
      },
      session_id: this.sessionId,
    };

    const raw = await this.post<ClawLinkTaskStateResponse>(
      `${this.baseUrl}/api/runtime/tasks/submit`,
      body,
    );
    return this.toTaskState(raw, request);
  }

  async *streamTaskUpdates(taskId: string): AsyncIterableIterator<TaskUpdateEvent> {
    // CoderClawLink currently exposes polling; WebSocket streaming is on its roadmap.
    // We poll until the task reaches a terminal state.
    const terminal: TaskStatus[] = new Set(["completed", "failed", "cancelled"]);
    let last: TaskStatus = "pending";

    while (true) {
      await sleep(this.pollIntervalMs);

      const raw = await this.post<ClawLinkTaskStateResponse>(
        `${this.baseUrl}/api/runtime/tasks/${taskId}/state`,
        null,
        "GET",
      );

      if (raw.state !== last) {
        last = raw.state;
        yield {
          taskId,
          status: raw.state,
          timestamp: new Date(),
          message: raw.error ?? undefined,
          progress: raw.state === "completed" ? 100 : undefined,
        };
      }

      if (terminal.has(raw.state)) {
        break;
      }
    }
  }

  async queryTaskState(taskId: string): Promise<TaskState | null> {
    try {
      const raw = await this.post<ClawLinkTaskStateResponse>(
        `${this.baseUrl}/api/runtime/tasks/${taskId}/state`,
        null,
        "GET",
      );
      return this.toTaskState(raw);
    } catch {
      return null;
    }
  }

  async cancelTask(taskId: string): Promise<boolean> {
    try {
      const result = await this.post<{ success: boolean; task_id: string }>(
        `${this.baseUrl}/api/runtime/tasks/${taskId}/cancel`,
        { session_id: this.sessionId },
      );
      return result.success;
    } catch {
      return false;
    }
  }

  async listAgents(): Promise<AgentInfo[]> {
    const params = this.sessionId ? `?session_id=${this.sessionId}` : "";
    const agents = await this.post<ClawLinkAgentResponse[]>(
      `${this.baseUrl}/api/runtime/agents${params}`,
      null,
      "GET",
    );
    return agents.map((a) => ({
      id: a.agent_type,
      name: a.name,
      description: a.description ?? a.agent_type,
      capabilities: a.capabilities ?? [],
      model: undefined,
      thinking: undefined,
    }));
  }

  async listSkills(): Promise<SkillInfo[]> {
    const params = this.sessionId ? `?session_id=${this.sessionId}` : "";
    const skills = await this.post<ClawLinkSkillResponse[]>(
      `${this.baseUrl}/api/runtime/skills${params}`,
      null,
      "GET",
    );
    return skills.map((s) => ({
      id: s.skill_id,
      name: s.name,
      description: s.description ?? s.skill_id,
      version: "1.0.0",
      enabled: true,
    }));
  }

  async close(): Promise<void> {
    this.sessionId = undefined;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /** Minimal HTTP helper — uses Node 22+ built-in fetch, no extra deps. */
  private async post<T>(url: string, body: unknown, method: "POST" | "GET" = "POST"): Promise<T> {
    const init: RequestInit = {
      method,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      signal: AbortSignal.timeout(this.timeoutMs),
    };

    if (method === "POST" && body !== null) {
      init.body = JSON.stringify(body);
    }

    const response = await fetch(url, init);

    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      throw new Error(`ClawLink ${method} ${url} → ${response.status}: ${text}`);
    }

    return response.json() as Promise<T>;
  }

  /** Map a ClawLink task state response to CoderClaw's TaskState. */
  private toTaskState(raw: ClawLinkTaskStateResponse, req?: TaskSubmitRequest): TaskState {
    return {
      id: raw.task_id,
      status: raw.state,
      agentId: req?.agentId,
      description: req?.description ?? raw.task_id,
      sessionId: this.sessionId,
      parentTaskId: req?.parentTaskId,
      createdAt: new Date(),
      output: typeof raw.result === "string" ? raw.result : undefined,
      error: raw.error ?? undefined,
      progress: raw.state === "completed" ? 100 : undefined,
      metadata: raw.metadata ?? undefined,
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
