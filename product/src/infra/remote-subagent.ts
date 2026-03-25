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

/** Options for dispatchToRemoteClaw. */
export interface RemoteDispatchExtendedOptions {
  correlationId?: string;
  callbackClawId?: string;
  /** Called with partial result chunks if the remote claw streams (X-Stream: true header). */
  onChunk?: (chunk: string) => void;
  /** Timeout in milliseconds. Default: 600000 (10 min). */
  timeoutMs?: number;
}

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

// ── Retry helper ──────────────────────────────────────────────────────────────

const RETRY_DELAYS_MS = [500, 1000, 2000] as const;
const MAX_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Telemetry span helper (fire-and-forget) ──────────────────────────────────

/** Lazily imported telemetry emitter to avoid circular deps. */
let _emitSpan: ((span: Record<string, unknown>) => void) | null | undefined = undefined;

function emitRetrySpan(
  workflowId: string | undefined,
  taskId: string | undefined,
  attempt: number,
  reason: string,
): void {
  // Emit a task.retry span using the workflow-telemetry module if available.
  // We import lazily and cache to avoid circular dependencies.
  if (_emitSpan === undefined) {
    _emitSpan = null; // prevent re-entry during resolution
    import("./workflow-telemetry.js")
      .then((mod) => {
        const m = mod as { emitSpan?: (span: Record<string, unknown>) => void };
        if (typeof m.emitSpan === "function") {
          _emitSpan = m.emitSpan;
        }
      })
      .catch(() => {
        // telemetry module unavailable
      });
    return; // first call: span is skipped; future calls will use the cached fn
  }
  if (!_emitSpan) { return; }
  try {
    _emitSpan({
      kind: "task.retry",
      workflowId,
      taskId,
      ts: new Date().toISOString(),
      error: reason,
      durationMs: attempt * 500,
      agentRole: `retry-attempt-${attempt}`,
    });
  } catch {
    // telemetry is best-effort
  }
}

/**
 * Dispatch a task payload to a remote claw.
 * Authenticates as the source claw and forwards to the target claw.
 *
 * Retries up to 3 times with exponential backoff (500ms, 1000ms, 2000ms)
 * on network errors or 5xx responses. Supports optional chunk streaming
 * via the onChunk callback when the remote claw responds with X-Stream: true.
 */
export async function dispatchToRemoteClaw(
  opts: RemoteDispatchOptions,
  targetClawId: string,
  task: string,
  options?: RemoteDispatchExtendedOptions | { correlationId?: string; callbackClawId?: string },
): Promise<RemoteDispatchResult> {
  const extOpts = options as RemoteDispatchExtendedOptions | undefined;
  // API key moved to Authorization header; payload is HMAC-signed so the
  // receiving endpoint can verify both the caller's identity and that the
  // task body has not been tampered with in transit.
  const url = `${opts.baseUrl.replace(/\/$/, "")}/api/claws/${targetClawId}/forward`;

  const payload: Record<string, unknown> = {
    type: "remote.task",
    task,
    fromClawId: opts.myClawId,
    timestamp: new Date().toISOString(),
    ...(extOpts?.correlationId ? { correlationId: extOpts.correlationId } : {}),
    ...(extOpts?.callbackClawId ? { callbackClawId: extOpts.callbackClawId } : {}),
    ...(extOpts?.correlationId ? { callbackBaseUrl: opts.baseUrl } : {}),
  };
  const body = JSON.stringify(payload);
  const signature = signPayload(body, opts.apiKey);

  logDebug(`[remote-subagent] dispatching to claw ${targetClawId}: ${task.slice(0, 80)}…`);

  let lastError: string = "unknown error";

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      const delayMs = RETRY_DELAYS_MS[attempt - 1] ?? 2000;
      logDebug(`[remote-subagent] retry attempt ${attempt + 1}/${MAX_ATTEMPTS} after ${delayMs}ms`);
      emitRetrySpan(undefined, undefined, attempt, lastError);
      await sleep(delayMs);
    }

    try {
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
        signal: AbortSignal.timeout(extOpts?.timeoutMs ?? 30_000),
      });

      // Retry on 5xx server errors
      if (res.status >= 500) {
        lastError = `HTTP ${res.status}`;
        continue;
      }

      if (!res.ok) {
        const errBody = await res.text();
        return { status: "rejected", error: `HTTP ${res.status}: ${errBody}` };
      }

      // Streaming support: if X-Stream header present, pipe chunks to onChunk callback
      if (res.headers.get("X-Stream") === "true" && extOpts?.onChunk && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) { break; }
          extOpts.onChunk(decoder.decode(value, { stream: true }));
        }
        return { status: "accepted" };
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
      lastError = String(err);
      // Network errors are retryable
      if (attempt < MAX_ATTEMPTS - 1) {
        continue;
      }
    }
  }

  return { status: "rejected", error: lastError };
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
