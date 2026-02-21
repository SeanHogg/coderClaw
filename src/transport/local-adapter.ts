/**
 * Local transport adapter - reference implementation
 * Provides in-process task execution
 */

import type { SpawnSubagentContext } from "../agents/subagent-spawn.js";
import { spawnSubagentDirect } from "../agents/subagent-spawn.js";
import { globalTaskEngine } from "./task-engine.js";
import type {
  AgentInfo,
  SkillInfo,
  TaskState,
  TaskSubmitRequest,
  TaskUpdateEvent,
  TransportAdapter,
} from "./types.js";

/**
 * Local transport adapter implementation
 * Executes tasks in the same process
 */
export class LocalTransportAdapter implements TransportAdapter {
  private context: SpawnSubagentContext;

  constructor(context: SpawnSubagentContext) {
    this.context = context;
  }

  /**
   * Submit a task for local execution
   */
  async submitTask(request: TaskSubmitRequest): Promise<TaskState> {
    // Create task in engine
    const task = await globalTaskEngine.createTask(request);

    // Start execution asynchronously
    this.executeTask(task, request).catch((error) => {
      globalTaskEngine.setTaskError(task.id, error.message || String(error));
    });

    return task;
  }

  /**
   * Execute a task locally
   */
  private async executeTask(task: TaskState, request: TaskSubmitRequest): Promise<void> {
    try {
      // Transition to planning
      await globalTaskEngine.updateTaskStatus(task.id, "planning");

      // Transition to running
      await globalTaskEngine.updateTaskStatus(task.id, "running");

      // Spawn subagent for execution
      const result = await spawnSubagentDirect(
        {
          task: request.input,
          label: request.description,
          agentId: request.agentId,
          model: request.model,
          thinking: request.thinking,
        },
        this.context,
      );

      if (result.status === "accepted") {
        // Task completed successfully
        await globalTaskEngine.setTaskOutput(task.id, "Task completed successfully");
        await globalTaskEngine.updateTaskStatus(task.id, "completed");
      } else {
        // Task failed
        await globalTaskEngine.setTaskError(task.id, result.error || "Failed to spawn subagent");
      }
    } catch (error) {
      await globalTaskEngine.setTaskError(
        task.id,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * Stream task updates
   */
  async *streamTaskUpdates(taskId: string): AsyncIterableIterator<TaskUpdateEvent> {
    yield* globalTaskEngine.streamTaskUpdates(taskId);
  }

  /**
   * Query task state
   */
  async queryTaskState(taskId: string): Promise<TaskState | null> {
    return globalTaskEngine.getTask(taskId);
  }

  /**
   * Cancel a task
   */
  async cancelTask(taskId: string): Promise<boolean> {
    return globalTaskEngine.cancelTask(taskId);
  }

  /**
   * List available agents
   */
  async listAgents(): Promise<AgentInfo[]> {
    // TODO: Integrate with actual agent registry
    return [
      {
        id: "general-purpose",
        name: "General Purpose Agent",
        description: "Full-capability agent for complex tasks",
        capabilities: ["code", "analysis", "orchestration"],
        model: "anthropic/claude-sonnet-4-20250514",
        thinking: "medium",
      },
      {
        id: "explore",
        name: "Explore Agent",
        description: "Fast agent for codebase exploration",
        capabilities: ["grep", "glob", "view"],
        model: "anthropic/claude-3-5-haiku-20241022",
        thinking: "low",
      },
      {
        id: "task",
        name: "Task Agent",
        description: "Agent for executing commands",
        capabilities: ["bash", "test", "build"],
        model: "anthropic/claude-3-5-haiku-20241022",
        thinking: "low",
      },
    ];
  }

  /**
   * List available skills
   */
  async listSkills(): Promise<SkillInfo[]> {
    // TODO: Integrate with actual skill registry
    return [
      {
        id: "coding-agent",
        name: "Coding Agent",
        description: "Interactive coding assistance",
        version: "1.0.0",
        enabled: true,
      },
      {
        id: "github-integration",
        name: "GitHub Integration",
        description: "GitHub repository operations",
        version: "1.0.0",
        enabled: true,
      },
    ];
  }

  /**
   * Close the adapter
   */
  async close(): Promise<void> {
    // Nothing to clean up for local adapter
  }
}
