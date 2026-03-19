/**
 * hybrid-model-policy.ts — Model selection policy for the Hybrid Self-Healing
 * AI Engineering Agent (v2).
 *
 * Implements the routing logic from the problem statement:
 *
 *   IF task is repo-aware / iterative / pattern-based
 *     → USE local Mamba brain (coderclawllm-local)
 *
 *   IF task is novel / highly complex / requires deep reasoning
 *     → USE external LLM (cortex / frontier model)
 *
 *   IF repeated failures have been detected (via WSLA)
 *     → Adapt Mamba first, then re-evaluate
 *     → Escalate to external LLM only after WSLA_MAX_CONSECUTIVE_FAILURES
 *
 * The policy is intentionally stateless (pure function + in-process counters)
 * so it can be called from both the main thread and worker threads without
 * coordination overhead.
 */

import type { LocalBrainRoutingDecision } from "./coderclawllm-local-stream.js";
import { WSLA_MAX_CONSECUTIVE_FAILURES } from "./mamba-wsla.js";

// ── Types ─────────────────────────────────────────────────────────────────────

/** The two model tiers available to the hybrid agent. */
export type ModelTier = "mamba-local" | "external-llm";

export type HybridPolicyDecision = {
  /** Which model tier to use for this request. */
  tier: ModelTier;
  /** Human-readable reasons for the routing decision. */
  reasons: string[];
  /** Whether a prior WSLA adaptation was the deciding factor. */
  wslaInfluenced: boolean;
};

export type HybridPolicyInput = {
  /** Pre-classified routing decision from classifyLocalBrainRequest(). */
  localClassification: LocalBrainRoutingDecision;
  /**
   * Number of consecutive WSLA-tracked failures for the current query
   * fingerprint.  0 means no recent failures.
   */
  consecutiveFailures: number;
  /**
   * Whether the local Mamba brain is currently eligible (models loaded,
   * hardware requirements met, not in cooldown).
   */
  mambaEligible: boolean;
};

// ── Routing thresholds ────────────────────────────────────────────────────────

/**
 * Reasons returned by classifyLocalBrainRequest that always warrant
 * immediate escalation to the external LLM, bypassing the Mamba brain.
 *
 * These map to the "novel / highly complex / deep reasoning" category from
 * the problem statement.
 */
const ESCALATING_REASONS = new Set([
  "long-user-prompt",
  "long-conversation",
  "structured-multi-part-request",
]);

/**
 * Reasons that suggest repo-awareness or pattern-based work — the Mamba
 * brain's sweet spot.
 *
 * Note: "complex-intent" alone does not escalate; the amygdala is specifically
 * designed for complex-but-repo-scoped intents.
 */
const MAMBA_PREFERRED_REASONS = new Set(["large-rag-context", "large-brain-context"]);

// ── Core policy function ──────────────────────────────────────────────────────

/**
 * Decide which model tier to use for the current request.
 *
 * Decision tree (evaluated in order):
 *   1. Mamba not eligible → external-llm (hardware / model unavailable).
 *   2. Consecutive failures ≥ threshold → external-llm (WSLA escalation).
 *   3. Any escalating reason present → external-llm (novel / complex).
 *   4. Local classification is "simple" → mamba-local (fast path).
 *   5. Mamba-preferred signals present → mamba-local (repo-aware path).
 *   6. Default for "complex" without escalating reasons → mamba-local
 *      (amygdala handles DELEGATE internally via hippocampus + cortex).
 */
export function selectModelTier(input: HybridPolicyInput): HybridPolicyDecision {
  const { localClassification, consecutiveFailures, mambaEligible } = input;
  const reasons: string[] = [];

  // ── 1. Eligibility check ─────────────────────────────────────────────────
  if (!mambaEligible) {
    reasons.push("mamba-not-eligible");
    return { tier: "external-llm", reasons, wslaInfluenced: false };
  }

  // ── 2. WSLA escalation ───────────────────────────────────────────────────
  if (consecutiveFailures >= WSLA_MAX_CONSECUTIVE_FAILURES) {
    reasons.push(`wsla-escalation-after-${consecutiveFailures}-failures`);
    return { tier: "external-llm", reasons, wslaInfluenced: true };
  }

  if (consecutiveFailures > 0) {
    reasons.push(`wsla-adapted-${consecutiveFailures}-failure(s)-remaining`);
  }

  // ── 3. Escalating signals ─────────────────────────────────────────────────
  const escalatingPresent = localClassification.reasons.filter((r) => ESCALATING_REASONS.has(r));
  if (escalatingPresent.length > 0) {
    reasons.push(...escalatingPresent.map((r) => `escalating:${r}`));
    return {
      tier: "external-llm",
      reasons,
      wslaInfluenced: consecutiveFailures > 0,
    };
  }

  // ── 4 & 5. Mamba preferred ────────────────────────────────────────────────
  if (localClassification.mode === "simple") {
    reasons.push("simple-task");
  } else {
    // "complex" without escalating reasons → amygdala handles DELEGATE path
    reasons.push("complex-repo-aware");
    const mambaPreferred = localClassification.reasons.filter((r) =>
      MAMBA_PREFERRED_REASONS.has(r),
    );
    if (mambaPreferred.length > 0) {
      reasons.push(...mambaPreferred.map((r) => `mamba-preferred:${r}`));
    }
  }

  return {
    tier: "mamba-local",
    reasons,
    wslaInfluenced: consecutiveFailures > 0,
  };
}

// ── Self-healing helpers ──────────────────────────────────────────────────────

/**
 * Describe the policy decision in a human-readable log string.
 */
export function describePolicyDecision(decision: HybridPolicyDecision): string {
  const wsla = decision.wslaInfluenced ? " [wsla-influenced]" : "";
  return `hybrid-policy: tier=${decision.tier}${wsla} reasons=[${decision.reasons.join(", ")}]`;
}

/**
 * Return true when the current failure count has crossed a point where
 * WSLA should be triggered before the next retry.
 *
 * This aligns with the problem-statement rule:
 *   "If repeated failures occur → Adapt Mamba (WSLA) BEFORE escalating"
 */
export function shouldTriggerWsla(consecutiveFailures: number): boolean {
  return consecutiveFailures > 0 && consecutiveFailures < WSLA_MAX_CONSECUTIVE_FAILURES;
}
