/**
 * Multi-agent orchestration engine for coderClaw
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSubagentDirect, type SpawnSubagentContext } from "../agents/subagent-spawn.js";
import type { IRelayService } from "./relay-service.js";
import { awaitLocalSubagentResult } from "../infra/local-result-broker.js";
import { awaitRemoteResult } from "../infra/remote-result-broker.js";
import {
  dispatchToRemoteClaw,
  selectClawByCapability,
  type RemoteDispatchOptions,
} from "../infra/remote-subagent.js";
import { getSsmMemoryService } from "../infra/ssm-memory-service.js";
import {
  emitTaskEnd,
  emitTaskStart,
  emitWorkflowEnd,
  emitWorkflowStart,
  initTelemetry,
} from "../infra/workflow-telemetry.js";
import { logDebug } from "../logger.js";
import { findAgentRole } from "./agent-roles.js";
import {
  saveWorkflowState,
  loadWorkflowState,
  listIncompleteWorkflowIds,
  type PersistedWorkflow,
  type PersistedTask,
} from "./project-context.js";
import {
  DEFAULT_ROUTING_RULES,
  parseRoutingRules,
  resolveRouting,
  type RoutingRule,
} from "./routing-rules.js";

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
  /** Merged routing rules (defaults + user-defined from .coderClaw/routing-rules.json). */
  private routingRules: RoutingRule[] = DEFAULT_ROUTING_RULES;
  /** Relay service reference for cross-claw context fetching (P4-2). */
  private relayService: IRelayService | null = null;

  /** Enable disk persistence for workflows and workflow telemetry. Call at gateway startup. */
  setProjectRoot(
    root: string,
    clawId?: string | null,
    linkApiUrl?: string | null,
    linkApiKey?: string | null,
  ): void {
    this.projectRoot = root;
    initTelemetry({ projectRoot: root, clawId, linkApiUrl, linkApiKey });
    // Load user-defined routing rules asynchronously — non-fatal if absent
    void this.loadRoutingRules(root);
  }

  /**
   * Load routing rules from `.coderClaw/routing-rules.json` and merge with defaults.
   * User-defined rules are prepended (higher effective priority) over the built-in defaults.
   */
  private async loadRoutingRules(projectRoot: string): Promise<void> {
    const filePath = path.join(projectRoot, ".coderClaw", "routing-rules.json");
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      const parsed = parseRoutingRules(JSON.parse(raw));
      if (parsed.length > 0) {
        // User rules come first (higher priority); then defaults as fallback
        this.routingRules = [...parsed, ...DEFAULT_ROUTING_RULES];
        logDebug(`[orchestrator] loaded ${parsed.length} routing rule(s) from ${filePath}`);
      }
    } catch {
      // File absent or invalid JSON — use defaults silently
    }
  }

  /**
   * Configure remote dispatch credentials so "remote:<clawId>" workflow steps
   * can delegate tasks to peer claws via Builderforce.
   * Call once at gateway startup when BUILDERFORCE_API_KEY is present.
   */
  setRemoteDispatchOptions(opts: RemoteDispatchOptions): void {
    this.remoteDispatchOpts = opts;
  }

  /**
   * Register the BuilderforceRelayService so the orchestrator can fetch remote
   * context bundles (P4-2) before dispatching to a remote claw.
   */
  setRelayService(relay: IRelayService): void {
    this.relayService = relay;
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
    emitWorkflowStart(workflowId);
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
    emitWorkflowEnd(workflowId, workflow.status === "failed");
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
   * Prepends a [Memory Context] block to `prompt` using the SSM semantic memory
   * layer.  Also injects top-5 team memory entries if available (P4-5).
   * Silently returns the original prompt if the service is unavailable or if
   * recall fails.
   */
  private async injectMemoryContext(taskDescription: string, prompt: string): Promise<string> {
    let prefix = "";

    const ssmSvc = getSsmMemoryService();
    if (ssmSvc) {
      try {
        // Team memory context (P4-5)
        const teamMemCtx = await ssmSvc.buildTeamMemoryContext();
        if (teamMemCtx) {
          prefix += teamMemCtx;
        }
      } catch (err) {
        logDebug(`[orchestrator] team memory injection failed: ${String(err)}`);
      }

      try {
        const entries = await ssmSvc.recallSimilar(taskDescription, 5);
        if (entries.length > 0) {
          const lines = ["[Memory Context]"];
          for (const entry of entries) {
            lines.push(`- ${entry.key}: ${entry.content}`);
          }
          lines.push("[End Memory Context]", "");
          prefix += lines.join("\n");
        }
      } catch (err) {
        logDebug(`[orchestrator] memory injection failed: ${String(err)}`);
      }
    }

    return prefix ? prefix + prompt : prompt;
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
    emitTaskStart(workflow.id, task.id, task.agentRole, task.description);

    // Build structured context block for this task
    let taskInput = this.buildStructuredContext(task, workflow);

    // Prepend semantic memory context if the SSM memory layer is available
    taskInput = await this.injectMemoryContext(task.description, taskInput);

    // Resolve routing target for this task based on configured rules.
    // Routing only applies to local dispatch — remote roles bypass this.
    if (!task.agentRole.startsWith("remote:")) {
      const routingTarget = resolveRouting(task, this.routingRules);
      logDebug(
        `[orchestrator] routing task ${task.id} (role=${task.agentRole}) → ${JSON.stringify(routingTarget)}`,
      );
      // When routing points to a remote target, rewrite the agentRole so the
      // existing remote dispatch path below handles it.
      if (routingTarget.type === "remote") {
        const remoteId = routingTarget.clawId ?? "auto";
        const caps = routingTarget.capabilities?.length
          ? `[${routingTarget.capabilities.join(",")}]`
          : "";
        task.agentRole = `remote:${remoteId}${caps}`;
      }
      // local/cloud routing is informational at this layer — the embedded runner
      // respects the model configured per-agent; a future enhancement can pass
      // the resolved provider directly to spawnSubagentDirect.
    }

    // Remote dispatch: role "remote:<clawId>", "remote:auto", or "remote:auto[cap1,cap2]"
    // delegates the task to a peer claw via Builderforce.
    if (task.agentRole.startsWith("remote:")) {
      if (!this.remoteDispatchOpts) {
        task.status = "failed";
        task.error =
          "Remote dispatch not configured — set BUILDERFORCE_API_KEY and builderforce.instanceId";
        task.completedAt = new Date();
        emitTaskEnd(workflow.id, task.id, task.agentRole, task.startedAt, task.error);
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
          emitTaskEnd(workflow.id, task.id, task.agentRole, task.startedAt, task.error);
          this.persistWorkflow(workflow);
          throw new Error(task.error);
        }
        targetClawId = String(selected.id);
        logDebug(`[orchestrator] selected claw ${targetClawId} (${selected.name})`);
      }

      // Fetch remote context bundle before dispatch so the remote claw has
      // up-to-date context from this claw's .coderClaw/ directory (P4-2).
      if (this.relayService) {
        try {
          await this.relayService.fetchRemoteContext(targetClawId);
          // Inject a summary of available remote context files into the task input
          const remoteCtxDir = this.projectRoot
            ? path.join(this.projectRoot, ".coderClaw", "remote-context", targetClawId)
            : null;
          if (remoteCtxDir) {
            const ctxFiles = await fs.readdir(remoteCtxDir, { recursive: true }).catch(() => []);
            if (ctxFiles.length > 0) {
              taskInput =
                `[Remote Context for claw ${targetClawId}]\n` +
                `Available context files: ${ctxFiles.slice(0, 20).join(", ")}\n` +
                `[End Remote Context]\n\n` +
                taskInput;
            }
          }
        } catch (err) {
          logDebug(`[orchestrator] fetchRemoteContext failed: ${String(err)}`);
        }
      }

      const correlationId = crypto.randomUUID();
      const remoteResult = await dispatchToRemoteClaw(
        this.remoteDispatchOpts,
        targetClawId,
        taskInput,
        { correlationId, callbackClawId: this.remoteDispatchOpts.myClawId },
      );
      if (remoteResult.status === "accepted") {
        // Wait for the remote claw to send results back (up to 10 minutes).
        // Falls back to a placeholder if the remote claw does not support result callbacks.
        let output: string;
        try {
          output = await awaitRemoteResult(correlationId, 600_000);
        } catch {
          output = `Task ${task.id} dispatched to remote claw ${targetClawId} (result pending)`;
        }
        task.status = "completed";
        task.completedAt = new Date();
        task.output = output;
        this.taskResults.set(task.id, output);
        emitTaskEnd(workflow.id, task.id, task.agentRole, task.startedAt);
        this.persistWorkflow(workflow);
        return output;
      } else {
        task.status = "failed";
        task.error = remoteResult.error;
        task.completedAt = new Date();
        emitTaskEnd(workflow.id, task.id, task.agentRole, task.startedAt, task.error);
        this.persistWorkflow(workflow);
        throw new Error(task.error);
      }
    }

    // Local dispatch: spawn a subagent in this process.
    const roleConfig = findAgentRole(task.agentRole);
    if (!roleConfig) {
      const err = `Unknown agent role: ${task.agentRole}. Define it in .coderclaw/personas/ or use a built-in role.`;
      emitTaskEnd(workflow.id, task.id, task.agentRole, task.startedAt, err);
      throw new Error(err);
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

      // Await the subagent's actual output so dependent tasks receive real context
      // rather than a placeholder. spawnSubagentDirect is fire-and-forget; the
      // local-result-broker subscribes to the lifecycle end event and fetches the
      // session history to extract the last assistant message.
      const rawOutput = await awaitLocalSubagentResult(
        result.runId ?? "",
        result.childSessionKey ?? "",
        600_000,
      );

      task.status = "completed";
      task.completedAt = new Date();
      const output = rawOutput || `Task ${task.id} completed`;
      task.output = output;
      this.taskResults.set(task.id, output);
      emitTaskEnd(workflow.id, task.id, task.agentRole, task.startedAt);
      this.persistWorkflow(workflow);

      return output;
    } else {
      task.status = "failed";
      task.error = result.error || "Failed to spawn subagent";
      task.completedAt = new Date();
      emitTaskEnd(workflow.id, task.id, task.agentRole, task.startedAt, task.error);
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
      dependsOn: [`Identify refactoring opportunities in: ${scope}`],
    },
    {
      role: "test-generator",
      task: `Ensure test coverage for refactored code in: ${scope}`,
      dependsOn: [`Refactor code in: ${scope}`],
    },
  ];
}

