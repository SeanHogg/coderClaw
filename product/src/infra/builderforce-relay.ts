/**
 * BuilderforceRelayService
 *
 * Persistent upstream WebSocket connection from coderClaw → Builderforce relay.
 * Bridges bidirectional chat:
 *   - Browser → ClawRelayDO → upstream WS → this service → local gateway → agent
 *   - Agent → local gateway events → this service → upstream WS → ClawRelayDO → browsers
 *
 * Also sends periodic HTTP heartbeats to keep lastSeenAt fresh in the DB.
 */

import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { WebSocket } from "ws";
import { loadProjectContext, updateProjectContextFields } from "../coderclaw/project-context.js";
import { GatewayClient, type GatewayClientOptions } from "../gateway/client.js";
import type { EventFrame } from "../gateway/protocol/index.js";
import { logDebug, logWarn } from "../logger.js";
import { onAgentEvent } from "./agent-events.js";
import { resolveApproval } from "./approval-gate.js";
import {
  buildLocalMachineProfile,
  mergeBuilderforceContext,
  type AssignmentContextResponse,
} from "./builderforce-context.js";
import { resolveRemoteResult } from "./remote-result-broker.js";
import { dispatchResultToRemoteClaw, type RemoteDispatchOptions } from "./remote-subagent.js";
import { setRelayHook } from "./workflow-telemetry.js";

function extractChatText(message: unknown): string {
  if (!message || typeof message !== "object") {
    return "";
  }
  const msg = message as { content?: unknown; text?: unknown };
  if (typeof msg.text === "string") {
    return msg.text;
  }
  if (!Array.isArray(msg.content)) {
    return "";
  }
  const parts: string[] = [];
  for (const block of msg.content) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const text = (block as { text?: unknown }).text;
    if (typeof text === "string" && text.trim().length > 0) {
      parts.push(text);
    }
  }
  return parts.join("\n").trim();
}

function extractChatRole(message: unknown): "user" | "assistant" {
  if (!message || typeof message !== "object") {
    return "assistant";
  }
  const role = (message as { role?: unknown }).role;
  if (role === "user") {
    return "user";
  }
  return "assistant";
}

export type BuilderforceRelayOptions = {
  /** Base HTTP(S) URL of Builderforce, e.g. "https://api.builderforce.ai" */
  baseUrl: string;
  /** Numeric claw instance id (as string), from context.builderforce.instanceId */
  clawId: string;
  /** Plaintext API key from BUILDERFORCE_API_KEY */
  apiKey: string;
  /** Local coderClaw gateway WebSocket URL. Defaults to ws://127.0.0.1:18789 */
  gatewayUrl?: string;
  /** Workspace path for updating .coderClaw/context.yaml with assignment metadata. */
  workspaceDir?: string;
};

export class BuilderforceRelayService {
  private ws: WebSocket | null = null;
  private closed = false;
  private backoffMs = 1000;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private logsTimer: ReturnType<typeof setInterval> | null = null;
  private logsCursor: number | undefined;
  private presenceTimer: ReturnType<typeof setInterval> | null = null;
  private gatewayClient: GatewayClient | null = null;
  /** executionId from the last task.assign / task.broadcast dispatch, if any. */
  private pendingExecutionId: number | null = null;
  /** Tracks pending remote task correlations so results can be sent back. */
  private pendingRemoteCorrelations = new Map<
    string,
    { correlationId: string; callbackClawId: string; callbackBaseUrl: string }
  >();
  /** Remote dispatch options, set after construction so result callbacks work. */
  private remoteDispatchOpts: RemoteDispatchOptions | null = null;

  private readonly upstreamWsUrl: string;
  private readonly heartbeatHttpUrl: string;
  private readonly assignmentContextUrl: string;
  private readonly gatewayWsUrl: string;

