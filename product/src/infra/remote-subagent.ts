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

import { createHmac } from "node:crypto";
import { logDebug } from "../logger.js";

/**
 * HMAC-SHA256 signature of the serialised payload using the claw's API key
 * as the shared secret. The receiving Builderforce endpoint should verify this
 * before accepting the dispatch, ensuring only claws with a valid key can
 * forward tasks and that the payload has not been tampered with in transit.
 *
 * Signature covers the exact JSON body bytes that are sent in the request.
 */
function signPayload(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

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
  // API key moved to Authorization header — never embed secrets in URLs
  // (query params appear in server access logs, browser history, and CDN caches).
  const url = `${opts.baseUrl.replace(/\/$/, "")}/api/claws/fleet`;

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "X-Claw-From": opts.myClawId,
      },
      signal: AbortSignal.timeout(15_000),
    });
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
  options?: { correlationId?: string; callbackClawId?: string },
): Promise<RemoteDispatchResult> {
  // API key moved to Authorization header; payload is HMAC-signed so the
  // receiving endpoint can verify both the caller's identity and that the
  // task body has not been tampered with in transit.
  const url = `${opts.baseUrl.replace(/\/$/, "")}/api/claws/${targetClawId}/forward`;

  const payload: Record<string, unknown> = {
    type: "remote.task",
    task,
    fromClawId: opts.myClawId,
    timestamp: new Date().toISOString(),
    ...(options?.correlationId ? { correlationId: options.correlationId } : {}),
    ...(options?.callbackClawId ? { callbackClawId: options.callbackClawId } : {}),
    ...(options?.correlationId ? { callbackBaseUrl: opts.baseUrl } : {}),
  };
  const body = JSON.stringify(payload);
  const signature = signPayload(body, opts.apiKey);

  try {
    logDebug(`[remote-subagent] dispatching to claw ${targetClawId}: ${task.slice(0, 80)}…`);

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.apiKey}`,
        "X-Claw-From": opts.myClawId,
        // SHA-256 HMAC of the exact body bytes — receiver should verify before accepting
        "X-Claw-Signature": `sha256=${signature}`,
      },
      body,
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

/**
 * Send a task result back to the originating claw.
 * Called by the target claw after completing a remote task.
 */
export async function dispatchResultToRemoteClaw(
  opts: RemoteDispatchOptions,
  callbackClawId: string,
  correlationId: string,
  result: string,
): Promise<void> {
  const url = `${opts.baseUrl.replace(/\/$/, "")}/api/claws/${callbackClawId}/forward`;
  const payload = {
    type: "remote.task.result",
    correlationId,
    result,
    fromClawId: opts.myClawId,
    timestamp: new Date().toISOString(),
  };
  const body = JSON.stringify(payload);
  const signature = signPayload(body, opts.apiKey);
  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.apiKey}`,
        "X-Claw-From": opts.myClawId,
        "X-Claw-Signature": `sha256=${signature}`,
      },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    logDebug(
      `[remote-subagent] result dispatched to callback claw ${callbackClawId} (correlation=${correlationId})`,
    );
  } catch (err) {
    logDebug(`[remote-subagent] result dispatch failed: ${String(err)}`);
  }
}