/**
 * Security Audit Workflow
 *
 * Four-phase audit:
 *   1. Threat model — identify attack surface, trust boundaries, data flows
 *   2. Vulnerability scan — OWASP Top 10, injection, secrets, auth/authz gaps
 *   3. Fix recommendations — prioritised remediation plan with code examples
 *   4. Verification report — confirm fixes, residual risk summary, sign-off checklist
 */
export function createSecurityAuditWorkflow(target: string): WorkflowStep[] {
  return [
    {
      role: "architecture-advisor",
      task: `Build a threat model for: ${target}. Identify attack surface, trust boundaries, data flows, and external integrations.`,
    },
    {
      role: "bug-analyzer",
      task: `Perform a security vulnerability scan of: ${target}. Check for OWASP Top 10 (injection, XSS, CSRF, broken auth, sensitive data exposure, SSRF, etc.), hardcoded secrets, insecure dependencies, and missing input validation.`,
      dependsOn: [`Build a threat model for: ${target}. Identify attack surface, trust boundaries, data flows, and external integrations.`],
    },
    {
      role: "code-creator",
      task: `Produce prioritised remediation recommendations for all vulnerabilities found in: ${target}. Include concrete code examples or patches for the highest-severity issues.`,
      dependsOn: [`Perform a security vulnerability scan of: ${target}. Check for OWASP Top 10 (injection, XSS, CSRF, broken auth, sensitive data exposure, SSRF, etc.), hardcoded secrets, insecure dependencies, and missing input validation.`],
    },
    {
      role: "code-reviewer",
      task: `Review the proposed security fixes for: ${target}. Verify completeness, check for regressions, and produce a final sign-off checklist with residual risk summary.`,
      dependsOn: [`Produce prioritised remediation recommendations for all vulnerabilities found in: ${target}. Include concrete code examples or patches for the highest-severity issues.`],
    },
  ];
}