  private dispatchTaskFromRelay(payload: {
    title: string;
    description?: string;
    executionId?: number;
    taskId?: number;
    sourceType: "task.assign" | "task.broadcast";
    artifacts?: { skills?: string[]; personas?: string[]; content?: string[] };
  }): void {
    const lines = [
      `[Builderforce ${payload.sourceType}] ${payload.title}`,
      payload.description ? "" : undefined,
      payload.description,
      payload.executionId != null ? "" : undefined,
      payload.executionId != null ? `Execution ID: ${payload.executionId}` : undefined,
      payload.taskId != null ? `Task ID: ${payload.taskId}` : undefined,
    ].filter((line): line is string => typeof line === "string");

    const message = lines.join("\n").trim();
    if (!message) {
      return;
    }

    // Push assigned artifacts to the gateway for the claw to use
    if (payload.artifacts) {
      this.gatewayClient
        ?.request("artifacts.sync", {
          artifacts: payload.artifacts,
          executionId: payload.executionId,
          taskId: payload.taskId,
        })
        .catch((err: unknown) => {
          logWarn(`[builderforce] artifacts.sync failed: ${String(err)}`);
        });
    }

    // Track executionId so we can report running/completed/failed back to Builderforce.
    if (payload.executionId != null) {
      this.pendingExecutionId = payload.executionId;
      void this.reportExecutionState(payload.executionId, "running");
    }

    this.gatewayClient
      ?.request("chat.send", {
        sessionKey: "main",
        message,
        idempotencyKey: `task-${payload.sourceType}-${payload.taskId ?? "na"}-${payload.executionId ?? Date.now()}`,
      })
      .catch((err: unknown) => {
        logWarn(`[builderforce] ${payload.sourceType} dispatch failed: ${String(err)}`);
      });
  }

