/**
 * Multi-agent orchestration engine for coderClaw
 */

import crypto from "node:crypto";
import { spawnSubagentDirect, type SpawnSubagentContext } from "../agents/subagent-spawn.js";
import {
  dispatchToRemoteClaw,
  selectClawByCapability,
  type RemoteDispatchOptions,
} from "../infra/remote-subagent.js";
import { logDebug } from "../logger.js";
import { findAgentRole } from "./agent-roles.js";
import {
  saveWorkflowState,
  loadWorkflowState,
  listIncompleteWorkflowIds,
  type PersistedWorkflow,
  type PersistedTask,
} from "./project-context.js";

export type { SpawnSubagentContext } from "../agents/subagent-spawn.js";

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
  createdAt: Date;
};

/**
 * Orchestrator manages multi-agent workflows
 */
export class AgentOrchestrator {
  private workflows = new Map<string, Workflow>();
  private taskResults = new Map<string, string>();
  private projectRoot: string | null = null;
  private remoteDispatchOpts: RemoteDispatchOptions | null = null;

  /** Enable disk persistence for workflows. Call at gateway startup. */
  setProjectRoot(root: string): void {
    this.projectRoot = root;
  }

  /**
   * Configure remote dispatch credentials so "remote:<clawId>" workflow steps
   * can delegate tasks to peer claws via CoderClawLink.
   * Call once at gateway startup when CODERCLAW_LINK_API_KEY is present.
   */
  setRemoteDispatchOptions(opts: RemoteDispatchOptions): void {
    this.remoteDispatchOpts = opts;
  }

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
      createdAt: new Date(),
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
      const task = workflow.tasks.get(taskId);
      if (!task) {
        continue;
      }
      const resolvedDependencies: string[] = [];

      if (step.dependsOn) {
        for (const depStepId of step.dependsOn) {
          const depIndex = steps.findIndex((s) => s.task === depStepId);
          if (depIndex !== -1) {
            const depTaskId = stepToTaskId.get(depIndex);
            if (depTaskId) {
              resolvedDependencies.push(depTaskId);
              const depTask = workflow.tasks.get(depTaskId);
              if (depTask && !depTask.dependents.includes(taskId)) {
                depTask.dependents.push(taskId);
              }
            }
          }
        }
      }

