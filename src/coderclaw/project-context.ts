import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { ProjectContext, ProjectRules, AgentRole } from "./types.js";

const CODERCLAW_DIR = ".coderClaw";
const CONTEXT_FILE = "context.yaml";
const ARCHITECTURE_FILE = "architecture.md";
const RULES_FILE = "rules.yaml";
const AGENTS_DIR = "agents";
const SKILLS_DIR = "skills";
const MEMORY_DIR = "memory";

export type CoderClawDirectory = {
  root: string;
  contextPath: string;
  architecturePath: string;
  rulesPath: string;
  agentsDir: string;
  skillsDir: string;
  memoryDir: string;
};

/**
 * Resolve the .coderClaw directory for a project
 */
export function resolveCoderClawDir(projectRoot: string): CoderClawDirectory {
  const root = path.join(projectRoot, CODERCLAW_DIR);
  return {
    root,
    contextPath: path.join(root, CONTEXT_FILE),
    architecturePath: path.join(root, ARCHITECTURE_FILE),
    rulesPath: path.join(root, RULES_FILE),
    agentsDir: path.join(root, AGENTS_DIR),
    skillsDir: path.join(root, SKILLS_DIR),
    memoryDir: path.join(root, MEMORY_DIR),
  };
}

/**
 * Check if a project has been initialized with coderClaw
 */
export async function isCoderClawProject(projectRoot: string): Promise<boolean> {
  const dir = resolveCoderClawDir(projectRoot);
  try {
    const stat = await fs.stat(dir.root);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Initialize a new coderClaw project directory
 */
export async function initializeCoderClawProject(
  projectRoot: string,
  context?: Partial<ProjectContext>,
): Promise<void> {
  const dir = resolveCoderClawDir(projectRoot);

  // Create directory structure
  await fs.mkdir(dir.root, { recursive: true });
  await fs.mkdir(dir.agentsDir, { recursive: true });
  await fs.mkdir(dir.skillsDir, { recursive: true });
  await fs.mkdir(dir.memoryDir, { recursive: true });

  // Create default context.yaml
  const defaultContext: ProjectContext = {
    version: 1,
    projectName: context?.projectName || path.basename(projectRoot),
    description: context?.description || "A coderClaw-enabled project",
    rootPath: projectRoot,
    languages: context?.languages || [],
    frameworks: context?.frameworks || [],
    architecture: context?.architecture || {
      style: "unknown",
      layers: [],
      patterns: [],
    },
    buildSystem: context?.buildSystem,
    testFramework: context?.testFramework,
    lintingTools: context?.lintingTools || [],
    dependencies: context?.dependencies || {
      production: {},
      development: {},
    },
    customRules: context?.customRules || [],
    metadata: context?.metadata || {},
  };

  await fs.writeFile(dir.contextPath, stringifyYaml(defaultContext), "utf-8");

  // Create default architecture.md
  const defaultArchitecture = `# Architecture

## Overview

This document describes the architectural design and patterns used in this project.

## Components

### Core Modules

(To be documented)

## Design Patterns

(To be documented)

## Data Flow

(To be documented)

## Dependencies

(To be documented)
`;
  await fs.writeFile(dir.architecturePath, defaultArchitecture, "utf-8");

  // Create default rules.yaml
  const defaultRules: ProjectRules = {
    version: 1,
    codeStyle: {
      indentation: "spaces",
      indentSize: 2,
      lineLength: 100,
      namingConventions: {},
    },
    testing: {
      required: true,
      coverage: 80,
      frameworks: [],
    },
    documentation: {
      required: true,
      format: "markdown",
      location: "docs/",
    },
    git: {
      branchNaming: "feature/*, fix/*, docs/*",
      commitFormat: "conventional",
      requireReview: true,
    },
    constraints: [],
    customRules: [],
  };

  await fs.writeFile(dir.rulesPath, stringifyYaml(defaultRules), "utf-8");

  // Create README
  const readme = `# .coderClaw Directory

This directory contains project-specific context and configuration for coderClaw.

## Structure

- \`context.yaml\` - Project metadata, languages, frameworks, dependencies
- \`architecture.md\` - Architectural documentation and design patterns
- \`rules.yaml\` - Coding standards, testing requirements, git conventions
- \`agents/\` - Custom agent role definitions
- \`skills/\` - Project-specific skills
- \`memory/\` - Project knowledge base and semantic indices

## Usage

coderClaw agents automatically load context from this directory when working on the project.
`;

  await fs.writeFile(path.join(dir.root, "README.md"), readme, "utf-8");
}

/**
 * Load project context from .coderClaw directory
 */
export async function loadProjectContext(projectRoot: string): Promise<ProjectContext | null> {
  const dir = resolveCoderClawDir(projectRoot);
  try {
    const content = await fs.readFile(dir.contextPath, "utf-8");
    return parseYaml(content) as ProjectContext;
  } catch {
    return null;
  }
}

/**
 * Load project rules from .coderClaw directory
 */
export async function loadProjectRules(projectRoot: string): Promise<ProjectRules | null> {
  const dir = resolveCoderClawDir(projectRoot);
  try {
    const content = await fs.readFile(dir.rulesPath, "utf-8");
    return parseYaml(content) as ProjectRules;
  } catch {
    return null;
  }
}

/**
 * Load project architecture documentation
 */
export async function loadProjectArchitecture(projectRoot: string): Promise<string | null> {
  const dir = resolveCoderClawDir(projectRoot);
  try {
    return await fs.readFile(dir.architecturePath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Load custom agent roles from .coderClaw/agents/
 */
export async function loadCustomAgentRoles(projectRoot: string): Promise<AgentRole[]> {
  const dir = resolveCoderClawDir(projectRoot);
  const roles: AgentRole[] = [];

  try {
    const files = await fs.readdir(dir.agentsDir);
    for (const file of files) {
      if (file.endsWith(".yaml") || file.endsWith(".yml")) {
        const content = await fs.readFile(path.join(dir.agentsDir, file), "utf-8");
        const role = parseYaml(content) as AgentRole;
        roles.push(role);
      }
    }
  } catch {
    // Directory doesn't exist or is empty
  }

  return roles;
}

/**
 * Save project context to .coderClaw directory
 */
export async function saveProjectContext(
  projectRoot: string,
  context: ProjectContext,
): Promise<void> {
  const dir = resolveCoderClawDir(projectRoot);
  await fs.mkdir(path.dirname(dir.contextPath), { recursive: true });
  await fs.writeFile(dir.contextPath, stringifyYaml(context), "utf-8");
}

/**
 * Save project rules to .coderClaw directory
 */
export async function saveProjectRules(projectRoot: string, rules: ProjectRules): Promise<void> {
  const dir = resolveCoderClawDir(projectRoot);
  await fs.mkdir(path.dirname(dir.rulesPath), { recursive: true });
  await fs.writeFile(dir.rulesPath, stringifyYaml(rules), "utf-8");
}

/**
 * Save custom agent role definition
 */
export async function saveAgentRole(projectRoot: string, role: AgentRole): Promise<void> {
  const dir = resolveCoderClawDir(projectRoot);
  await fs.mkdir(dir.agentsDir, { recursive: true });
  const filename = `${role.name.toLowerCase().replace(/\s+/g, "-")}.yaml`;
  await fs.writeFile(path.join(dir.agentsDir, filename), stringifyYaml(role), "utf-8");
}
