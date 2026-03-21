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

import fs from "node:fs/promises";
import path from "node:path";
import { logDebug } from "../logger.js";

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
};

let projectRoot: string | null = null;
let knownClawId: string | null = null;
let linkApiUrl: string | null = null;
let linkApiKey: string | null = null;

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
  if (!linkApiUrl || !linkApiKey || !knownClawId) return;

  const base = linkApiUrl.replace(/\/$/, "");
  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${linkApiKey}`,
    "X-Claw-Id": knownClawId,
  };

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

async function appendSpan(span: WorkflowSpan): Promise<void> {
  if (!projectRoot) {
    return;
  }
  // Forward to Builderforce.ai timeline (fire-and-forget, never blocks local write).
  syncSpanToBuilderforce(span);
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

export function emitWorkflowStart(workflowId: string): void {
  void appendSpan({
    kind: "workflow.start",
    workflowId,
    ts: new Date().toISOString(),
    clawId: knownClawId ?? undefined,
  });
}

export function emitWorkflowEnd(workflowId: string, failed: boolean): void {
  void appendSpan({
    kind: failed ? "workflow.fail" : "workflow.complete",
    workflowId,
    ts: new Date().toISOString(),
    clawId: knownClawId ?? undefined,
  });
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
  });
}

export function emitTaskEnd(
  workflowId: string,
  taskId: string,
  agentRole: string,
  startedAt: Date,
  error?: string,
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
  });
}