/**
 * Planning Workflow
 *
 * Architecture Advisor builds a PRD and architecture spec, then decomposes it
 * into an actionable task list.
 */
export function createPlanningWorkflow(goal: string): WorkflowStep[] {
  return [
    {
      role: "architecture-advisor",
      task: `Write a Product Requirements Document (PRD) for: ${goal}`,
    },
    {
      role: "architecture-advisor",
      task: `Write a detailed architecture specification for: ${goal}`,
      dependsOn: [`Write a Product Requirements Document (PRD) for: ${goal}`],
    },
    {
      role: "architecture-advisor",
      task: `Decompose into an ordered task list with dependencies for: ${goal}`,
      dependsOn: [`Write a detailed architecture specification for: ${goal}`],
    },
  ];
}

/**
 * Adversarial Review Workflow
 *
 * One agent produces output, a second critiques it, a third synthesizes the final result.
 */
export function createAdversarialReviewWorkflow(subject: string): WorkflowStep[] {
  return [
    {
      role: "architecture-advisor",
      task: `Produce a detailed proposal for: ${subject}`,
    },
    {
      role: "code-reviewer",
      task: `Critically review the proposal for gaps, errors, and blind spots in: ${subject}`,
      dependsOn: [`Produce a detailed proposal for: ${subject}`],
    },
    {
      role: "architecture-advisor",
      task: `Synthesize the critique into a revised, final proposal for: ${subject}`,
      dependsOn: [
        `Critically review the proposal for gaps, errors, and blind spots in: ${subject}`,
      ],
    },
  ];
}
