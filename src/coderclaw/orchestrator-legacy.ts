/**
 * Multi-agent orchestration engine for coderClaw
 */

import crypto from "node:crypto";
import { spawnSubagentDirect, type SpawnSubagentContext } from "../agents/subagent-spawn.js";

export type TaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export type Task = {
  id: string;
  description: string;
  agentRole: string;
  status: TaskStatus;
  input: string;
  output?: string;
  error?: string;
  childSessionKey?: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  dependencies: string[];
  dependents: string[];
};

export type WorkflowStep = {
  role: string;
  task: string;
  dependsOn?: string[];
};

export type Workflow = {
  id: string;
  steps: WorkflowStep[];
  tasks: Map<string, Task>;
  status: TaskStatus;
};

/**
 * Orchestrator manages multi-agent workflows
 */
export class AgentOrchestrator {
  private workflows = new Map<string, Workflow>();
  private taskResults = new Map<string, string>();

  /**
   * Create a new workflow
   */
  createWorkflow(steps: WorkflowStep[]): Workflow {
    const id = crypto.randomUUID();
    const workflow: Workflow = {
      id,
      steps,
      tasks: new Map(),
      status: "pending",
    };

    // Create tasks from steps
    for (const step of steps) {
      const taskId = crypto.randomUUID();
      const task: Task = {
        id: taskId,
        description: step.task,
        agentRole: step.role,
        status: "pending",
        input: step.task,
        dependencies: step.dependsOn || [],
        dependents: [],
        createdAt: new Date(),
      };
      workflow.tasks.set(taskId, task);
    }

    // Build dependent relationships
    const stepToTaskId = new Map<number, string>();
    let index = 0;
    for (const [taskId] of workflow.tasks) {
      stepToTaskId.set(index++, taskId);
    }

    index = 0;
    for (const step of steps) {
      const taskId = stepToTaskId.get(index++)!;

      if (step.dependsOn) {
        for (const depStepId of step.dependsOn) {
          const depIndex = steps.findIndex((s) => s.task === depStepId);
          if (depIndex !== -1) {
            const depTaskId = stepToTaskId.get(depIndex);
            if (depTaskId) {
              const depTask = workflow.tasks.get(depTaskId);
              if (depTask && !depTask.dependents.includes(taskId)) {
                depTask.dependents.push(taskId);
              }
            }
          }
        }
      }
    }

    this.workflows.set(id, workflow);
    return workflow;
  }

  /**
   * Execute a workflow
   */
  async executeWorkflow(
    workflowId: string,
    context: SpawnSubagentContext,
  ): Promise<Map<string, string>> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    workflow.status = "running";
    const results = new Map<string, string>();

    // Execute tasks in dependency order
    const executedTasks = new Set<string>();

    while (executedTasks.size < workflow.tasks.size) {
      const nextTasks = Array.from(workflow.tasks.values()).filter(
        (task) =>
          task.status === "pending" && task.dependencies.every((depId) => executedTasks.has(depId)),
      );

      if (nextTasks.length === 0) {
        // No more tasks can run - check if we're done or stuck
        const remainingTasks = Array.from(workflow.tasks.values()).filter(
          (task) => task.status !== "completed" && task.status !== "failed",
        );

        if (remainingTasks.length > 0) {
          workflow.status = "failed";
          throw new Error(`Workflow stuck - cannot execute remaining tasks`);
        }
        break;
      }

      // Execute tasks in parallel when possible
      await Promise.all(
        nextTasks.map(async (task) => {
          try {
            const result = await this.executeTask(task, workflow, context);
            results.set(task.id, result);
            executedTasks.add(task.id);
          } catch (error) {
            task.status = "failed";
            task.error = error instanceof Error ? error.message : String(error);
            executedTasks.add(task.id);
          }
        }),
      );
    }

    // Check if all tasks completed successfully
    const failedTasks = Array.from(workflow.tasks.values()).filter(
      (task) => task.status === "failed",
    );

    if (failedTasks.length > 0) {
      workflow.status = "failed";
    } else {
      workflow.status = "completed";
    }

