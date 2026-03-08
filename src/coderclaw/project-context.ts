import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { loadPersonasFromDir, PERSONAS_SUBDIR } from "./personas.js";
import type {
  ProjectContext,
  ProjectRules,
  AgentRole,
  SessionHandoff,
  PersonaAssignment,
  PersonaPlugin,
} from "./types.js";

const CODERCLAW_DIR = ".coderclaw";
const CONTEXT_FILE = "context.yaml";
const ARCHITECTURE_FILE = "architecture.md";
const RULES_FILE = "rules.yaml";
const GOVERNANCE_FILE = "governance.md";
const WORKSPACE_STATE_FILE = "workspace-state.json";
const AGENTS_DIR = "agents";
const SKILLS_DIR = "skills";
const MEMORY_DIR = "memory";
const SESSIONS_DIR = "sessions";

export type CoderClawDirectory = {
  root: string;
  contextPath: string;
  architecturePath: string;
  rulesPath: string;
  governancePath: string;
  agentsDir: string;
  skillsDir: string;
  memoryDir: string;
  sessionsDir: string;
  /** Project-scoped persona plugins: .coderClaw/personas/ */
  personasDir: string;
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
    governancePath: path.join(root, GOVERNANCE_FILE),
    agentsDir: path.join(root, AGENTS_DIR),
    skillsDir: path.join(root, SKILLS_DIR),
    memoryDir: path.join(root, MEMORY_DIR),
    sessionsDir: path.join(root, SESSIONS_DIR),
    personasDir: path.join(root, PERSONAS_SUBDIR),
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
  await fs.mkdir(dir.sessionsDir, { recursive: true });
  await fs.mkdir(dir.personasDir, { recursive: true });

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
    ...(context?.llm ? { llm: context.llm } : {}),
    ...(context?.clawLink ? { clawLink: context.clawLink } : {}),
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

  // Create placeholder governance.md for project-level policies
  const defaultGovernance = `# Governance Rules

Define project governance in Markdown. These rules will be read by agents and
used to guide decision-making.
`;
  await fs.writeFile(dir.governancePath, defaultGovernance, "utf-8");

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
- \`sessions/\` - Session handoff documents (resume any session instantly)

## Usage

coderClaw agents automatically load context from this directory when working on the project.
`;

  await fs.writeFile(path.join(dir.root, "README.md"), readme, "utf-8");
}

/**
 * Update specific fields in context.yaml without overwriting unrelated data.
 */
