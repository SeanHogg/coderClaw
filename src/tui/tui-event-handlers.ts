import { asString, extractTextFromMessage, isCommandMessage } from "./tui-formatters.js";
import { TuiStreamAssembler } from "./tui-stream-assembler.js";
import type { AgentEvent, ChatEvent, TuiStateAccess } from "./tui-types.js";

type EventHandlerChatLog = {
  startTool: (toolCallId: string, toolName: string, args: unknown) => void;
  updateToolResult: (
    toolCallId: string,
    result: unknown,
    options?: { partial?: boolean; isError?: boolean },
  ) => void;
  addSystem: (text: string) => void;
  updateAssistant: (text: string, runId: string) => void;
  finalizeAssistant: (text: string, runId: string) => void;
  dropAssistant: (runId: string) => void;
};

type EventHandlerTui = {
  requestRender: () => void;
};

type EventHandlerContext = {
  chatLog: EventHandlerChatLog;
  tui: EventHandlerTui;
  state: TuiStateAccess;
  setActivityStatus: (text: string) => void;
  reportAction?: (text: string) => void;
  refreshSessionInfo?: () => Promise<void>;
  loadHistory?: () => Promise<void>;
  isLocalRunId?: (runId: string) => boolean;
  forgetLocalRunId?: (runId: string) => void;
  clearLocalRunIds?: () => void;
};

type RunActivityStats = {
  toolStarts: number;
  toolFailures: number;
  readFiles: Set<string>;
  editFiles: Set<string>;
  writeFiles: Set<string>;
  applyPatchCalls: number;
  execCalls: number;
};

const TOOL_NAME_ALIASES: Record<string, string> = {
  str_replace_editor: "edit",
  replace_editor: "edit",
};

function normalizeToolName(name: string): string {
  const normalized = name.trim().toLowerCase();
  return TOOL_NAME_ALIASES[normalized] ?? normalized;
}

