/**
 * Tool for checking workflow status
 */

import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { jsonResult } from "../../agents/tools/common.js";
import { globalOrchestrator } from "../orchestrator.js";

const WorkflowStatusSchema = Type.Object({
  workflowId: Type.String({
    description: "ID of the workflow to check",
  }),
});

type WorkflowStatusParams = {
  workflowId: string;
};

export const workflowStatusTool: AgentTool<typeof WorkflowStatusSchema, string> = {
  name: "workflow_status",
  label: "Workflow Status",
  description: "Check the status of a multi-agent workflow and its tasks.",
  parameters: WorkflowStatusSchema,
  async execute(_toolCallId: string, params: WorkflowStatusParams) {
    const { workflowId } = params;

    try {
      const workflow = globalOrchestrator.getWorkflowStatus(workflowId);

      if (!workflow) {
        return jsonResult({ error: `Workflow ${workflowId} not found` }) as AgentToolResult<string>;
      }

      return jsonResult({
        workflowId: workflow.id,
        status: workflow.status,
        totalTasks: workflow.tasks.size,
        taskStatus: {
          pending: Array.from(workflow.tasks.values()).filter((t) => t.status === "pending").length,
          running: Array.from(workflow.tasks.values()).filter((t) => t.status === "running").length,
          completed: Array.from(workflow.tasks.values()).filter((t) => t.status === "completed")
            .length,
          failed: Array.from(workflow.tasks.values()).filter((t) => t.status === "failed").length,
        },
        tasks: Array.from(workflow.tasks.values()).map((task) => ({
          id: task.id,
          role: task.agentRole,
          description: task.description,
          status: task.status,
          error: task.error,
          createdAt: task.createdAt.toISOString(),
          startedAt: task.startedAt?.toISOString(),
          completedAt: task.completedAt?.toISOString(),
        })),
      }) as AgentToolResult<string>;
    } catch (error) {
      return jsonResult({
        error: `Failed to check workflow status: ${error instanceof Error ? error.message : String(error)}`,
      }) as AgentToolResult<string>;
    }
  },
};
