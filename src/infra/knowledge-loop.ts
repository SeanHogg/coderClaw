import { appendKnowledgeMemory } from "../coderclaw/project-context.js";
import { logDebug } from "../logger.js";
import { onAgentEvent } from "./agent-events.js";
import { syncCoderClawDirectory, type SyncCoderClawDirParams } from "./clawlink-directory-sync.js";

/**
 * Derive a human-readable one-line summary of what happened in an agent run
 * based on heuristics over the tool activity. No model call required.
 *
 * Priority order (first matching rule wins):
 * 1. "Multi-agent workflow execution"   — orchestrate or workflow_status used
 * 2. "Code review / analysis"           — git_history, code_analysis, or project_knowledge used
 * 3. "Test suite created"               — *.test.* / *.spec.* file created
 * 4. "Tests updated"                    — *.test.* / *.spec.* file edited
 * 5. "Codebase exploration / read-only analysis" — only grep/glob/view, no bash, no file changes
 * 6. "Feature implementation: new files + edits" — both created and edited files
 * 7. "New file(s) created: N"           — only file creation
 * 8. "Code modifications: N file(s) changed" — only file edits
 * 9. "Agent activity (no file changes)" — tools used but no files created or edited
 * 10. ""                                — no activity at all
 *
 * @returns A short English label, or an empty string when there was no activity.
 */
export function deriveActivitySummary(params: {
  created: string[];
  edited: string[];
  tools: string[];
}): string {
  const { created, edited, tools } = params;
  const hasCreate = created.length > 0;
  const hasEdit = edited.length > 0;
  const toolSet = new Set(tools);

  const isTest =
    [...created, ...edited].some(
      (f) => f.includes(".test.") || f.includes(".spec.") || f.includes("__tests__"),
    ) || toolSet.has("test");

  const isAnalysis =
    !hasCreate &&
    !hasEdit &&
    (toolSet.has("grep") || toolSet.has("glob") || toolSet.has("view")) &&
    !toolSet.has("bash");

  const isReview =
    toolSet.has("git_history") || toolSet.has("code_analysis") || toolSet.has("project_knowledge");

  const isOrchestration = toolSet.has("orchestrate") || toolSet.has("workflow_status");

  if (isOrchestration) return "Multi-agent workflow execution";
  if (isReview) return "Code review / analysis";
  if (isTest && hasCreate) return "Test suite created";
  if (isTest && hasEdit) return "Tests updated";
  if (isAnalysis) return "Codebase exploration / read-only analysis";
  if (hasCreate && hasEdit) return "Feature implementation: new files + edits";
  if (hasCreate) return `New file(s) created: ${created.length}`;
  if (hasEdit) return `Code modifications: ${edited.length} file(s) changed`;
  if (tools.length > 0) return "Agent activity (no file changes)";
  return "";
}

export type KnowledgeLoopOptions = {
  workspaceDir: string;
  apiKey?: string | null;
  baseUrl?: string;
  clawId?: string | null;
  projectId?: number;
};

type RunAccumulator = {
  sessionKey: string;
  filesCreated: string[];
  filesEdited: string[];
  toolNames: string[];
};

/**
 * Listens for agent run completions and writes a timestamped activity entry to
 * .coderclaw/memory/YYYY-MM-DD.md, then syncs .coderclaw/ to CoderClawLink if credentials
 * are configured.
 */
export class KnowledgeLoopService {
  private readonly runs = new Map<string, RunAccumulator>();
  private unsub: (() => void) | null = null;

  constructor(private readonly opts: KnowledgeLoopOptions) {}

  /** Start listening for agent events. Safe to call once. */
  start(): void {
    if (this.unsub) {
      return;
    }
    this.unsub = onAgentEvent((evt) => {
      if (!this.unsub) {
        return; // stopped
      }

      if (evt.stream === "tool") {
        this.accumulate(evt.runId, evt.sessionKey ?? "unknown", evt.data);
      }

      if (
        evt.stream === "lifecycle" &&
        typeof evt.data["phase"] === "string" &&
        (evt.data["phase"] === "end" || evt.data["phase"] === "error")
      ) {
        void this.onRunComplete(evt.runId, evt.sessionKey ?? "unknown");
      }
    });
    logDebug("[knowledge-loop] started");
  }

  /** Stop listening and clear accumulated state. */
  stop(): void {
    if (this.unsub) {
      this.unsub();
      this.unsub = null;
    }
    this.runs.clear();
    logDebug("[knowledge-loop] stopped");
  }

  // ---------------------------------------------------------------------------

  private accumulate(runId: string, sessionKey: string, data: Record<string, unknown>): void {
    if (!this.runs.has(runId)) {
      this.runs.set(runId, {
        sessionKey,
        filesCreated: [],
        filesEdited: [],
        toolNames: [],
      });
    }
    const acc = this.runs.get(runId)!;
    const toolName = typeof data["toolName"] === "string" ? data["toolName"] : null;
    if (toolName) {
      acc.toolNames.push(toolName);
    }
    const filePath = typeof data["path"] === "string" ? data["path"] : null;
    if (filePath) {
      if (toolName === "create" || toolName === "write") {
        acc.filesCreated.push(filePath);
      } else if (toolName === "edit") {
        acc.filesEdited.push(filePath);
      }
    }
  }

  private async onRunComplete(runId: string, sessionKey: string): Promise<void> {
    const acc = this.runs.get(runId);
    this.runs.delete(runId);

    const ts = new Date().toISOString();
    const lines: string[] = [`\n## [${ts}] session:${sessionKey}`, ""];

    if (acc) {
      const created = [...new Set(acc.filesCreated)];
      const edited = [...new Set(acc.filesEdited)];
      const tools = [...new Set(acc.toolNames)];
      if (created.length > 0) {
        lines.push(`**Created**: ${created.join(", ")}`);
      }
      if (edited.length > 0) {
        lines.push(`**Edited**: ${edited.join(", ")}`);
      }
      if (tools.length > 0) {
        lines.push(`**Tools**: ${tools.join(", ")}`);
      }
      const summary = deriveActivitySummary({ created, edited, tools });
      if (summary) {
        lines.push(`**Summary**: ${summary}`);
      }
    }
    lines.push("");

    const entry = lines.join("\n");

    try {
      await appendKnowledgeMemory(this.opts.workspaceDir, entry);
    } catch (err) {
      logDebug(`[knowledge-loop] failed to write memory entry: ${String(err)}`);
    }

    await this.syncIfConfigured();
  }

  private async syncIfConfigured(): Promise<void> {
    const { apiKey, baseUrl, clawId, workspaceDir, projectId } = this.opts;
    if (!apiKey || !clawId) {
      return;
    }
    const syncParams: SyncCoderClawDirParams = {
      workspaceDir,
      apiKey,
      baseUrl: baseUrl ?? "https://api.coderclaw.ai",
      clawId,
      projectId,
    };
    try {
      await syncCoderClawDirectory(syncParams);
      logDebug("[knowledge-loop] .coderClaw/ synced to CoderClawLink");
    } catch (err) {
      logDebug(`[knowledge-loop] sync failed: ${String(err)}`);
    }
  }
}
