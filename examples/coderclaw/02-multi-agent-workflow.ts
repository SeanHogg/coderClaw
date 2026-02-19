/**
 * Example 2: Multi-Agent Workflow
 * 
 * This example demonstrates orchestrating multiple agents working together:
 * Code Creator → Code Reviewer → Test Generator
 * 
 * Shows dynamic agent spawning, task coordination, and result aggregation.
 */

import { EnhancedAgentOrchestrator } from "../../src/coderclaw/orchestrator-enhanced.js";
import {
  CODE_CREATOR_ROLE,
  CODE_REVIEWER_ROLE,
  TEST_GENERATOR_ROLE,
} from "../../src/coderclaw/agent-roles.js";

async function main() {
  console.log("🦞 Multi-Agent Workflow Example\n");
  console.log("Orchestrating: Creator → Reviewer → Tester\n");

  const orchestrator = new EnhancedAgentOrchestrator();

  // Define workflow steps
  const workflow = orchestrator.createWorkflow([
    {
      role: CODE_CREATOR_ROLE.name,
      task: "Implement a user authentication API endpoint with JWT tokens",
      dependsOn: [],
    },
    {
      role: CODE_REVIEWER_ROLE.name,
      task: "Review the authentication implementation for security vulnerabilities",
      dependsOn: [CODE_CREATOR_ROLE.name],
    },
    {
      role: TEST_GENERATOR_ROLE.name,
      task: "Generate comprehensive tests for the authentication endpoint",
      dependsOn: [CODE_CREATOR_ROLE.name],
    },
  ]);

  console.log(`Workflow created: ${workflow.id}`);
  console.log(`Total steps: ${workflow.steps.length}\n`);

  // Display workflow structure
  console.log("Workflow Steps:");
  for (const step of workflow.steps) {
    console.log(`  ${step.role}: ${step.task}`);
    if (step.dependsOn && step.dependsOn.length > 0) {
      console.log(`    ↳ depends on: ${step.dependsOn.join(", ")}`);
    }
  }

  console.log("\n✓ Workflow configured");
  console.log("\nIn a real execution:");
  console.log("  1. Code Creator implements the feature");
  console.log("  2. Code Reviewer analyzes for issues (runs in parallel with Tester)");
  console.log("  3. Test Generator creates test suite (runs in parallel with Reviewer)");
  console.log("  4. Results are aggregated with structured audit trail");

  // Show task tracking capabilities
  console.log("\nTask Tracking Features:");
  console.log("  ✓ Globally unique task IDs");
  console.log("  ✓ State machine transitions (PENDING → PLANNING → RUNNING → COMPLETED)");
  console.log("  ✓ Resumable execution for long-running tasks");
  console.log("  ✓ Complete event history and audit trail");
  console.log("  ✓ Progress tracking and status updates");
}

main().catch(console.error);