function extractPathArg(args: unknown): string | null {
  if (!args || typeof args !== "object") {
    return null;
  }
  const record = args as Record<string, unknown>;
  const candidates = [
    record.path,
    record.file_path,
    record.filePath,
    record.filepath,
    record.relative_path,
    record.filename,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
}

function formatCount(value: number, singular: string, plural: string): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

export function createEventHandlers(context: EventHandlerContext) {
  const {
    chatLog,
    tui,
    state,
    setActivityStatus,
    reportAction,
    refreshSessionInfo,
    loadHistory,
    isLocalRunId,
    forgetLocalRunId,
    clearLocalRunIds,
  } = context;
  const finalizedRuns = new Map<string, number>();
  const sessionRuns = new Map<string, number>();
  const runActivity = new Map<string, RunActivityStats>();
  const pendingFinalTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  const FINAL_EVENT_GRACE_MS = 3_000;
  const SESSION_REFRESH_BACKFILL_DELAY_MS = 1_500;
  const SESSION_REFRESH_MIN_INTERVAL_MS = 2_500;
  let pendingSessionRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSessionRefreshRequestedAt = 0;
  let streamAssembler = new TuiStreamAssembler();
  let lastSessionKey = state.currentSessionKey;

  const clearPendingFinalTimeout = (runId: string) => {
    const timer = pendingFinalTimeouts.get(runId);
    if (!timer) {
      return;
    }
    clearTimeout(timer);
    pendingFinalTimeouts.delete(runId);
  };

  const clearAllPendingFinalTimeouts = () => {
    for (const timer of pendingFinalTimeouts.values()) {
      clearTimeout(timer);
    }
    pendingFinalTimeouts.clear();
  };

  const getRunActivity = (runId: string): RunActivityStats => {
    const existing = runActivity.get(runId);
    if (existing) {
      return existing;
    }
    const created: RunActivityStats = {
      toolStarts: 0,
      toolFailures: 0,
      readFiles: new Set<string>(),
      editFiles: new Set<string>(),
      writeFiles: new Set<string>(),
      applyPatchCalls: 0,
      execCalls: 0,
    };
    runActivity.set(runId, created);
    return created;
  };

  const clearRunActivity = (runId: string) => {
    runActivity.delete(runId);
  };

  const reportRunActivitySummary = (runId: string) => {
    if (!reportAction) {
      clearRunActivity(runId);
      return;
    }
    const stats = runActivity.get(runId);
    if (!stats || stats.toolStarts === 0) {
      clearRunActivity(runId);
      return;
    }

    const parts: string[] = [];
    if (stats.readFiles.size > 0) {
      parts.push(formatCount(stats.readFiles.size, "file read", "files read"));
    }
    if (stats.editFiles.size > 0) {
      parts.push(formatCount(stats.editFiles.size, "file edited", "files edited"));
    }
    if (stats.writeFiles.size > 0) {
      parts.push(formatCount(stats.writeFiles.size, "file written", "files written"));
    }
    if (stats.applyPatchCalls > 0) {
      parts.push(formatCount(stats.applyPatchCalls, "patch applied", "patches applied"));
    }
    if (stats.execCalls > 0) {
      parts.push(formatCount(stats.execCalls, "command run", "commands run"));
    }
    if (parts.length === 0) {
      parts.push(formatCount(stats.toolStarts, "tool call", "tool calls"));
    }
    if (stats.toolFailures > 0) {
      parts.push(formatCount(stats.toolFailures, "tool failure", "tool failures"));
    }

    reportAction(`✓ ${parts.join(" · ")}`);
    clearRunActivity(runId);
  };

  const clearPendingSessionRefreshTimer = () => {
    if (!pendingSessionRefreshTimer) {
      return;
    }
    clearTimeout(pendingSessionRefreshTimer);
    pendingSessionRefreshTimer = null;
  };

  const scheduleSessionInfoRefresh = () => {
    if (!refreshSessionInfo) {
      return;
    }
    const now = Date.now();
    if (now - lastSessionRefreshRequestedAt < SESSION_REFRESH_MIN_INTERVAL_MS) {
      return;
    }
    lastSessionRefreshRequestedAt = now;
    void refreshSessionInfo();
    clearPendingSessionRefreshTimer();
    const shouldBackfill =
      typeof state.sessionInfo.totalTokens !== "number" || state.sessionInfo.totalTokens <= 0;
    if (!shouldBackfill) {
      return;
    }
    pendingSessionRefreshTimer = setTimeout(() => {
      pendingSessionRefreshTimer = null;
      if (typeof state.sessionInfo.totalTokens === "number" && state.sessionInfo.totalTokens > 0) {
        return;
      }
      lastSessionRefreshRequestedAt = Date.now();
      void refreshSessionInfo();
    }, SESSION_REFRESH_BACKFILL_DELAY_MS);
    pendingSessionRefreshTimer.unref?.();
  };

  const scheduleFinalEventTimeout = (runId: string) => {
    clearPendingFinalTimeout(runId);
    const timer = setTimeout(() => {
      pendingFinalTimeouts.delete(runId);
      if (finalizedRuns.has(runId)) {
        return;
      }
      if (state.activeChatRunId !== runId) {
        return;
      }
      sessionRuns.delete(runId);
      reportRunActivitySummary(runId);
      clearActiveRunIfMatch(runId);
      maybeRefreshHistoryForRun(runId);
      setActivityStatus("idle");
      reportAction?.("run settled to idle (final event not received)");
      tui.requestRender();
    }, FINAL_EVENT_GRACE_MS);
    timer.unref?.();
    pendingFinalTimeouts.set(runId, timer);
  };

  const pruneRunMap = (runs: Map<string, number>) => {
    if (runs.size <= 200) {
      return;
    }
    const keepUntil = Date.now() - 10 * 60 * 1000;
    for (const [key, ts] of runs) {
      if (runs.size <= 150) {
        break;
      }
      if (ts < keepUntil) {
        runs.delete(key);
      }
    }
    if (runs.size > 200) {
      for (const key of runs.keys()) {
        runs.delete(key);
        if (runs.size <= 150) {
          break;
        }
      }
    }
  };

  const syncSessionKey = () => {
    if (state.currentSessionKey === lastSessionKey) {
      return;
    }
    lastSessionKey = state.currentSessionKey;
    finalizedRuns.clear();
    sessionRuns.clear();
    clearAllPendingFinalTimeouts();
    clearPendingSessionRefreshTimer();
    runActivity.clear();
    streamAssembler = new TuiStreamAssembler();
    clearLocalRunIds?.();
  };

  const noteSessionRun = (runId: string) => {
    sessionRuns.set(runId, Date.now());
    pruneRunMap(sessionRuns);
  };

  const noteFinalizedRun = (runId: string) => {
    clearPendingFinalTimeout(runId);
    finalizedRuns.set(runId, Date.now());
    sessionRuns.delete(runId);
    streamAssembler.drop(runId);
    clearRunActivity(runId);
    pruneRunMap(finalizedRuns);
  };

  const clearActiveRunIfMatch = (runId: string) => {
    if (state.activeChatRunId === runId) {
      state.activeChatRunId = null;
    }
  };

  const hasConcurrentActiveRun = (runId: string) => {
    const activeRunId = state.activeChatRunId;
    if (!activeRunId || activeRunId === runId) {
      return false;
    }
    return sessionRuns.has(activeRunId);
  };

  const maybeRefreshHistoryForRun = (runId: string) => {
    if (isLocalRunId?.(runId)) {
      forgetLocalRunId?.(runId);
      return;
    }
    if (hasConcurrentActiveRun(runId)) {
      return;
    }
    void loadHistory?.();
  };

  const handleChatEvent = (payload: unknown) => {
    if (!payload || typeof payload !== "object") {
      return;
    }
    const evt = payload as ChatEvent;
    syncSessionKey();
    if (evt.sessionKey !== state.currentSessionKey) {
      return;
    }
    if (finalizedRuns.has(evt.runId)) {
      if (evt.state === "delta") {
        return;
      }
      if (evt.state === "final") {
        return;
      }
    }
    const wasKnownRun = sessionRuns.has(evt.runId);
    noteSessionRun(evt.runId);
    if (!state.activeChatRunId) {
      state.activeChatRunId = evt.runId;
    }
    if (!wasKnownRun && evt.state === "delta") {
      reportAction?.("run started");
    }
    if (evt.state === "delta") {
      clearPendingFinalTimeout(evt.runId);
      const displayText = streamAssembler.ingestDelta(evt.runId, evt.message, state.showThinking);
      if (!displayText) {
        return;
      }
      chatLog.updateAssistant(displayText, evt.runId);
      setActivityStatus("streaming");
    }
    if (evt.state === "final") {
      const wasActiveRun = state.activeChatRunId === evt.runId;
      if (!evt.message) {
        maybeRefreshHistoryForRun(evt.runId);
        chatLog.dropAssistant(evt.runId);
        reportRunActivitySummary(evt.runId);
        noteFinalizedRun(evt.runId);
        clearActiveRunIfMatch(evt.runId);
        if (wasActiveRun) {
          setActivityStatus("idle");
        }
        scheduleSessionInfoRefresh();
        tui.requestRender();
        return;
      }
      if (isCommandMessage(evt.message)) {
        maybeRefreshHistoryForRun(evt.runId);
        const text = extractTextFromMessage(evt.message);
        if (text) {
          chatLog.addSystem(text);
        }
        streamAssembler.drop(evt.runId);
        reportRunActivitySummary(evt.runId);
        noteFinalizedRun(evt.runId);
        clearActiveRunIfMatch(evt.runId);
        if (wasActiveRun) {
          setActivityStatus("idle");
        }
        scheduleSessionInfoRefresh();
        tui.requestRender();
        return;
      }
      maybeRefreshHistoryForRun(evt.runId);
      const stopReason =
        evt.message && typeof evt.message === "object" && !Array.isArray(evt.message)
          ? typeof (evt.message as Record<string, unknown>).stopReason === "string"
            ? ((evt.message as Record<string, unknown>).stopReason as string)
            : ""
          : "";

      const finalText = streamAssembler.finalize(evt.runId, evt.message, state.showThinking);
      const suppressEmptyExternalPlaceholder =
        finalText === "(no output)" && !isLocalRunId?.(evt.runId);
      if (suppressEmptyExternalPlaceholder) {
        chatLog.dropAssistant(evt.runId);
      } else {
        chatLog.finalizeAssistant(finalText, evt.runId);
      }
      reportRunActivitySummary(evt.runId);
      noteFinalizedRun(evt.runId);
      clearActiveRunIfMatch(evt.runId);
      if (wasActiveRun) {
        setActivityStatus(stopReason === "error" ? "error" : "idle");
      }
      reportAction?.(stopReason === "error" ? "run ended with error" : "run completed");
      // Refresh session info to update token counts in footer
      scheduleSessionInfoRefresh();
    }
    if (evt.state === "aborted") {
      clearPendingFinalTimeout(evt.runId);
      const wasActiveRun = state.activeChatRunId === evt.runId;
      chatLog.addSystem("run aborted");
      streamAssembler.drop(evt.runId);
      reportRunActivitySummary(evt.runId);
      sessionRuns.delete(evt.runId);
      clearActiveRunIfMatch(evt.runId);
      if (wasActiveRun) {
        setActivityStatus("aborted");
      }
      reportAction?.("run aborted");
      scheduleSessionInfoRefresh();
      maybeRefreshHistoryForRun(evt.runId);
    }
    if (evt.state === "error") {
      clearPendingFinalTimeout(evt.runId);
      const wasActiveRun = state.activeChatRunId === evt.runId;
      chatLog.addSystem(`run error: ${evt.errorMessage ?? "unknown"}`);
      streamAssembler.drop(evt.runId);
      reportRunActivitySummary(evt.runId);
      sessionRuns.delete(evt.runId);
      clearActiveRunIfMatch(evt.runId);
      if (wasActiveRun) {
        setActivityStatus("error");
      }
      reportAction?.("run error");
      scheduleSessionInfoRefresh();
      maybeRefreshHistoryForRun(evt.runId);
    }
    tui.requestRender();
  };

  const handleAgentEvent = (payload: unknown) => {
    if (!payload || typeof payload !== "object") {
      return;
    }
    const evt = payload as AgentEvent;
    syncSessionKey();
    // Agent events (tool streaming, lifecycle) are emitted per-run. Filter against the
    // active chat run id, not the session id. Tool results can arrive after the chat
    // final event, so accept finalized runs for tool updates.
    const isActiveRun = evt.runId === state.activeChatRunId;
    const isKnownRun = isActiveRun || sessionRuns.has(evt.runId) || finalizedRuns.has(evt.runId);
    if (!isKnownRun) {
      return;
    }
    if (evt.stream === "tool") {
      const verbose = state.sessionInfo.verboseLevel ?? "off";
      const allowToolEvents = verbose !== "off";
      const allowToolOutput = verbose === "full";
      const data = evt.data ?? {};
      const phase = asString(data.phase, "");
      const toolCallId = asString(data.toolCallId, "");
      const toolName = asString(data.name, "tool");
      const normalizedToolName = normalizeToolName(toolName);
      if (!toolCallId) {
        return;
      }
      // Always report tool activity in the trace, regardless of verbose level
      if (phase === "start") {
        reportAction?.(`tool: ${toolName}`);
        const stats = getRunActivity(evt.runId);
        stats.toolStarts += 1;
        const toolPath = extractPathArg(data.args);
        if (normalizedToolName === "read" && toolPath) {
          stats.readFiles.add(toolPath);
        } else if (normalizedToolName === "edit" && toolPath) {
          stats.editFiles.add(toolPath);
        } else if (normalizedToolName === "write" && toolPath) {
          stats.writeFiles.add(toolPath);
        } else if (normalizedToolName === "apply_patch") {
          stats.applyPatchCalls += 1;
        } else if (normalizedToolName === "exec") {
          stats.execCalls += 1;
        }
      } else if (phase === "result" && Boolean(data.isError)) {
        reportAction?.(`tool failed: ${toolName}`);
        const stats = getRunActivity(evt.runId);
        stats.toolFailures += 1;
      }
      if (!allowToolEvents) {
        tui.requestRender();
        return;
      }
      if (phase === "start") {
        chatLog.startTool(toolCallId, toolName, data.args);
      } else if (phase === "update") {
        if (!allowToolOutput) {
          tui.requestRender();
          return;
        }
        chatLog.updateToolResult(toolCallId, data.partialResult, {
          partial: true,
        });
      } else if (phase === "result") {
        if (allowToolOutput) {
          chatLog.updateToolResult(toolCallId, data.result, {
            isError: Boolean(data.isError),
          });
        } else {
          chatLog.updateToolResult(toolCallId, { content: [] }, { isError: Boolean(data.isError) });
        }
      }
      tui.requestRender();
      return;
    }
    if (evt.stream === "lifecycle") {
      if (!isActiveRun) {
        return;
      }
      const phase = typeof evt.data?.phase === "string" ? evt.data.phase : "";
      if (phase === "start") {
        setActivityStatus("running");
        reportAction?.("agent execution started");
      }
      if (phase === "end") {
        setActivityStatus("waiting");
        reportAction?.("agent execution finished; awaiting final response");
        scheduleFinalEventTimeout(evt.runId);
      }
      if (phase === "error") {
        const errorMessage =
          asString(evt.data?.error, "") ||
          asString(evt.data?.errorMessage, "") ||
          asString(evt.data?.message, "") ||
          asString(evt.data?.detail, "") ||
          "unknown";
        chatLog.addSystem(`run error: ${errorMessage}`);
        reportRunActivitySummary(evt.runId);
        noteFinalizedRun(evt.runId);
        clearActiveRunIfMatch(evt.runId);
        maybeRefreshHistoryForRun(evt.runId);
        scheduleSessionInfoRefresh();
        setActivityStatus("error");
        reportAction?.("agent execution error");
      }
      tui.requestRender();
    }
  };

  return { handleChatEvent, handleAgentEvent };
}
