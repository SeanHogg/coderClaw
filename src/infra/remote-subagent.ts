/**
 * RemoteSubagentAdapter — dispatches a task to a remote CoderClaw instance
 * via the CoderClawLink /api/claws/:targetId/forward endpoint.
 *
 * This is fire-and-forget: the forward endpoint delivers the payload to the
 * target claw's upstream WebSocket. The target claw executes the task
 * independently; results are not streamed back to the caller in this version.
 *
 * Used by the orchestrator when a workflow step role is "remote:<clawId>".
 * Also supports capability-based routing via "remote:auto" and
 * "remote:auto[cap1,cap2]" roles — automatically selects the best available
 * online claw that satisfies the required capabilities.
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

export type FleetEntry = {
  id: number;
  name: string;
  slug: string;
  online: boolean;
  connectedAt: string | null;
  lastSeenAt: string | null;
  capabilities: string[];
};

/**
 * Query the fleet and return online claws, optionally filtered by required capabilities.
 * Returns null if the fleet API is unavailable or misconfigured.
 */
export async function selectClawByCapability(
  opts: RemoteDispatchOptions,
  requiredCapabilities: string[] = [],
): Promise<FleetEntry | null> {
  const url = `${opts.baseUrl.replace(/\/$/, "")}/api/claws/fleet?from=${opts.myClawId}&key=${encodeURIComponent(opts.apiKey)}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      logDebug(`[remote-subagent] fleet query failed: HTTP ${res.status}`);
      return null;
    }

    const data = (await res.json()) as { fleet: FleetEntry[] };
    const online = data.fleet.filter((c) => c.online);

    // Exclude self from candidates
    const candidates = online.filter((c) => String(c.id) !== String(opts.myClawId));

    if (requiredCapabilities.length === 0) {
      // No capability filter — pick any online peer (first = most recently connected)
      return candidates[0] ?? null;
    }

    // Score each candidate: count how many required capabilities it satisfies
    const scored = candidates
      .map((c) => ({
        claw: c,
        matched: requiredCapabilities.filter((cap) => c.capabilities.includes(cap)).length,
      }))
      .filter((s) => s.matched === requiredCapabilities.length) // must satisfy ALL required
      .toSorted((a, b) => b.matched - a.matched);

    return scored[0]?.claw ?? null;
  } catch (err) {
    logDebug(`[remote-subagent] fleet query error: ${String(err)}`);
    return null;
  }
}

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
