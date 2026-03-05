/**
 * ClawLinkRelayService
 *
 * Persistent upstream WebSocket connection from coderClaw → coderClawLink relay.
 * Bridges bidirectional chat:
 *   - Browser → ClawRelayDO → upstream WS → this service → local gateway → agent
 *   - Agent → local gateway events → this service → upstream WS → ClawRelayDO → browsers
 *
 * Also sends periodic HTTP heartbeats to keep lastSeenAt fresh in the DB.
 */

import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { GatewayClient, type GatewayClientOptions } from "../gateway/client.js";
import type { EventFrame } from "../gateway/protocol/index.js";
import { logDebug, logWarn } from "../logger.js";

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

export type ClawLinkRelayOptions = {
  /** Base HTTP(S) URL of coderClawLink, e.g. "https://api.coderclaw.ai" */
  baseUrl: string;
  /** Numeric claw instance id (as string), from context.clawLink.instanceId */
  clawId: string;
  /** Plaintext API key from CODERCLAW_LINK_API_KEY */
  apiKey: string;
  /** Local coderClaw gateway WebSocket URL. Defaults to ws://127.0.0.1:18789 */
  gatewayUrl?: string;
};

export class ClawLinkRelayService {
  private ws: WebSocket | null = null;
  private closed = false;
  private backoffMs = 1000;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private logsTimer: ReturnType<typeof setInterval> | null = null;
  private logsCursor: number | undefined;
  private presenceTimer: ReturnType<typeof setInterval> | null = null;
  private gatewayClient: GatewayClient | null = null;

  private readonly upstreamWsUrl: string;
  private readonly heartbeatHttpUrl: string;
  private readonly gatewayWsUrl: string;

  private dispatchTaskFromRelay(payload: {
    title: string;
    description?: string;
    executionId?: number;
    taskId?: number;
    sourceType: "task.assign" | "task.broadcast";
  }): void {
    const lines = [
      `[ClawLink ${payload.sourceType}] ${payload.title}`,
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

    this.gatewayClient
      ?.request("chat.send", {
        sessionKey: "main",
        message,
        idempotencyKey: `task-${payload.sourceType}-${payload.taskId ?? "na"}-${payload.executionId ?? Date.now()}`,
      })
      .catch((err: unknown) => {
        logWarn(`[clawlink] ${payload.sourceType} dispatch failed: ${String(err)}`);
      });
  }

  constructor(private readonly opts: ClawLinkRelayOptions) {
    const base = opts.baseUrl
      .replace(/^https:/, "wss:")
      .replace(/^http:/, "ws:")
      .replace(/\/$/, "");
    this.upstreamWsUrl = `${base}/api/claws/${opts.clawId}/upstream?key=${encodeURIComponent(opts.apiKey)}`;
    this.heartbeatHttpUrl = `${opts.baseUrl.replace(/\/$/, "")}/api/claws/${opts.clawId}/heartbeat?key=${encodeURIComponent(opts.apiKey)}`;
    this.gatewayWsUrl = opts.gatewayUrl ?? "ws://127.0.0.1:18789";
  }

  /** Start the relay service. Both WS connections retry on their own. */
  start(): void {
    if (this.closed) {
      return;
    }
    this.connectUpstream();
    this.connectLocalGateway();
  }

  /** Gracefully shut down both connections. */
  stop(): void {
    this.closed = true;
    this.clearHeartbeat();
    this.clearLogsPolling();
    this.clearPresencePolling();
    this.ws?.close(1000, "stopped");
    this.ws = null;
    this.gatewayClient?.stop();
    this.gatewayClient = null;
  }

  // ---------------------------------------------------------------------------
  // Upstream WebSocket (coderClaw → ClawRelayDO)
  // ---------------------------------------------------------------------------

  private connectUpstream(): void {
    if (this.closed) {
      return;
    }

    const ws = new WebSocket(this.upstreamWsUrl);
    this.ws = ws;

    ws.on("open", () => {
      logWarn("[clawlink-relay] upstream connected");
      this.backoffMs = 1000;
      this.scheduleHeartbeat();
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
        logWarn("[clawlink-relay] upstream disconnected — reconnecting…");
        this.scheduleReconnect();
      }
    });

    ws.on("error", (err) => {
      logWarn(`[clawlink-relay] upstream error: ${String(err)}`);
      // "close" follows automatically
    });
  }

  /**
   * Handle messages forwarded from browser clients through ClawRelayDO.
   * Translates ClawLink wire protocol → local gateway method calls.
   */
  private handleRelayMessage(msg: Record<string, unknown>): void {
    const type = typeof msg.type === "string" ? msg.type : "";

    switch (type) {
      case "relay_connected":
        logDebug("[clawlink-relay] relay acknowledged connection");
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
            logDebug(`[clawlink-relay] chat.send failed: ${String(err)}`);
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
        if (!task) {
          break;
        }
        logDebug(`[clawlink-relay] remote task from claw ${fromClawId}: ${task.slice(0, 80)}…`);
        this.gatewayClient
          ?.request("chat.send", {
            sessionKey: "main",
            message: `[Remote task from claw ${fromClawId}]\n\n${task}`,
            idempotencyKey: `remote-${fromClawId}-${Date.now()}`,
          })
          .catch((err: unknown) => {
            logDebug(`[clawlink-relay] remote.task dispatch failed: ${String(err)}`);
          });
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

        if (!title && !description) {
          logWarn(`[clawlink] received ${type} without task content`);
          break;
        }

        logWarn(
          `[clawlink] received ${type}${taskId != null ? ` task=${taskId}` : ""}${executionId != null ? ` execution=${executionId}` : ""}`,
        );

        this.dispatchTaskFromRelay({
          sourceType: type,
          title: title || "Assigned task",
          description: description || undefined,
          executionId,
          taskId,
        });
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
      const res = (await this.gatewayClient.request("logs.tail", {
        cursor: this.logsCursor,
        limit: 500,
        maxBytes: 250_000,
      })) as { cursor?: number; lines?: unknown[]; reset?: boolean };

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
      logDebug(`[clawlink-relay] logs.tail failed: ${String(err)}`);
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
      logDebug(`[clawlink-relay] system-presence failed: ${String(err)}`);
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
        logDebug(`[clawlink-relay] local gateway connect error: ${String(err)}`);
      },
    };
    const gw = new GatewayClient(opts);
    this.gatewayClient = gw;
    // GatewayClient has its own backoff reconnect — start it independently of upstream.
    gw.start();
  }

  /**
   * Translate local gateway "chat" EventFrames → ClawLink browser protocol,
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
      await fetch(this.heartbeatHttpUrl, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          capabilities: ["chat", "tasks", "relay", "remote-dispatch"],
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      logDebug(`[clawlink-relay] heartbeat failed: ${String(err)}`);
    }
  }
}
