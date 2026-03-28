/**
 * Workflow telemetry — lightweight span emitter for orchestrated task execution.
 *
 * Writes newline-delimited JSON spans to .coderClaw/telemetry/YYYY-MM-DD.jsonl.
 * Each span captures task start/end times, agent role, workflow context, and
 * any error information — giving operators a queryable audit trail of every
 * agent execution inside a DAG workflow.
 *
 * The JSONL format means operators can inspect it with standard tools:
 *   grep '"kind":"task.fail"' .coderClaw/telemetry/2026-03-21.jsonl | jq .
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { logDebug } from "../logger.js";
import { normalizeBaseUrl } from "../utils/normalize-base-url.js";

export type SpanKind =
  | "workflow.start"
  | "workflow.complete"
  | "workflow.fail"
  | "task.start"
  | "task.complete"
  | "task.fail";

export type WorkflowSpan = {
  kind: SpanKind;
  workflowId: string;
  taskId?: string;
  agentRole?: string;
  description?: string;
  /** Wall-clock timestamp (ISO 8601) */
  ts: string;
  /** Elapsed milliseconds from task.start → task.complete/fail. Only on end spans. */
  durationMs?: number;
  /** Error message. Only present on *.fail spans. */
  error?: string;
  /** Claw instance ID, if known. */
  clawId?: string;
  // ── OTel / cost tracking fields ────────────────────────────────────────
  /** W3C-compatible trace ID (32 hex chars) shared across all spans in a workflow. */
  traceId?: string;
  /** LLM model used in this task (e.g. "claude-sonnet-4-6"). */
  model?: string;
  /** Total input (prompt) tokens consumed by this task. */
  inputTokens?: number;
  /** Total output (completion) tokens consumed by this task. */
  outputTokens?: number;
  /** Estimated cost in USD for this task (input + output tokens at model rates). */
  estimatedCostUsd?: number;
};

let projectRoot: string | null = null;
let knownClawId: string | null = null;
let linkApiUrl: string | null = null;
let linkApiKey: string | null = null;

/**
 * Active trace ID for the current workflow (W3C-compatible, 32 hex chars).
 * Set automatically when a workflow starts and cleared when it ends.
 * Exposed via getActiveTraceId() so HTTP layers can forward it as X-Trace-Id.
 */
let activeTraceId: string | null = null;

/** Generate a W3C-compatible 128-bit trace ID as 32 lowercase hex chars. */
function generateTraceId(): string {
  return crypto.randomBytes(16).toString("hex");
}

/** Returns the active workflow trace ID, or null if no workflow is running. */
export function getActiveTraceId(): string | null {
  return activeTraceId;
}

/**
 * Optional relay hook — called fire-and-forget after each span is appended.
 * Set via setRelayHook() to push real-time workflow/task events to browser clients
 * through the Builderforce WebSocket relay.
 */
let relayHook: ((event: string, payload: unknown) => void) | null = null;

/**
 * Register (or unregister) a relay hook.
 * The relay service calls this once connected so spans are forwarded as live
 * WebSocket frames to browser clients: workflow.update, task.started, task.completed.
 */
export function setRelayHook(fn: ((event: string, payload: unknown) => void) | null): void {
  relayHook = fn;
}

/**
 * Initialise telemetry. Call once at gateway startup after projectRoot is known.
 * @param opts.projectRoot  Absolute path to the workspace root (.coderClaw parent).
 * @param opts.clawId       Optional claw instance ID to tag all spans with.
 * @param opts.linkApiUrl   Builderforce.ai base URL for forwarding spans (e.g. https://api.coderclaw.ai).
 * @param opts.linkApiKey   Builderforce.ai API key for Bearer auth.
 */
export function initTelemetry(opts: {
  projectRoot: string;
  clawId?: string | null;
  linkApiUrl?: string | null;
  linkApiKey?: string | null;
}): void {
  projectRoot = opts.projectRoot;
  knownClawId = opts.clawId ?? null;
  linkApiUrl = opts.linkApiUrl ?? null;
  linkApiKey = opts.linkApiKey ?? null;
}

/**
 * Fire-and-forget: forward a span to Builderforce.ai workflow API.
 * Maps WorkflowSpan kinds to the appropriate REST calls:
 *   workflow.start    → POST  /api/workflows          (upsert; status=running)
 *   workflow.complete → POST  /api/workflows          (upsert; status=completed)
 *   workflow.fail     → POST  /api/workflows          (upsert; status=failed)
 *   task.start        → POST  /api/workflows/:wfId/tasks  (create with status=running)
 *   task.complete     → PATCH /api/workflows/:wfId/tasks/:tid  (status=completed)
 *   task.fail         → PATCH /api/workflows/:wfId/tasks/:tid  (status=failed)
 */
