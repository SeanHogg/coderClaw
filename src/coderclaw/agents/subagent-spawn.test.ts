import { describe, expect, test } from "vitest";
// @ts-expect-error – stub is a plain JS file without type declarations (TODO: convert to TS)
import { spawnSubagentDirect } from "./subagent-spawn.js";

describe("spawnSubagentDirect (stub)", () => {
  test("returns accepted result with childSessionKey", async () => {
    const result = await spawnSubagentDirect({
      task: "Test task",
      label: "Test Label",
      agentId: "test-agent",
    });
    expect(result).toHaveProperty("status", "accepted");
    expect(result).toHaveProperty("childSessionKey");
    expect(typeof result.childSessionKey).toBe("string");
  });

  test("echoes roleConfig metadata when provided", async () => {
    const roleConfig = {
      name: "code-creator",
      model: "anthropic/claude-sonnet-4-20250514",
      thinking: "high",
      tools: ["create", "edit", "view"],
    };
    const result = await spawnSubagentDirect({
      task: "Implement feature",
      label: "Implement",
      agentId: "code-creator",
      roleConfig,
    });
    expect(result.status).toBe("accepted");
    expect(result.role).toBe("code-creator");
    expect(result.model).toBe(roleConfig.model);
    expect(result.thinking).toBe("high");
    expect(result.tools).toEqual(roleConfig.tools);
  });
});
