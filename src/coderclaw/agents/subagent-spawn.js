/**
 * src/coderclaw/agents/subagent-spawn.js
 *
 * Stub implementation of spawnSubagentDirect.
 *
 * This stub returns a mock 'accepted' result so that the orchestrate
 * tool can proceed with wiring executeWorkflow() without needing
 * real sub-agent infrastructure during initial Phase-1 development.
 *
 * The stub now accepts an optional `roleConfig` payload field and echoes
 * its key metadata in the result. This verifies that agent role definitions
 * are being passed through correctly during Phase -1.2 (Wire agent roles).
 *
 * TODO: Replace with real sub-agent spawning via sessions_spawn
 * when the multi-agent system is ready.
 */

export async function spawnSubagentDirect(payload, _context = {}) {
  // Basic validation
  if (!payload || typeof payload.task !== "string") {
    return { status: "rejected", error: "Invalid payload" };
  }

  // Generate a simple unique session key for the stub.
  const childSessionKey = `stub-${Math.random().toString(36).substring(2, 8)}`;

  // Build result, optionally including role metadata when roleConfig is provided
  const result = {
    status: "accepted",
    childSessionKey,
  };

  if (payload.roleConfig && typeof payload.roleConfig === "object") {
    // Echo back role metadata for verification
    result.role = payload.roleConfig.name;
    if (payload.roleConfig.model) {
      result.model = payload.roleConfig.model;
    }
    if (payload.roleConfig.thinking) {
      result.thinking = payload.roleConfig.thinking;
    }
    if (payload.roleConfig.tools) {
      result.tools = payload.roleConfig.tools;
    }
  }

  return result;
}