export async function updateProjectContextFields(
  projectRoot: string,
  updates: Partial<ProjectContext>,
): Promise<void> {
  const dir = resolveCoderClawDir(projectRoot);
  const raw = await fs.readFile(dir.contextPath, "utf-8");
  const existing = parseYaml(raw) as ProjectContext;
  const updated: ProjectContext = { ...existing, ...updates };
  await fs.writeFile(dir.contextPath, stringifyYaml(updated), "utf-8");
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

export async function loadProjectGovernance(projectRoot: string): Promise<string | null> {
  const dir = resolveCoderClawDir(projectRoot);
  try {
    return await fs.readFile(dir.governancePath, "utf-8");
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

/**
 * Save a session handoff document to .coderClaw/sessions/.
 * Agents call this at the end of a session so the next one can resume
 * instantly without replaying history.
 */
export async function saveSessionHandoff(
  projectRoot: string,
  handoff: SessionHandoff,
): Promise<string> {
  const dir = resolveCoderClawDir(projectRoot);
  await fs.mkdir(dir.sessionsDir, { recursive: true });
  const filename = `${handoff.sessionId}.yaml`;
  const filePath = path.join(dir.sessionsDir, filename);
  await fs.writeFile(filePath, stringifyYaml(handoff), "utf-8");
  return filePath;
}

/**
 * Load the most recent session handoff, giving the next session its starting context.
 * Returns null when no handoff exists (fresh project).
 */
export async function loadLatestSessionHandoff(
  projectRoot: string,
): Promise<SessionHandoff | null> {
  const dir = resolveCoderClawDir(projectRoot);
  try {
    const files = (await fs.readdir(dir.sessionsDir))
      .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
      .toSorted() // ISO timestamps sort lexicographically, newest last
      .toReversed();

    if (files.length === 0) {
      return null;
    }

    const content = await fs.readFile(path.join(dir.sessionsDir, files[0]), "utf-8");
    return parseYaml(content) as SessionHandoff;
  } catch {
    return null;
  }
}

/**
 * List all saved session handoffs, newest first.
 */
export async function listSessionHandoffs(projectRoot: string): Promise<SessionHandoff[]> {
  const dir = resolveCoderClawDir(projectRoot);
  const handoffs: SessionHandoff[] = [];

  try {
    const files = (await fs.readdir(dir.sessionsDir))
      .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
      .toSorted()
      .toReversed();

    for (const file of files) {
      const content = await fs.readFile(path.join(dir.sessionsDir, file), "utf-8");
      handoffs.push(parseYaml(content) as SessionHandoff);
    }
  } catch {
    // Directory doesn't exist or is empty
  }

  return handoffs;
}

// ---------------------------------------------------------------------------
// Workflow persistence
// ---------------------------------------------------------------------------

/**
 * JSON-serializable representation of a workflow task.
 * Dates are stored as ISO strings; Map<string, Task> as Record.
 */
export type PersistedTask = {
  id: string;
  description: string;
  agentRole: string;
  status: string;
  input: string;
  output?: string;
  error?: string;
  childSessionKey?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  dependencies: string[];
  dependents: string[];
};

export type PersistedWorkflow = {
  id: string;
  status: string;
  createdAt: string;
  steps: Array<{ role: string; task: string; dependsOn?: string[] }>;
  tasks: Record<string, PersistedTask>;
  taskResults: Record<string, string>;
};

/**
 * Persist a workflow snapshot to .coderClaw/sessions/workflow-<id>.yaml.
 */
export async function saveWorkflowState(
  projectRoot: string,
  workflow: PersistedWorkflow,
): Promise<void> {
  const dir = resolveCoderClawDir(projectRoot);
  await fs.mkdir(dir.sessionsDir, { recursive: true });
  const filePath = path.join(dir.sessionsDir, `workflow-${workflow.id}.yaml`);
  await fs.writeFile(filePath, stringifyYaml(workflow), "utf-8");
}

/**
 * Load a persisted workflow snapshot from .coderClaw/sessions/workflow-<id>.yaml.
 * Returns null if not found.
 */
export async function loadWorkflowState(
  projectRoot: string,
  workflowId: string,
): Promise<PersistedWorkflow | null> {
  const dir = resolveCoderClawDir(projectRoot);
  const filePath = path.join(dir.sessionsDir, `workflow-${workflowId}.yaml`);
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return parseYaml(content) as PersistedWorkflow;
  } catch {
    return null;
  }
}

/**
 * List all incomplete workflow IDs (status is "pending" or "running").
 * Used at startup to surface workflows that survived a restart.
 */
export async function listIncompleteWorkflowIds(projectRoot: string): Promise<string[]> {
  const dir = resolveCoderClawDir(projectRoot);
  try {
    const files = await fs.readdir(dir.sessionsDir);
    const ids: string[] = [];
    for (const file of files) {
      if (!file.startsWith("workflow-") || !file.endsWith(".yaml")) {
        continue;
      }
      const content = await fs.readFile(path.join(dir.sessionsDir, file), "utf-8");
      const wf = parseYaml(content) as PersistedWorkflow;
      if (wf.status === "pending" || wf.status === "running") {
        ids.push(wf.id);
      }
    }
    return ids;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Workspace state (workspace-state.json)
// ---------------------------------------------------------------------------

export type WorkspaceState = {
  version: number;
  bootstrapSeededAt?: string;
  lastSyncedAt?: string;
  syncCount?: number;
};

export async function loadWorkspaceState(projectRoot: string): Promise<WorkspaceState> {
  const dir = resolveCoderClawDir(projectRoot);
  const filePath = path.join(dir.root, WORKSPACE_STATE_FILE);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as WorkspaceState;
  } catch {
    return { version: 1 };
  }
}

export async function updateWorkspaceState(
  projectRoot: string,
  updates: Partial<WorkspaceState>,
): Promise<void> {
  const dir = resolveCoderClawDir(projectRoot);
  const filePath = path.join(dir.root, WORKSPACE_STATE_FILE);
  const existing = await loadWorkspaceState(projectRoot);
  const updated: WorkspaceState = { ...existing, ...updates };
  await fs.mkdir(dir.root, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(updated, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// Knowledge memory
// ---------------------------------------------------------------------------

/**
 * Append a knowledge entry to .coderclaw/memory/YYYY-MM-DD.md.
 * Creates the file and directory if they do not exist.
 */
export async function appendKnowledgeMemory(projectRoot: string, entry: string): Promise<void> {
  const dir = resolveCoderClawDir(projectRoot);
  await fs.mkdir(dir.memoryDir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const filePath = path.join(dir.memoryDir, `${date}.md`);
  await fs.appendFile(filePath, entry, "utf-8");
}

// ---------------------------------------------------------------------------
// Persona plugin helpers
// ---------------------------------------------------------------------------

/**
 * Load project-scoped persona plugins from `.coderClaw/personas/`.
 * Returns an empty array when the directory does not exist.
 */
export async function loadProjectPersonaPlugins(projectRoot: string): Promise<PersonaPlugin[]> {
  const dir = resolveCoderClawDir(projectRoot);
  return loadPersonasFromDir(dir.personasDir, "project-local");
}

/**
 * Read persona assignments from `context.yaml`.
 * Returns an empty array when none are configured.
 */
export async function loadPersonaAssignments(projectRoot: string): Promise<PersonaAssignment[]> {
  try {
    const context = await loadProjectContext(projectRoot);
    return context?.personas?.assignments ?? [];
  } catch {
    return [];
  }
}

/**
 * Persist a persona assignment to `context.yaml`.
 * Merges with existing assignments; replaces any existing entry with the same name.
 */
export async function savePersonaAssignment(
  projectRoot: string,
  assignment: PersonaAssignment,
): Promise<void> {
  const context = await loadProjectContext(projectRoot);
  if (!context) {
    return;
  }
  const existing = context.personas?.assignments ?? [];
  const filtered = existing.filter((a) => a.name !== assignment.name);
  const updated: ProjectContext = {
    ...context,
    personas: {
      assignments: [...filtered, assignment],
    },
  };
  await saveProjectContext(projectRoot, updated);
}

/**
 * Remove a persona assignment from `context.yaml`.
 */
export async function removePersonaAssignment(projectRoot: string, name: string): Promise<void> {
  const context = await loadProjectContext(projectRoot);
  if (!context?.personas?.assignments?.length) {
    return;
  }
  const updated: ProjectContext = {
    ...context,
    personas: {
      assignments: context.personas.assignments.filter((a) => a.name !== name),
    },
  };
  await saveProjectContext(projectRoot, updated);
}
