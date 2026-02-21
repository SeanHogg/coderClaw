/**
 * Example 1: Initialize a coderClaw project
 *
 * This example demonstrates how to initialize a new project with coderClaw's
 * persistent context engine, creating the .coderClaw directory structure.
 */

import {
  initializeCoderClawProject,
  isCoderClawProject,
  loadProjectContext,
  loadProjectRules,
} from "../../src/coderclaw/project-context.js";

async function main() {
  const projectRoot = process.cwd() + "/test-project";

  console.log("🦞 coderClaw Project Initialization Example\n");

  // Check if already initialized
  const isInitialized = await isCoderClawProject(projectRoot);
  if (isInitialized) {
    console.log("✓ Project already initialized");
    return;
  }

  // Initialize project with context
  console.log("Initializing coderClaw project...");
  await initializeCoderClawProject(projectRoot, {
    projectName: "test-project",
    description: "A test project demonstrating coderClaw capabilities",
    languages: ["typescript", "javascript"],
    frameworks: ["express", "react"],
    architecture: {
      style: "layered",
      layers: ["presentation", "business", "data"],
      patterns: ["mvc", "repository"],
    },
    buildSystem: "npm",
    testFramework: "vitest",
    lintingTools: ["eslint", "prettier"],
  });

  console.log("✓ Project initialized!\n");

  // Load and display context
  const context = await loadProjectContext(projectRoot);
  console.log("Project Context:");
  console.log(JSON.stringify(context, null, 2));

  // Load and display rules
  const rules = await loadProjectRules(projectRoot);
  console.log("\nProject Rules:");
  console.log(JSON.stringify(rules, null, 2));

  console.log("\n✓ .coderClaw directory created with:");
  console.log("  - context.yaml (project metadata)");
  console.log("  - architecture.md (design documentation)");
  console.log("  - rules.yaml (coding standards)");
  console.log("  - agents/ (custom agent roles)");
  console.log("  - skills/ (project-specific skills)");
  console.log("  - memory/ (knowledge base)");
}

main().catch(console.error);
