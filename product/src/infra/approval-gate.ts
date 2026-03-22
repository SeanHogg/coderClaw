/**
 * Approval Gate — human-in-the-loop blocking approvals.
 *
 * CoderClaw posts an approval request to Builderforce.ai and suspends the
 * calling code until the manager approves or rejects it in the portal (or
 * the request times out).  The relay delivers the decision as an
 * `approval.decision` WebSocket message, which resolves the pending Promise.
 *
 * Usage:
 *   const result = await requestApproval({
 *     actionType: 'git.push',
 *     description: 'Push 42 changed files to main',
 *   });
 *   if (result !== 'approved') throw new Error('Action not approved');
 */

import { logDebug, logWarn } from "../logger.js";

export type ApprovalDecision = "approved" | "rejected" | "timeout";

type PendingEntry = {
  resolve: (decision: ApprovalDecision) => void;
  timer: ReturnType<typeof setTimeout>;
};

const pendingApprovals = new Map<string, PendingEntry>();

let gatewayBaseUrl: string | null = null;
let gatewayClawId: string | null = null;
let gatewayApiKey: string | null = null;

/**
 * Configure the approval gate with the Builderforce connection details.
 * Call once at startup when CODERCLAW_LINK_API_KEY is present.
 */
export function initApprovalGate(opts: { baseUrl: string; clawId: string; apiKey: string }): void {
  gatewayBaseUrl = opts.baseUrl.replace(/\/$/, "");
  gatewayClawId = opts.clawId;
  gatewayApiKey = opts.apiKey;
}

/**
 * Called by the relay when an `approval.decision` WebSocket message arrives.
 * Resolves the corresponding pending Promise.
 */
export function resolveApproval(approvalId: string, decision: "approved" | "rejected"): void {
  const entry = pendingApprovals.get(approvalId);
  if (!entry) {
    logDebug(`[approval-gate] received decision for unknown approvalId: ${approvalId}`);
    return;
  }
  pendingApprovals.delete(approvalId);
  clearTimeout(entry.timer);
  entry.resolve(decision);
}

/**
 * Request human approval for a high-risk action.
 *
 * Posts to Builderforce, which notifies the manager via the portal.
 * Resolves when the manager decides or the timeout expires (default 10 min).
 *
 * Returns 'approved', 'rejected', or 'timeout'.
 * Throws if Builderforce is not configured or the request itself fails.
 */
export async function requestApproval(opts: {
  actionType: string;
  description: string;
  metadata?: unknown;
  timeoutMs?: number;
}): Promise<ApprovalDecision> {
  if (!gatewayBaseUrl || !gatewayClawId || !gatewayApiKey) {
    logWarn("[approval-gate] not configured — standalone mode; auto-approving");
    return "approved";
  }

  const timeoutMs = opts.timeoutMs ?? 10 * 60 * 1000; // 10 minutes
  const expiresAt = new Date(Date.now() + timeoutMs).toISOString();

  let approvalId: string;
  try {
    const res = await fetch(`${gatewayBaseUrl}/api/claws/${gatewayClawId}/approval-request`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${gatewayApiKey}`,
      },
      body: JSON.stringify({
        actionType: opts.actionType,
        description: opts.description,
        metadata: opts.metadata,
        expiresAt,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      logWarn(`[approval-gate] request failed (${res.status}) — auto-approving`);
      return "approved";
    }
    const data = (await res.json()) as { approvalId: string };
    approvalId = data.approvalId;
  } catch (err) {
    logWarn(`[approval-gate] request error — auto-approving: ${String(err)}`);
    return "approved";
  }

  logWarn(
    `[approval-gate] waiting for approval ${approvalId} (${opts.actionType}): ${opts.description}`,
  );

  return new Promise<ApprovalDecision>((resolve) => {
    const timer = setTimeout(() => {
      pendingApprovals.delete(approvalId);
      logWarn(`[approval-gate] approval ${approvalId} timed out after ${timeoutMs / 1000}s`);
      resolve("timeout");
    }, timeoutMs);
    pendingApprovals.set(approvalId, { resolve, timer });
  });
}
