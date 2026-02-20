/**
 * Tool for querying project knowledge and context
 */

import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { jsonResult } from "../../agents/tools/common.js";
import {
  loadProjectContext,
  loadProjectRules,
  loadProjectArchitecture,
  loadCustomAgentRoles,
} from "../project-context.js";

const ProjectKnowledgeSchema = Type.Object({
  projectRoot: Type.String({
    description: "Root directory of the project",
  }),
  query: Type.String({
    description: "What to query: 'context', 'rules', 'architecture', 'agents', or 'all'",
  }),
});

type ProjectKnowledgeParams = {
  projectRoot: string;
  query: string;
};

export const projectKnowledgeTool: AgentTool<typeof ProjectKnowledgeSchema, string> = {
  name: "project_knowledge",
  label: "Project Knowledge",
  description:
    "Query project-specific knowledge including context, rules, architecture, and custom agent roles from the .coderClaw directory.",
  parameters: ProjectKnowledgeSchema,
  async execute(_toolCallId: string, params: ProjectKnowledgeParams) {
    const { projectRoot, query } = params;

    try {
      const result: Record<string, unknown> = {};

      if (query === "context" || query === "all") {
        const context = await loadProjectContext(projectRoot);
        if (context) {
          result.context = context;
        }
      }

      if (query === "rules" || query === "all") {
        const rules = await loadProjectRules(projectRoot);
        if (rules) {
          result.rules = rules;
        }
      }

      if (query === "architecture" || query === "all") {
        const architecture = await loadProjectArchitecture(projectRoot);
        if (architecture) {
          result.architecture = architecture;
        }
      }

      if (query === "agents" || query === "all") {
        const agents = await loadCustomAgentRoles(projectRoot);
        if (agents.length > 0) {
          result.agents = agents;
        }
      }

      if (Object.keys(result).length === 0) {
        return jsonResult({
          error: "No project knowledge found. Initialize with 'coderclaw init' first.",
        }) as AgentToolResult<string>;
      }

      return jsonResult(result) as AgentToolResult<string>;
    } catch (error) {
      return jsonResult({
        error: `Failed to load project knowledge: ${error instanceof Error ? error.message : String(error)}`,
      }) as AgentToolResult<string>;
    }
  },
};
