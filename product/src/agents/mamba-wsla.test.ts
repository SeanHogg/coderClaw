/**
 * Unit tests for mamba-wsla.ts and hybrid-model-policy.ts.
 *
 * All tests run in Node.js (no WebGPU, no live model pipelines required).
 * The mambacode.js quantization utilities used by mamba-wsla.ts are pure
 * JavaScript, so they work in Node.js without any GPU polyfill.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  describePolicyDecision,
  selectModelTier,
  shouldTriggerWsla,
} from "./hybrid-model-policy.js";
import {
  WSLA_MAX_CONSECUTIVE_FAILURES,
  adaptOnFailure,
  clearFailureLedger,
  getConsecutiveFailures,
  recordSuccess,
} from "./mamba-wsla.js";

// ── WSLA failure ledger ───────────────────────────────────────────────────────

describe("WSLA failure ledger", () => {
  beforeEach(() => {
    clearFailureLedger();
  });

  it("returns 0 consecutive failures for a fresh query", () => {
    expect(getConsecutiveFailures("new query")).toBe(0);
  });

  it("increments consecutive failures on each adaptOnFailure call", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wsla-test-"));
    try {
      const agentId = tmpDir;

      await adaptOnFailure(agentId, "same query", "error A");
      expect(getConsecutiveFailures("same query", "error A")).toBe(1);

      await adaptOnFailure(agentId, "same query", "error A");
      expect(getConsecutiveFailures("same query", "error A")).toBe(2);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("resets counter after recordSuccess", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wsla-test-"));
    try {
      const agentId = tmpDir;

      await adaptOnFailure(agentId, "query x", "error");
      expect(getConsecutiveFailures("query x", "error")).toBe(1);

      recordSuccess("query x", "error");
      expect(getConsecutiveFailures("query x", "error")).toBe(0);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("escalate flag is true once threshold is reached", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wsla-test-"));
    try {
      const agentId = tmpDir;
      let result = await adaptOnFailure(agentId, "failing query", "persistent error");

      for (let i = 1; i < WSLA_MAX_CONSECUTIVE_FAILURES; i++) {
        result = await adaptOnFailure(agentId, "failing query", "persistent error");
      }

      expect(result.escalate).toBe(true);
      expect(result.consecutiveFailures).toBe(WSLA_MAX_CONSECUTIVE_FAILURES);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});

// ── WSLA snapshot ─────────────────────────────────────────────────────────────

describe("WSLA snapshot persistence", () => {
  beforeEach(() => {
    clearFailureLedger();
  });

  it("creates a snapshot with non-empty data and step=1 after first adaptation", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wsla-snap-"));
    try {
      const result = await adaptOnFailure(tmpDir, "query", "error");

      expect(result.snapshot.step).toBe(1);
      expect(result.snapshot.data.length).toBeGreaterThan(0);
      expect(result.snapshot.data.every((v) => typeof v === "number")).toBe(true);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("increments step on each successive adaptation", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wsla-snap2-"));
    try {
      const r1 = await adaptOnFailure(tmpDir, "q", "e");
      const r2 = await adaptOnFailure(tmpDir, "q", "e");

      expect(r2.snapshot.step).toBe(r1.snapshot.step + 1);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("changes the data array after each adaptation step", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wsla-diff-"));
    try {
      const r1 = await adaptOnFailure(tmpDir, "q2", "e2");
      const r2 = await adaptOnFailure(tmpDir, "q2", "e2");

      // The data arrays must differ because B/C were shifted.
      const allSame = r1.snapshot.data.every((v, i) => v === r2.snapshot.data[i]);
      expect(allSame).toBe(false);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});

// ── shouldTriggerWsla ─────────────────────────────────────────────────────────

describe("shouldTriggerWsla", () => {
  it("returns false for 0 failures (no adaptation needed)", () => {
    expect(shouldTriggerWsla(0)).toBe(false);
  });

  it("returns true for 1 failure (adapt before retry)", () => {
    expect(shouldTriggerWsla(1)).toBe(true);
  });

  it("returns true for 2 failures (still below threshold)", () => {
    expect(shouldTriggerWsla(2)).toBe(true);
  });

  it("returns false at or above threshold (escalate instead)", () => {
    expect(shouldTriggerWsla(WSLA_MAX_CONSECUTIVE_FAILURES)).toBe(false);
    expect(shouldTriggerWsla(WSLA_MAX_CONSECUTIVE_FAILURES + 1)).toBe(false);
  });
});

// ── selectModelTier ───────────────────────────────────────────────────────────

describe("selectModelTier", () => {
  it("routes simple requests to mamba-local", () => {
    const decision = selectModelTier({
      localClassification: { mode: "simple", reasons: [] },
      consecutiveFailures: 0,
      mambaEligible: true,
    });
    expect(decision.tier).toBe("mamba-local");
    expect(decision.wslaInfluenced).toBe(false);
  });

  it("routes to external-llm when mamba is not eligible", () => {
    const decision = selectModelTier({
      localClassification: { mode: "simple", reasons: [] },
      consecutiveFailures: 0,
      mambaEligible: false,
    });
    expect(decision.tier).toBe("external-llm");
    expect(decision.reasons).toContain("mamba-not-eligible");
  });

  it("escalates to external-llm after WSLA_MAX_CONSECUTIVE_FAILURES", () => {
    const decision = selectModelTier({
      localClassification: { mode: "simple", reasons: [] },
      consecutiveFailures: WSLA_MAX_CONSECUTIVE_FAILURES,
      mambaEligible: true,
    });
    expect(decision.tier).toBe("external-llm");
    expect(decision.wslaInfluenced).toBe(true);
  });

  it("routes long-conversation to external-llm (escalating reason)", () => {
    const decision = selectModelTier({
      localClassification: { mode: "complex", reasons: ["long-conversation"] },
      consecutiveFailures: 0,
      mambaEligible: true,
    });
    expect(decision.tier).toBe("external-llm");
    expect(decision.reasons.some((r) => r.startsWith("escalating:"))).toBe(true);
  });

  it("routes long-user-prompt to external-llm (escalating reason)", () => {
    const decision = selectModelTier({
      localClassification: { mode: "complex", reasons: ["long-user-prompt"] },
      consecutiveFailures: 0,
      mambaEligible: true,
    });
    expect(decision.tier).toBe("external-llm");
  });

  it("routes complex-intent without escalating reasons to mamba-local", () => {
    const decision = selectModelTier({
      localClassification: { mode: "complex", reasons: ["complex-intent"] },
      consecutiveFailures: 0,
      mambaEligible: true,
    });
    expect(decision.tier).toBe("mamba-local");
    expect(decision.reasons).toContain("complex-repo-aware");
  });

  it("marks decision as wsla-influenced after 1 failure (below threshold)", () => {
    const decision = selectModelTier({
      localClassification: { mode: "simple", reasons: [] },
      consecutiveFailures: 1,
      mambaEligible: true,
    });
    expect(decision.tier).toBe("mamba-local");
    expect(decision.wslaInfluenced).toBe(true);
    expect(decision.reasons.some((r) => r.startsWith("wsla-adapted"))).toBe(true);
  });
});

// ── describePolicyDecision ────────────────────────────────────────────────────

describe("describePolicyDecision", () => {
  it("produces a human-readable string with tier and reasons", () => {
    const decision = selectModelTier({
      localClassification: { mode: "simple", reasons: [] },
      consecutiveFailures: 0,
      mambaEligible: true,
    });
    const desc = describePolicyDecision(decision);
    expect(desc).toContain("hybrid-policy:");
    expect(desc).toContain("tier=mamba-local");
  });

  it("includes wsla-influenced marker when applicable", () => {
    const decision = selectModelTier({
      localClassification: { mode: "simple", reasons: [] },
      consecutiveFailures: 1,
      mambaEligible: true,
    });
    const desc = describePolicyDecision(decision);
    expect(desc).toContain("[wsla-influenced]");
  });
});