  /**
   * Report execution lifecycle state back to Builderforce.
   * Fire-and-forget — errors are logged but never surfaced to the caller.
   */
  private async reportExecutionState(
    executionId: number,
    status: "running" | "completed" | "failed" | "cancelled",
    extra?: { result?: string; errorMessage?: string },
  ): Promise<void> {
    const base = this.opts.baseUrl.replace(/\/$/, "");
    const url = `${base}/api/claws/${this.opts.clawId}/executions/${executionId}/state`;
    try {
      await fetch(url, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.opts.apiKey}`,
        },
        body: JSON.stringify({ status, ...extra }),
        signal: AbortSignal.timeout(10_000),
      });
      logDebug(`[builderforce-relay] execution ${executionId} → ${status}`);
    } catch (err) {
      logDebug(`[builderforce-relay] execution state report failed: ${String(err)}`);
    }
  }

  constructor(private readonly opts: BuilderforceRelayOptions) {
    const base = opts.baseUrl
      .replace(/^https:/, "wss:")
      .replace(/^http:/, "ws:")
      .replace(/\/$/, "");
    // API key is passed via Authorization header, not as a query param.
    // Query params appear in server access logs and CDN caches — headers are safer.
    this.upstreamWsUrl = `${base}/api/claws/${opts.clawId}/upstream`;
    this.heartbeatHttpUrl = `${opts.baseUrl.replace(/\/$/, "")}/api/claws/${opts.clawId}/heartbeat`;
    this.assignmentContextUrl = `${opts.baseUrl.replace(/\/$/, "")}/api/claws/${opts.clawId}/assignment-context`;
    this.gatewayWsUrl = opts.gatewayUrl ?? "ws://127.0.0.1:18789";
  }

  /** Set remote dispatch options so result callbacks can be sent back to the originating claw. */
  setRemoteDispatchOptions(opts: RemoteDispatchOptions): void {
    this.remoteDispatchOpts = opts;
  }

  // ---------------------------------------------------------------------------
  // Remote context fetching (P4-2)
  // ---------------------------------------------------------------------------

  /**
   * Fetch the last-synced .coderClaw/ files from a remote claw via Builderforce and
   * write them to `.coderClaw/remote-context/<remoteClawId>/` in the local workspace.
   * Only writes files whose SHA-256 content hash has changed since the last fetch.
   */
  async fetchRemoteContext(remoteClawId: string): Promise<void> {
    if (!this.opts.workspaceDir) {
      return;
    }
    const base = this.opts.baseUrl.replace(/\/+$/, "");
    const url = `${base}/api/claws/${encodeURIComponent(remoteClawId)}/context-bundle`;
    let bundle: { files: Array<{ path: string; content: string; sha256: string }> };
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${this.opts.apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        logDebug(`[builderforce-relay] context-bundle for claw ${remoteClawId} failed: ${res.status}`);
        return;
      }
      bundle = (await res.json()) as typeof bundle;
    } catch (err) {
      logDebug(`[builderforce-relay] fetchRemoteContext error: ${String(err)}`);
      return;
    }

    if (!Array.isArray(bundle.files) || bundle.files.length === 0) {
      return;
    }

    const targetDir = path.join(
      this.opts.workspaceDir,
      ".coderClaw",
      "remote-context",
      remoteClawId,
    );

    for (const file of bundle.files) {
      if (typeof file.path !== "string" || typeof file.content !== "string") {
        continue;
      }
      // Sanitize path: strip leading slashes and resolve relative dots
      const safeName = file.path
        .replace(/\\/g, "/")
        .replace(/^[./]+/, "")
        .replace(/\.\.\//g, "");
      if (!safeName) {
        continue;
      }
      const destPath = path.join(targetDir, safeName);

      // Check existing SHA-256 before writing
      let existingSha: string | null = null;
      try {
        const existing = await fs.readFile(destPath, "utf-8");
        const digest = createHash("sha256").update(existing, "utf-8").digest("hex");
        existingSha = digest;
      } catch {
        // File doesn't exist yet
      }

      if (existingSha === file.sha256) {
        continue; // unchanged
      }

      await fs.mkdir(path.dirname(destPath), { recursive: true });
      await fs.writeFile(destPath, file.content, "utf-8");
      logDebug(`[builderforce-relay] wrote remote context file: ${safeName}`);
    }
  }

  /** Start the relay service. Both WS connections retry on their own. */
  start(): void {
    if (this.closed) {
      return;
    }
    // Register the relay hook so workflow telemetry spans are forwarded as live
    // WebSocket events to browser clients (workflow.update, task.started, task.completed).
    setRelayHook((event, payload) => {
      this.sendToRelay({ type: "event", event, payload });
    });
    this.connectUpstream();
    this.connectLocalGateway();
    this.startRemoteResultTracking();
  }

  /** Gracefully shut down both connections. */
  stop(): void {
    this.closed = true;
    setRelayHook(null); // deregister so no dangling sends after stop
    this.clearHeartbeat();
    this.clearLogsPolling();
    this.clearPresencePolling();
    this.ws?.close(1000, "stopped");
    this.ws = null;
    this.gatewayClient?.stop();
    this.gatewayClient = null;
  }

  // ---------------------------------------------------------------------------
  // Remote result tracking — send task results back to the originating claw
  // ---------------------------------------------------------------------------

  private startRemoteResultTracking(): void {
    onAgentEvent((evt) => {
      if (this.closed) {
        return;
      }
      if (evt.stream !== "lifecycle") {
        return;
      }
      const phase = evt.data["phase"];
      if (phase !== "end" && phase !== "error") {
        return;
      }
      const sessionKey = evt.sessionKey ?? "";
      const correlation = this.pendingRemoteCorrelations.get(sessionKey);
      if (!correlation) {
        return;
      }
      this.pendingRemoteCorrelations.delete(sessionKey);
      // Capture the last assistant message or a summary from the lifecycle event
      const errorVal = evt.data["error"];
      const errorStr = typeof errorVal === "string" ? errorVal : "unknown error";
      const summary =
        typeof evt.data["summary"] === "string"
          ? evt.data["summary"]
          : phase === "error"
            ? `Remote task failed: ${errorStr}`
            : `Remote task completed on claw ${this.opts.clawId}`;
      // Send the result back to the originating claw
      if (this.remoteDispatchOpts) {
        void dispatchResultToRemoteClaw(
          this.remoteDispatchOpts,
          correlation.callbackClawId,
          correlation.correlationId,
          summary,
        );
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Upstream WebSocket (coderClaw → ClawRelayDO)
  // ---------------------------------------------------------------------------

  private connectUpstream(): void {
    if (this.closed) {
      return;
    }

    const ws = new WebSocket(this.upstreamWsUrl, {
      headers: { Authorization: `Bearer ${this.opts.apiKey}` },
    });
    this.ws = ws;

    ws.on("open", () => {
      logWarn("[builderforce-relay] upstream connected");
      this.backoffMs = 1000;
      this.scheduleHeartbeat();
      void this.syncAssignmentContext("ws-open");
    });

    ws.on("message", (raw) => {
      try {
        const rawText =
          typeof raw === "string"
            ? raw
            : raw instanceof Buffer
              ? raw.toString("utf-8")
              : Array.isArray(raw)
                ? Buffer.concat(raw).toString("utf-8")
                : raw instanceof ArrayBuffer
                  ? Buffer.from(new Uint8Array(raw)).toString("utf-8")
                  : "";
        const msg = JSON.parse(rawText) as Record<string, unknown>;
        this.handleRelayMessage(msg);
      } catch {
        /* ignore malformed frames */
      }
    });

    ws.on("close", () => {
      if (this.ws === ws) {
        this.ws = null;
        this.clearHeartbeat();
        logWarn("[builderforce-relay] upstream disconnected — reconnecting…");
        this.scheduleReconnect();
      }
    });

    ws.on("error", (err) => {
      logWarn(`[builderforce-relay] upstream error: ${String(err)}`);
      // "close" follows automatically
    });
  }

  /**
   * Handle messages forwarded from browser clients through ClawRelayDO.
   * Translates Builderforce wire protocol → local gateway method calls.
   */
  private handleRelayMessage(msg: Record<string, unknown>): void {
    const type = typeof msg.type === "string" ? msg.type : "";

    switch (type) {
      case "relay_connected":
        logDebug("[builderforce-relay] relay acknowledged connection");
        break;

      case "ping":
        // Relay sends 30s pings to keep the upstream connection alive; no reply needed.
        break;

      case "chat": {
        const message = typeof msg.message === "string" ? msg.message : "";
        const session = typeof msg.session === "string" ? msg.session : "main";
        this.gatewayClient
          ?.request("chat.send", {
            sessionKey: session,
            message,
            idempotencyKey: randomUUID(),
          })
          .catch((err: unknown) => {
            logDebug(`[builderforce-relay] chat.send failed: ${String(err)}`);
          });
        break;
      }

      case "chat.abort":
        this.gatewayClient?.request("chat.abort", {}).catch(() => {});
        break;

      case "session.new":
        this.gatewayClient?.request("chat.new", {}).catch(() => {});
        break;

      case "logs.subscribe":
        this.startLogsPolling(true);
        break;

      case "presence.subscribe":
        this.startPresencePolling();
        break;

      case "rpc.call": {
        const requestId =
          typeof msg.requestId === "string" && msg.requestId.trim().length > 0
            ? msg.requestId
            : randomUUID();
        const method = typeof msg.method === "string" ? msg.method.trim() : "";
        const params =
          msg.params && typeof msg.params === "object" && !Array.isArray(msg.params)
            ? (msg.params as Record<string, unknown>)
            : {};

        if (!method) {
          this.sendToRelay({
            type: "rpc.error",
            requestId,
            method,
            error: "method required",
          });
          break;
        }

        this.gatewayClient
          ?.request(method, params)
          .then((result) => {
            this.sendToRelay({
              type: "rpc.result",
              requestId,
              method,
              result,
            });
          })
          .catch((err: unknown) => {
            this.sendToRelay({
              type: "rpc.error",
              requestId,
              method,
              error: String(err),
            });
          });
        break;
      }

      case "remote.task": {
        // Peer claw delegated a task to this claw — execute it as a chat message.
        const task = typeof msg.task === "string" ? msg.task : "";
        const fromClawId = typeof msg.fromClawId === "string" ? msg.fromClawId : "unknown";
        const correlationId = typeof msg.correlationId === "string" ? msg.correlationId : "";
        const callbackClawId = typeof msg.callbackClawId === "string" ? msg.callbackClawId : "";
        const callbackBaseUrl = typeof msg.callbackBaseUrl === "string" ? msg.callbackBaseUrl : "";
        if (!task) {
          break;
        }
        logDebug(`[builderforce-relay] remote task from claw ${fromClawId}: ${task.slice(0, 80)}…`);
        // Track correlation so we can send result back when the session completes.
        const sessionKey = correlationId ? `remote-${correlationId}` : "main";
        if (correlationId && callbackClawId) {
          this.pendingRemoteCorrelations.set(sessionKey, {
            correlationId,
            callbackClawId,
            callbackBaseUrl,
          });
        }
        this.gatewayClient
          ?.request("chat.send", {
            sessionKey,
            message: `[Remote task from claw ${fromClawId}]\n\n${task}`,
            idempotencyKey: `remote-${fromClawId}-${correlationId || Date.now()}`,
          })
          .catch((err: unknown) => {
            logDebug(`[builderforce-relay] remote.task dispatch failed: ${String(err)}`);
          });
        break;
      }

      case "remote.task.result": {
        // A remote claw sent the result of a task we previously dispatched.
        const correlationId = typeof msg.correlationId === "string" ? msg.correlationId : "";
        const result = typeof msg.result === "string" ? msg.result : "";
        if (correlationId) {
          const resolved = resolveRemoteResult(correlationId, result);
          logDebug(
            `[builderforce-relay] remote.task.result ${correlationId}: ${resolved ? "resolved" : "no pending callback"}`,
          );
        }
        break;
      }

      case "task.assign":
      case "task.broadcast": {
        const taskRecord =
          msg.task && typeof msg.task === "object" ? (msg.task as Record<string, unknown>) : null;
        const title = typeof taskRecord?.title === "string" ? taskRecord.title.trim() : "";
        const description =
          typeof taskRecord?.description === "string" ? taskRecord.description.trim() : "";
        const executionId =
          typeof msg.executionId === "number" && Number.isFinite(msg.executionId)
            ? msg.executionId
            : undefined;
        const taskId =
          typeof msg.taskId === "number" && Number.isFinite(msg.taskId) ? msg.taskId : undefined;

        // Extract artifact assignments from the dispatch payload
        const rawArtifacts =
          msg.artifacts && typeof msg.artifacts === "object"
            ? (msg.artifacts as Record<string, unknown>)
            : undefined;
        const artifacts = rawArtifacts
          ? {
              skills: Array.isArray(rawArtifacts.skills)
                ? (rawArtifacts.skills as string[])
                : undefined,
              personas: Array.isArray(rawArtifacts.personas)
                ? (rawArtifacts.personas as string[])
                : undefined,
              content: Array.isArray(rawArtifacts.content)
                ? (rawArtifacts.content as string[])
                : undefined,
            }
          : undefined;

        if (!title && !description) {
          logWarn(`[builderforce] received ${type} without task content`);
          break;
        }

        logWarn(
          `[builderforce] received ${type}${taskId != null ? ` task=${taskId}` : ""}${executionId != null ? ` execution=${executionId}` : ""}`,
        );

        this.dispatchTaskFromRelay({
          sourceType: type,
          title: title || "Assigned task",
          description: description || undefined,
          executionId,
          taskId,
          artifacts,
        });
        void this.syncAssignmentContext(type);
        break;
      }

      case "approval.decision": {
        // Manager approved or rejected a pending approval request in the portal.
        const approvalId = typeof msg.approvalId === "string" ? msg.approvalId : "";
        const decision = typeof msg.status === "string" ? msg.status : "";
        if (approvalId && (decision === "approved" || decision === "rejected")) {
          logWarn(`[builderforce-relay] approval.decision ${approvalId}: ${decision}`);
          resolveApproval(approvalId, decision);
        }
        break;
      }

      default:
        break;
    }
  }

  /** Send a raw message to all browser clients via the relay. */
  private sendToRelay(msg: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private mapLogLine(line: string): { ts: string; level: string; message: string } {
    const fallback = { ts: new Date().toISOString(), level: "info", message: line };
    try {
      const parsed = JSON.parse(line) as {
        time?: string;
        _meta?: { logLevelName?: string };
        1?: unknown;
        message?: unknown;
        0?: unknown;
      };
      const level =
        typeof parsed?._meta?.logLevelName === "string"
          ? parsed._meta.logLevelName.toLowerCase()
          : "info";
      const message =
        typeof parsed?.[1] === "string"
          ? parsed[1]
          : typeof parsed?.message === "string"
            ? parsed.message
            : typeof parsed?.[0] === "string"
              ? parsed[0]
              : line;
      return {
        ts: typeof parsed?.time === "string" ? parsed.time : fallback.ts,
        level,
        message,
      };
    } catch {
      return fallback;
    }
  }

  private async pollLogsOnce(): Promise<void> {
    if (!this.gatewayClient) {
      return;
    }
    try {
      const res = await this.gatewayClient.request("logs.tail", {
        cursor: this.logsCursor,
        limit: 500,
        maxBytes: 250_000,
      });

      if (typeof res.cursor === "number" && Number.isFinite(res.cursor)) {
        this.logsCursor = res.cursor;
      }
      const lines = Array.isArray(res.lines)
        ? res.lines.filter((line): line is string => typeof line === "string")
        : [];
      for (const line of lines) {
        const mapped = this.mapLogLine(line);
        this.sendToRelay({
          type: "log",
          level: mapped.level,
          message: mapped.message,
          ts: mapped.ts,
        });
      }
    } catch (err) {
      logDebug(`[builderforce-relay] logs.tail failed: ${String(err)}`);
    }
  }

  private startLogsPolling(resetCursor: boolean): void {
    if (resetCursor) {
      this.logsCursor = undefined;
    }
    if (this.logsTimer !== null) {
      return;
    }
    void this.pollLogsOnce();
    this.logsTimer = setInterval(() => {
      void this.pollLogsOnce();
    }, 2_000);
  }

  private clearLogsPolling(): void {
    if (this.logsTimer !== null) {
      clearInterval(this.logsTimer);
      this.logsTimer = null;
    }
  }

  private async pollPresenceOnce(): Promise<void> {
    if (!this.gatewayClient) {
      return;
    }
    try {
      const res = await this.gatewayClient.request("system-presence", {});
      const entries = Array.isArray(res) ? res : [];
      this.sendToRelay({ type: "presence.snapshot", entries });
    } catch (err) {
      logDebug(`[builderforce-relay] system-presence failed: ${String(err)}`);
    }
  }

  private startPresencePolling(): void {
    if (this.presenceTimer !== null) {
      return;
    }
    void this.pollPresenceOnce();
    this.presenceTimer = setInterval(() => {
      void this.pollPresenceOnce();
    }, 5_000);
  }

  private clearPresencePolling(): void {
    if (this.presenceTimer !== null) {
      clearInterval(this.presenceTimer);
      this.presenceTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.closed) {
      return;
    }
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, 30_000);
    setTimeout(() => this.connectUpstream(), delay).unref();
  }

  // ---------------------------------------------------------------------------
  // Local Gateway Client (local agent events → relay → browsers)
  // ---------------------------------------------------------------------------

  private connectLocalGateway(): void {
    const opts: GatewayClientOptions = {
      url: this.gatewayWsUrl,
      onEvent: (evt) => this.handleGatewayEvent(evt),
      onConnectError: (err) => {
        logDebug(`[builderforce-relay] local gateway connect error: ${String(err)}`);
      },
    };
    const gw = new GatewayClient(opts);
    this.gatewayClient = gw;
    // GatewayClient has its own backoff reconnect — start it independently of upstream.
    gw.start();
  }

  /**
   * Translate local gateway "chat" EventFrames → Builderforce browser protocol,
   * then broadcast to all connected browser clients via the upstream WS.
   */
  private handleGatewayEvent(evt: EventFrame): void {
    if (evt.event !== "chat") {
      return;
    }

    const p = evt.payload as
      | {
          type?: string;
          sessionKey?: string;
          text?: string;
          role?: string;
          delta?: string;
          toolCallId?: string;
          toolName?: string;
          toolInput?: string;
          toolResult?: string;
        }
      | null
      | undefined;

    const legacy = evt.payload as
      | {
          sessionKey?: string;
          state?: string;
          message?: unknown;
          errorMessage?: string;
        }
      | null
      | undefined;

    if (!p) {
      return;
    }

    if (legacy && typeof legacy.state === "string") {
      const session = legacy.sessionKey ?? "main";
      if (legacy.state === "final") {
        const text = extractChatText(legacy.message);
        const role = extractChatRole(legacy.message);
        if (text) {
          this.sendToRelay({
            type: "chat.message",
            role,
            text,
            session,
          });
        }
        // Report execution completed to Builderforce if one is pending.
        if (this.pendingExecutionId != null) {
          const eid = this.pendingExecutionId;
          this.pendingExecutionId = null;
          void this.reportExecutionState(eid, "completed", { result: text || undefined });
        }
        return;
      }
      if (legacy.state === "error") {
        const text = legacy.errorMessage?.trim();
        if (text) {
          this.sendToRelay({
            type: "chat.message",
            role: "assistant",
            text: `[error] ${text}`,
            session,
          });
        }
        // Report execution failed to Builderforce if one is pending.
        if (this.pendingExecutionId != null) {
          const eid = this.pendingExecutionId;
          this.pendingExecutionId = null;
          void this.reportExecutionState(eid, "failed", { errorMessage: text || undefined });
        }
        return;
      }
    }

    switch (p.type) {
      case "delta":
        this.sendToRelay({
          type: "chat.delta",
          delta: p.delta ?? "",
          session: p.sessionKey ?? "main",
        });
        break;
      case "message":
        this.sendToRelay({
          type: "chat.message",
          role: p.role ?? "assistant",
          text: p.text ?? "",
          session: p.sessionKey ?? "main",
        });
        break;
      case "tool_use":
        this.sendToRelay({
          type: "tool.start",
          toolCallId: p.toolCallId,
          toolName: p.toolName,
          toolInput: p.toolInput,
          session: p.sessionKey ?? "main",
        });
        break;
      case "tool_result":
        this.sendToRelay({
          type: "tool.result",
          toolCallId: p.toolCallId,
          toolResult: p.toolResult,
          session: p.sessionKey ?? "main",
        });
        break;
      case "abort":
        this.sendToRelay({ type: "chat.abort", session: p.sessionKey ?? "main" });
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Heartbeat — HTTP PATCH to keep lastSeenAt fresh between WS reconnects
  // ---------------------------------------------------------------------------

  private scheduleHeartbeat(): void {
    this.clearHeartbeat();
    void this.sendHeartbeat(); // immediate on connect
    this.heartbeatTimer = setInterval(() => void this.sendHeartbeat(), 5 * 60 * 1000);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private async sendHeartbeat(): Promise<void> {
    try {
      const machineProfile = buildLocalMachineProfile({
        workspaceDirectory: this.opts.workspaceDir,
        rootInstallDirectory: process.cwd(),
        gatewayPort: 18789,
        tunnelUrl: process.env.CODERCLAW_PUBLIC_TUNNEL_URL,
        tunnelStatus: process.env.CODERCLAW_PUBLIC_TUNNEL_URL ? "connected" : "none",
      });
      await fetch(this.heartbeatHttpUrl, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.opts.apiKey}`,
        },
        body: JSON.stringify({
          capabilities: ["chat", "tasks", "relay", "remote-dispatch"],
          machineProfile,
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      logDebug(`[builderforce-relay] heartbeat failed: ${String(err)}`);
    }
  }

  private async syncAssignmentContext(reason: string): Promise<void> {
    if (!this.opts.workspaceDir) {
      return;
    }
    try {
      const response = await fetch(this.assignmentContextUrl, {
        method: "GET",
        headers: { Authorization: `Bearer ${this.opts.apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        logDebug(`[builderforce-relay] assignment-context ${reason} failed: ${response.status}`);
        return;
      }
      const assignmentContext = (await response.json()) as AssignmentContextResponse;
      const context = await loadProjectContext(this.opts.workspaceDir);
      if (!context) {
        return;
      }

      const machineProfile = buildLocalMachineProfile({
        workspaceDirectory: this.opts.workspaceDir,
        rootInstallDirectory: process.cwd(),
        gatewayPort: 18789,
        tunnelUrl: process.env.CODERCLAW_PUBLIC_TUNNEL_URL,
        tunnelStatus: process.env.CODERCLAW_PUBLIC_TUNNEL_URL ? "connected" : "none",
      });

      const builderforce = mergeBuilderforceContext({
        existing: context.builderforce,
        assignmentContext,
        fallback: { instanceId: this.opts.clawId, url: this.opts.baseUrl },
        machineProfile,
      });

      await updateProjectContextFields(this.opts.workspaceDir, { builderforce });
    } catch (err) {
      logDebug(`[builderforce-relay] assignment-context ${reason} failed: ${String(err)}`);
    }
  }
}