    return results;
  }

  /**
   * Execute a single task
   */
  private async executeTask(
    task: Task,
    workflow: Workflow,
    context: SpawnSubagentContext,
  ): Promise<string> {
    task.status = "running";
    task.startedAt = new Date();

    // Build task input with dependency results
    let taskInput = task.input;

    if (task.dependencies.length > 0) {
      taskInput += "\n\nPrevious Results:\n";
      for (const depId of task.dependencies) {
        const result = this.taskResults.get(depId);
        if (result) {
          taskInput += `\n${result}\n`;
        }
      }
    }

    // Spawn subagent for the task
    const result = await spawnSubagentDirect(
      {
        task: taskInput,
        label: task.description,
        agentId: task.agentRole,
      },
      context,
    );

    if (result.status === "accepted") {
      task.childSessionKey = result.childSessionKey;
      task.status = "completed";
      task.completedAt = new Date();

      const output = `Task ${task.id} completed successfully`;
      task.output = output;
      this.taskResults.set(task.id, output);

      return output;
    } else {
      task.status = "failed";
      task.error = result.error || "Failed to spawn subagent";
      task.completedAt = new Date();
      throw new Error(task.error);
    }
  }

  /**
   * Get workflow status
   */
  getWorkflowStatus(workflowId: string): Workflow | null {
    return this.workflows.get(workflowId) || null;
  }

  /**
   * Cancel a workflow
   */
  cancelWorkflow(workflowId: string): void {
    const workflow = this.workflows.get(workflowId);
    if (workflow) {
      workflow.status = "cancelled";
      for (const task of workflow.tasks.values()) {
        if (task.status === "pending" || task.status === "running") {
          task.status = "cancelled";
        }
      }
    }
  }

  /**
   * Get all workflows
   */
  getAllWorkflows(): Workflow[] {
    return Array.from(this.workflows.values());
  }
}

/**
 * Global orchestrator instance
 */
export const globalOrchestrator = new AgentOrchestrator();

/**
 * Common workflow patterns
 */

/**
 * Feature Development Workflow
 */
export function createFeatureWorkflow(featureDescription: string): WorkflowStep[] {
  return [
    {
      role: "architecture-advisor",
      task: `Analyze the architecture for implementing: ${featureDescription}`,
    },
    {
      role: "code-creator",
      task: `Implement the feature: ${featureDescription}`,
      dependsOn: ["architecture-advisor"],
    },
    {
      role: "test-generator",
      task: `Generate tests for: ${featureDescription}`,
      dependsOn: ["code-creator"],
    },
    {
      role: "code-reviewer",
      task: `Review the implementation of: ${featureDescription}`,
      dependsOn: ["test-generator"],
    },
  ];
}

/**
 * Bug Fix Workflow
 */
export function createBugFixWorkflow(bugDescription: string): WorkflowStep[] {
  return [
    {
      role: "bug-analyzer",
      task: `Diagnose and propose fix for: ${bugDescription}`,
    },
    {
      role: "code-creator",
      task: `Implement the fix for: ${bugDescription}`,
      dependsOn: ["bug-analyzer"],
    },
    {
      role: "test-generator",
      task: `Generate regression tests for: ${bugDescription}`,
      dependsOn: ["code-creator"],
    },
    {
      role: "code-reviewer",
      task: `Review the bug fix for: ${bugDescription}`,
      dependsOn: ["test-generator"],
    },
  ];
}

/**
 * Refactoring Workflow
 */
export function createRefactorWorkflow(scope: string): WorkflowStep[] {
  return [
    {
      role: "code-reviewer",
      task: `Identify refactoring opportunities in: ${scope}`,
    },
    {
      role: "refactor-agent",
      task: `Refactor code in: ${scope}`,
      dependsOn: ["code-reviewer"],
    },
    {
      role: "test-generator",
      task: `Ensure test coverage for refactored code in: ${scope}`,
      dependsOn: ["refactor-agent"],
    },
  ];
}
