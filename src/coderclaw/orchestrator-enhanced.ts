/**
 * Enhanced multi-agent orchestration engine for coderClaw Phase 2
 * Integrates with distributed task engine and transport layer
 */

import crypto from "node:crypto";
import { spawnSubagentDirect, type SpawnSubagentContext } from "../agents/subagent-spawn.js";
import { globalTaskEngine } from "../transport/task-engine.js";
import type { TaskStatus as TransportTaskStatus, TaskState } from "../transport/types.js";

// Re-export transport task status for backward compatibility
export type TaskStatus = TransportTaskStatus;

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
 * Convert transport TaskState to orchestrator Task
 */
function taskStateToTask(state: TaskState, deps: string[] = [], dependents: string[] = []): Task {
  return {
    id: state.id,
    description: state.description,
    agentRole: state.agentId || "general-purpose",
    status: state.status,
    input: state.description,
    output: state.output,
    error: state.error,
    childSessionKey: state.sessionId,
    createdAt: state.createdAt,
    startedAt: state.startedAt,
    completedAt: state.completedAt,
    dependencies: deps,
    dependents,
  };
}

/**
 * Enhanced orchestrator with distributed task management
 */
export class EnhancedAgentOrchestrator {
  private workflows = new Map<string, Workflow>();
  private workflowDependencies = new Map<string, Map<string, { deps: string[]; dependents: string[] }>>();
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

    const dependencies = new Map<string, { deps: string[]; dependents: string[] }>();

    // Create tasks from steps
    const stepToTaskId = new Map<number, string>();
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const taskId = crypto.randomUUID();
      stepToTaskId.set(i, taskId);

      const task: Task = {
        id: taskId,
        description: step.task,
        agentRole: step.role,
        status: "pending",
        input: step.task,
        dependencies: [],
        dependents: [],
        createdAt: new Date(),
      };
      workflow.tasks.set(taskId, task);
      dependencies.set(taskId, { deps: [], dependents: [] });
    }

    // Build dependency relationships
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const taskId = stepToTaskId.get(i)!;
      const task = workflow.tasks.get(taskId)!;

      if (step.dependsOn) {
        for (const depStepTask of step.dependsOn) {
          const depIndex = steps.findIndex((s) => s.task === depStepTask);
          if (depIndex !== -1) {
            const depTaskId = stepToTaskId.get(depIndex);
            if (depTaskId) {
              task.dependencies.push(depTaskId);
              const depTask = workflow.tasks.get(depTaskId);
              if (depTask && !depTask.dependents.includes(taskId)) {
                depTask.dependents.push(taskId);
              }

              const depInfo = dependencies.get(taskId)!;
              depInfo.deps.push(depTaskId);
              const depDepInfo = dependencies.get(depTaskId)!;
              depDepInfo.dependents.push(taskId);
            }
          }
        }
      }
    }

    this.workflows.set(id, workflow);
    this.workflowDependencies.set(id, dependencies);
    return workflow;
  }

  /**
   * Execute a workflow using distributed task engine
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
   * Execute a single task using distributed task engine
   */
  private async executeTask(
    task: Task,
    workflow: Workflow,
    context: SpawnSubagentContext,
  ): Promise<string> {
    // Create task in distributed engine
    const taskState = await globalTaskEngine.createTask({
      agentId: task.agentRole,
      description: task.description,
      input: task.input,
      metadata: { workflowId: workflow.id },
    });

    task.status = "planning";
    task.startedAt = new Date();

    await globalTaskEngine.updateTaskStatus(taskState.id, "planning");

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

    await globalTaskEngine.updateTaskStatus(taskState.id, "running");
    task.status = "running";

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

      await globalTaskEngine.setTaskOutput(taskState.id, output);
      await globalTaskEngine.updateTaskStatus(taskState.id, "completed");

      return output;
    } else {
      task.status = "failed";
      task.error = result.error || "Failed to spawn subagent";
      task.completedAt = new Date();

      await globalTaskEngine.setTaskError(taskState.id, task.error);

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
  async cancelWorkflow(workflowId: string): Promise<void> {
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
 * Global enhanced orchestrator instance
 */
export const globalEnhancedOrchestrator = new EnhancedAgentOrchestrator();

/**
 * Common workflow patterns (preserved from original)
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
      dependsOn: [`Analyze the architecture for implementing: ${featureDescription}`],
    },
    {
      role: "test-generator",
      task: `Generate tests for: ${featureDescription}`,
      dependsOn: [`Implement the feature: ${featureDescription}`],
    },
    {
      role: "code-reviewer",
      task: `Review the implementation of: ${featureDescription}`,
      dependsOn: [`Generate tests for: ${featureDescription}`],
    },
  ];
}

export function createBugFixWorkflow(bugDescription: string): WorkflowStep[] {
  return [
    {
      role: "bug-analyzer",
      task: `Diagnose and propose fix for: ${bugDescription}`,
    },
    {
      role: "code-creator",
      task: `Implement the fix for: ${bugDescription}`,
      dependsOn: [`Diagnose and propose fix for: ${bugDescription}`],
    },
    {
      role: "test-generator",
      task: `Generate regression tests for: ${bugDescription}`,
      dependsOn: [`Implement the fix for: ${bugDescription}`],
    },
    {
      role: "code-reviewer",
      task: `Review the bug fix for: ${bugDescription}`,
      dependsOn: [`Generate regression tests for: ${bugDescription}`],
    },
  ];
}

export function createRefactorWorkflow(scope: string): WorkflowStep[] {
  return [
    {
      role: "code-reviewer",
      task: `Identify refactoring opportunities in: ${scope}`,
    },
    {
      role: "refactor-agent",
      task: `Refactor code in: ${scope}`,
      dependsOn: [`Identify refactoring opportunities in: ${scope}`],
    },
    {
      role: "test-generator",
      task: `Ensure test coverage for refactored code in: ${scope}`,
      dependsOn: [`Refactor code in: ${scope}`],
    },
  ];
}

// Maintain backward compatibility by exporting original orchestrator
export { AgentOrchestrator } from "./orchestrator-legacy.js";
export { globalOrchestrator } from "./orchestrator-legacy.js";