function syncSpanToBuilderforce(span: WorkflowSpan): void {
  if (!linkApiUrl || !linkApiKey || !knownClawId) {
    return;
  }

  const base = normalizeBaseUrl(linkApiUrl);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${linkApiKey}`,
    "X-Claw-Id": knownClawId,
  };
  if (span.traceId) {
    headers["X-Trace-Id"] = span.traceId;
  }

  const doFetch = (url: string, method: string, body: unknown) =>
    fetch(url, { method, headers, body: JSON.stringify(body) }).catch((err) =>
      logDebug(`[telemetry] builderforce sync failed (${span.kind}): ${String(err)}`),
    );

  switch (span.kind) {
    case "workflow.start":
      void doFetch(`${base}/api/workflows`, "POST", {
        id: span.workflowId,
        status: "running",
        description: span.description,
      });
      break;
    case "workflow.complete":
      void doFetch(`${base}/api/workflows`, "POST", {
        id: span.workflowId,
        status: "completed",
      });
      break;
    case "workflow.fail":
      void doFetch(`${base}/api/workflows`, "POST", {
        id: span.workflowId,
        status: "failed",
      });
      break;
    case "task.start":
      void doFetch(`${base}/api/workflows/${span.workflowId}/tasks`, "POST", {
        id: span.taskId,
        agentRole: span.agentRole ?? "agent",
        description: span.description ?? "",
        status: "running",
        startedAt: span.ts,
      });
      break;
    case "task.complete":
      void doFetch(`${base}/api/workflows/${span.workflowId}/tasks/${span.taskId}`, "PATCH", {
        status: "completed",
        completedAt: span.ts,
      });
      break;
    case "task.fail":
      void doFetch(`${base}/api/workflows/${span.workflowId}/tasks/${span.taskId}`, "PATCH", {
        status: "failed",
        error: span.error,
        completedAt: span.ts,
      });
      break;
  }
}

/** Forward span to Builderforce OTel ingest endpoint (fire-and-forget). */
function forwardSpanToOtelProxy(span: WorkflowSpan): void {
  if (!linkApiUrl || !linkApiKey || !knownClawId) return;
  const base = normalizeBaseUrl(linkApiUrl);
  const clawIdNum = parseInt(knownClawId, 10);
  if (Number.isNaN(clawIdNum)) return;

  const url = `${base}/api/telemetry/spans?clawId=${clawIdNum}`;
  fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${linkApiKey}`,
      ...(span.traceId ? { "X-Trace-Id": span.traceId } : {}),
    },
    body: JSON.stringify([span]),
  }).catch((err) => logDebug(`[telemetry] otel proxy forward failed: ${String(err)}`));
}

/** Map internal SpanKind to the relay event name sent to browser clients. */
function spanToRelayEvent(kind: SpanKind): string | null {
  switch (kind) {
    case "workflow.start":
    case "workflow.complete":
    case "workflow.fail":
      return "workflow.update";
    case "task.start":
      return "task.started";
    case "task.complete":
    case "task.fail":
      return "task.completed";
    default:
      return null;
  }
}

async function appendSpan(span: WorkflowSpan): Promise<void> {
  if (!projectRoot) {
    return;
  }
  // Forward to Builderforce.ai timeline + OTel proxy (fire-and-forget).
  syncSpanToBuilderforce(span);
  forwardSpanToOtelProxy(span);

  // Push real-time event to browser clients via the Builderforce WS relay.
  const relayEvent = spanToRelayEvent(span.kind);
  if (relayHook && relayEvent) {
    try {
      relayHook(relayEvent, span);
    } catch {
      // relay hook errors must never block telemetry writes
    }
  }

  try {
    const dir = path.join(projectRoot, ".coderClaw", "telemetry");
    await fs.mkdir(dir, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    const file = path.join(dir, `${date}.jsonl`);
    await fs.appendFile(file, JSON.stringify(span) + "\n", "utf8");
  } catch (err) {
    logDebug(`[telemetry] failed to write span: ${String(err)}`);
  }
}

/**
 * Generic span emitter for callers that construct spans directly (e.g. remote-subagent
 * retry telemetry). Accepts a plain record so callers that import dynamically do not
 * need to depend on the WorkflowSpan type.
 */
export function emitSpan(span: Record<string, unknown>): void {
  void appendSpan(span as WorkflowSpan);
}

export function emitWorkflowStart(workflowId: string, description?: string): void {
  activeTraceId = generateTraceId();
  void appendSpan({
    kind: "workflow.start",
    workflowId,
    description,
    ts: new Date().toISOString(),
    clawId: knownClawId ?? undefined,
    traceId: activeTraceId,
  });
}

export function emitWorkflowEnd(workflowId: string, failed: boolean): void {
  void appendSpan({
    kind: failed ? "workflow.fail" : "workflow.complete",
    workflowId,
    ts: new Date().toISOString(),
    clawId: knownClawId ?? undefined,
    traceId: activeTraceId ?? undefined,
  });
  activeTraceId = null;
}

export function emitTaskStart(
  workflowId: string,
  taskId: string,
  agentRole: string,
  description: string,
): void {
  void appendSpan({
    kind: "task.start",
    workflowId,
    taskId,
    agentRole,
    description,
    ts: new Date().toISOString(),
    clawId: knownClawId ?? undefined,
    traceId: activeTraceId ?? undefined,
  });
}

export function emitTaskEnd(
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
  const durationMs = Date.now() - startedAt.getTime();
  void appendSpan({
    kind: error !== undefined ? "task.fail" : "task.complete",
    workflowId,
    taskId,
    agentRole,
    ts: new Date().toISOString(),
    durationMs,
    error,
    clawId: knownClawId ?? undefined,
    traceId: activeTraceId ?? undefined,
    model: metrics?.model,
    inputTokens: metrics?.inputTokens,
    outputTokens: metrics?.outputTokens,
    estimatedCostUsd: metrics?.estimatedCostUsd,
  });
}
