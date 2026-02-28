import { describe, expect, it } from "vitest";
import { shouldAutoContinueRun } from "./continuation-policy.js";

describe("shouldAutoContinueRun", () => {
  it("continues on deferral language during execution tasks", () => {
    const decision = shouldAutoContinueRun({
      userPrompt: "Wire executeWorkflow into orchestrate tool and run tests",
      assistantTexts: ["Let me check git history first and then I will continue."],
      toolNames: ["read", "git_history"],
    });

    expect(decision.shouldContinue).toBe(true);
    expect(decision.reason).toBe("deferral_language");
  });

  it("stops when assistant asks user a direct question", () => {
    const decision = shouldAutoContinueRun({
      userPrompt: "Implement the roadmap item",
      assistantTexts: ["Which option do you want me to take?"],
      toolNames: ["read"],
    });

    expect(decision.shouldContinue).toBe(false);
    expect(decision.reason).toBe("asked_user_question");
  });

  it("continues when only investigation tools were used and no completion signal", () => {
    const decision = shouldAutoContinueRun({
      userPrompt: "Fix the orchestrator wiring bug",
      assistantTexts: ["I reviewed the files and found the issue."],
      toolNames: ["read", "find", "grep"],
    });

    expect(decision.shouldContinue).toBe(true);
    expect(decision.reason).toBe("investigation_only_tools");
  });

  it("does not continue when response appears complete", () => {
    const decision = shouldAutoContinueRun({
      userPrompt: "Fix the orchestrator wiring bug",
      assistantTexts: ["Implemented and tests passed. All tasks complete."],
      toolNames: ["read", "apply_patch"],
    });

    expect(decision.shouldContinue).toBe(false);
    expect(decision.reason).toBe("looks_complete");
  });

  it("does not continue for non-execution prompts", () => {
    const decision = shouldAutoContinueRun({
      userPrompt: "What is the difference between these two files?",
      assistantTexts: ["Here is the difference..."],
      toolNames: ["read"],
    });

    expect(decision.shouldContinue).toBe(false);
  });
});