      task.dependencies = resolvedDependencies;
    }

    this.workflows.set(id, workflow);
    this.persistWorkflow(workflow);
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
    this.persistWorkflow(workflow);

    return results;
  }

  /**
   * Build a structured context block for a task, replacing naive text concatenation.
   *
   * Each prior agent's output is labelled with its role and prefixed so the
   * receiving agent knows exactly who produced what.  The role's `outputFormat`
   * prefix (e.g. "REVIEW:" / "ARCH:") is used when available so downstream
   * agents can quickly scan for the section they care about.
   */
  private buildStructuredContext(task: Task, workflow: Workflow): string {
    // Per-dependency result truncation: prevents runaway context when a prior agent
    // produces an unexpectedly large output (e.g. a full codebase dump).
    const MAX_RESULT_CHARS = 8_000;

    const lines: string[] = [];

    lines.push(`## Your Task\n\n${task.input}`);

    if (task.dependencies.length > 0) {
      lines.push(`\n## Context from Prior Agents\n`);
      for (const depId of task.dependencies) {
        const depTask = workflow.tasks.get(depId);
        const result = this.taskResults.get(depId);
        if (depTask && result) {
          const roleConfig = findAgentRole(depTask.agentRole);
          const prefix = roleConfig?.outputFormat?.outputPrefix ?? depTask.agentRole.toUpperCase();
          const body =
            result.length > MAX_RESULT_CHARS
              ? `${result.slice(0, MAX_RESULT_CHARS)}\n…(truncated — ${result.length - MAX_RESULT_CHARS} chars omitted)`
              : result;
          lines.push(`### ${prefix} (${depTask.agentRole})\n\n${body}\n`);
        }
      }
    }

    return lines.join("\n");
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
    this.persistWorkflow(workflow);

    // Build structured context block for this task
    const taskInput = this.buildStructuredContext(task, workflow);

    // Remote dispatch: role "remote:<clawId>", "remote:auto", or "remote:auto[cap1,cap2]"
    // delegates the task to a peer claw via CoderClawLink.
    if (task.agentRole.startsWith("remote:")) {
      if (!this.remoteDispatchOpts) {
        task.status = "failed";
        task.error =
          "Remote dispatch not configured — set CODERCLAW_LINK_API_KEY and clawLink.instanceId";
        task.completedAt = new Date();
        this.persistWorkflow(workflow);
        throw new Error(task.error);
      }

      let targetClawId = task.agentRole.slice("remote:".length);

      // Capability-based routing: "remote:auto" or "remote:auto[cap1,cap2]"
      if (targetClawId === "auto" || targetClawId.startsWith("auto[")) {
        const capMatch = targetClawId.match(/^auto\[(.+)]$/);
        const requiredCaps = capMatch
          ? capMatch[1]
              .split(",")
              .map((c) => c.trim())
              .filter(Boolean)
          : [];
        logDebug(`[orchestrator] capability routing — required: [${requiredCaps.join(", ")}]`);
        const selected = await selectClawByCapability(this.remoteDispatchOpts, requiredCaps);
        if (!selected) {
          task.status = "failed";
          task.error = requiredCaps.length
            ? `No online claw satisfies required capabilities: ${requiredCaps.join(", ")}`
            : "No online peer claws available for automatic routing";
          task.completedAt = new Date();
          this.persistWorkflow(workflow);
          throw new Error(task.error);
        }
        targetClawId = String(selected.id);
        logDebug(`[orchestrator] selected claw ${targetClawId} (${selected.name})`);
      }

      const remoteResult = await dispatchToRemoteClaw(
        this.remoteDispatchOpts,
        targetClawId,
        taskInput,
      );
      if (remoteResult.status === "accepted") {
        task.status = "completed";
        task.completedAt = new Date();
        const output = `Task ${task.id} dispatched to remote claw ${targetClawId}`;
        task.output = output;
        this.taskResults.set(task.id, output);
        this.persistWorkflow(workflow);
        return output;
      } else {
        task.status = "failed";
        task.error = remoteResult.error;
        task.completedAt = new Date();
        this.persistWorkflow(workflow);
        throw new Error(task.error);
      }
    }

    // Local dispatch: spawn a subagent in this process.
    const roleConfig = findAgentRole(task.agentRole);
    if (!roleConfig) {
      throw new Error(
        `Unknown agent role: ${task.agentRole}. Define it in .coderClaw/agents/ or use a built-in role.`,
      );
    }
    const result = await spawnSubagentDirect(
      {
        task: taskInput,
        label: task.description,
        agentId: task.agentRole,
        roleConfig,
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
      this.persistWorkflow(workflow);

      return output;
    } else {
      task.status = "failed";
      task.error = result.error || "Failed to spawn subagent";
      task.completedAt = new Date();
      this.persistWorkflow(workflow);
      throw new Error(task.error);
    }
  }

  /**
   * Get workflow status
   */
  getWorkflowStatus(workflowId: string): Workflow | null {
    return this.workflows.get(workflowId) || null;
  }

  getLatestWorkflow(params?: { activeOnly?: boolean }): Workflow | null {
    const activeOnly = params?.activeOnly ?? false;
    const workflows = Array.from(this.workflows.values());
    if (workflows.length === 0) {
      return null;
    }
    const filtered = activeOnly
      ? workflows.filter((wf) => wf.status === "pending" || wf.status === "running")
      : workflows;
    if (filtered.length === 0) {
      return null;
    }
    return filtered.toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
  }

  getRunnableTasks(workflowId: string): Task[] {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      return [];
    }
    const completed = new Set(
      Array.from(workflow.tasks.values())
        .filter((task) => task.status === "completed")
        .map((task) => task.id),
    );
    return Array.from(workflow.tasks.values()).filter(
      (task) =>
        task.status === "pending" && task.dependencies.every((depId) => completed.has(depId)),
    );
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

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  /**
   * Serialize and write a workflow to .coderClaw/sessions/workflow-<id>.yaml.
   * No-op when projectRoot has not been set.
   */
  private persistWorkflow(workflow: Workflow): void {
    if (!this.projectRoot) {
      return;
    }
    const serialized: PersistedWorkflow = {
      id: workflow.id,
      status: workflow.status,
      createdAt: workflow.createdAt.toISOString(),
      steps: workflow.steps,
      tasks: Object.fromEntries(
        Array.from(workflow.tasks.entries()).map(([id, task]) => [
          id,
          {
            id: task.id,
            description: task.description,
            agentRole: task.agentRole,
            status: task.status,
            input: task.input,
            output: task.output,
            error: task.error,
            childSessionKey: task.childSessionKey,
            createdAt: task.createdAt.toISOString(),
            startedAt: task.startedAt?.toISOString(),
            completedAt: task.completedAt?.toISOString(),
            dependencies: task.dependencies,
            dependents: task.dependents,
          } satisfies PersistedTask,
        ]),
      ),
      taskResults: Object.fromEntries(this.taskResults.entries()),
    };
    // Fire-and-forget — persistence failures are logged, not thrown
    saveWorkflowState(this.projectRoot, serialized).catch((err) => {
      logDebug(`[orchestrator] failed to persist workflow ${workflow.id}: ${String(err)}`);
    });
  }

  /**
   * Deserialize a PersistedWorkflow back into a live Workflow, re-registering
   * it in the in-memory map. Any tasks that were "running" at crash time are
   * reset to "pending" so they can be retried via resumeWorkflow().
   */
  private hydrateWorkflow(persisted: PersistedWorkflow): Workflow {
    const tasks = new Map<string, Task>();
    for (const [id, pt] of Object.entries(persisted.tasks)) {
      tasks.set(id, {
        id: pt.id,
        description: pt.description,
        agentRole: pt.agentRole,
        // Tasks that were in-flight when the process died should be retried
        status: pt.status === "running" ? "pending" : (pt.status as TaskStatus),
        input: pt.input,
        output: pt.output,
        error: pt.error,
        childSessionKey: pt.childSessionKey,
        createdAt: new Date(pt.createdAt),
        startedAt: pt.startedAt ? new Date(pt.startedAt) : undefined,
        completedAt: pt.completedAt ? new Date(pt.completedAt) : undefined,
        dependencies: pt.dependencies,
        dependents: pt.dependents,
      });
    }

    const workflow: Workflow = {
      id: persisted.id,
      steps: persisted.steps,
      tasks,
      status: persisted.status === "running" ? "pending" : (persisted.status as TaskStatus),
      createdAt: new Date(persisted.createdAt),
    };

    // Restore task results so dependency chains work correctly on resume
    for (const [taskId, result] of Object.entries(persisted.taskResults ?? {})) {
      this.taskResults.set(taskId, result);
    }

    this.workflows.set(workflow.id, workflow);
    return workflow;
  }

  /**
   * Load all incomplete workflows from disk into the in-memory map.
   * Call once at gateway startup so agents can resume or inspect them.
   * Returns the IDs of any incomplete workflows found.
   */
  async loadPersistedWorkflows(): Promise<string[]> {
    if (!this.projectRoot) {
      return [];
    }
    try {
      const ids = await listIncompleteWorkflowIds(this.projectRoot);
      for (const id of ids) {
        if (this.workflows.has(id)) {
          continue; // already in memory
        }
        const persisted = await loadWorkflowState(this.projectRoot, id);
        if (persisted) {
          this.hydrateWorkflow(persisted);
          logDebug(`[orchestrator] restored incomplete workflow ${id}`);
        }
      }
      return ids;
    } catch (err) {
      logDebug(`[orchestrator] failed to load persisted workflows: ${String(err)}`);
      return [];
    }
  }

  /**
   * Resume an incomplete workflow that was previously persisted to disk.
   * Already-completed tasks are skipped; pending/reset tasks are re-executed.
   */
  async resumeWorkflow(
    workflowId: string,
    context: SpawnSubagentContext,
  ): Promise<Map<string, string>> {
    // Ensure the workflow is in memory (hydrate from disk if needed)
    if (!this.workflows.has(workflowId) && this.projectRoot) {
      const persisted = await loadWorkflowState(this.projectRoot, workflowId);
      if (!persisted) {
        throw new Error(`Workflow ${workflowId} not found on disk`);
      }
      this.hydrateWorkflow(persisted);
    }
    return this.executeWorkflow(workflowId, context);
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
