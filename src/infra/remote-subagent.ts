/**
 * RemoteSubagentAdapter — dispatches a task to a remote CoderClaw instance
 * via the CoderClawLink /api/claws/:targetId/forward endpoint.
 *
 * This is fire-and-forget: the forward endpoint delivers the payload to the
 * target claw's upstream WebSocket. The target claw executes the task
 * independently; results are not streamed back to the caller in this version.
 *
 * Used by the orchestrator when a workflow step role is "remote:<clawId>".
 */

import { logDebug } from "../logger.js";

export type RemoteDispatchOptions = {
  /** Base HTTP URL of CoderClawLink, e.g. "https://api.coderclaw.ai" */
  baseUrl: string;
  /** This claw's numeric ID (from clawLink.instanceId in context.yaml) */
  myClawId: string;
  /** Plaintext API key for this claw (CODERCLAW_LINK_API_KEY) */
  apiKey: string;
};

export type RemoteDispatchResult = { status: "accepted" } | { status: "rejected"; error: string };

/**
 * Dispatch a task payload to a remote claw.
 * Authenticates as the source claw and forwards to the target claw.
 */
export async function dispatchToRemoteClaw(
  opts: RemoteDispatchOptions,
  targetClawId: string,
  task: string,
): Promise<RemoteDispatchResult> {
  const url = `${opts.baseUrl.replace(/\/$/, "")}/api/claws/${targetClawId}/forward?from=${opts.myClawId}&key=${encodeURIComponent(opts.apiKey)}`;

  const payload = {
    type: "remote.task",
    task,
    fromClawId: opts.myClawId,
    timestamp: new Date().toISOString(),
  };

  try {
    logDebug(`[remote-subagent] dispatching to claw ${targetClawId}: ${task.slice(0, 80)}…`);

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const body = await res.text();
      return { status: "rejected", error: `HTTP ${res.status}: ${body}` };
    }

    const data = (await res.json()) as { ok?: boolean; delivered?: boolean; error?: string };
    if (data.ok && data.delivered) {
      logDebug(`[remote-subagent] task delivered to claw ${targetClawId}`);
      return { status: "accepted" };
    }

    return {
      status: "rejected",
      error: data.error ?? "target claw reported delivery failure",
    };
  } catch (err) {
    return { status: "rejected", error: String(err) };
  }
}
