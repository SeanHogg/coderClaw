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
import { logDebug } from "../logger.js";
import type { EventFrame } from "../gateway/protocol/index.js";

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
  private gatewayClient: GatewayClient | null = null;

  private readonly upstreamWsUrl: string;
  private readonly heartbeatHttpUrl: string;
  private readonly gatewayWsUrl: string;

  constructor(private readonly opts: ClawLinkRelayOptions) {
    const base = opts.baseUrl
      .replace(/^https:/, "wss:")
      .replace(/^http:/, "ws:")
      .replace(/\/$/, "");
    this.upstreamWsUrl  = `${base}/api/claws/${opts.clawId}/upstream?key=${encodeURIComponent(opts.apiKey)}`;
    this.heartbeatHttpUrl = `${opts.baseUrl.replace(/\/$/, "")}/api/claws/${opts.clawId}/heartbeat?key=${encodeURIComponent(opts.apiKey)}`;
    this.gatewayWsUrl   = opts.gatewayUrl ?? "ws://127.0.0.1:18789";
  }

  /** Start the relay service. Both WS connections retry on their own. */
  start(): void {
    if (this.closed) return;
    this.connectUpstream();
    this.connectLocalGateway();
  }

  /** Gracefully shut down both connections. */
  stop(): void {
    this.closed = true;
    this.clearHeartbeat();
    this.ws?.close(1000, "stopped");
    this.ws = null;
    this.gatewayClient?.stop();
    this.gatewayClient = null;
  }

  // ---------------------------------------------------------------------------
  // Upstream WebSocket (coderClaw → ClawRelayDO)
  // ---------------------------------------------------------------------------

  private connectUpstream(): void {
    if (this.closed) return;

    const ws = new WebSocket(this.upstreamWsUrl);
    this.ws = ws;

    ws.on("open", () => {
      logDebug("[clawlink-relay] upstream connected");
      this.backoffMs = 1000;
      this.scheduleHeartbeat();
    });

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as Record<string, unknown>;
        this.handleRelayMessage(msg);
      } catch {
        /* ignore malformed frames */
      }
    });

    ws.on("close", () => {
      if (this.ws === ws) {
        this.ws = null;
        this.clearHeartbeat();
        logDebug("[clawlink-relay] upstream disconnected — reconnecting…");
        this.scheduleReconnect();
      }
    });

    ws.on("error", (err) => {
      logDebug(`[clawlink-relay] upstream error: ${String(err)}`);
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
        const session = typeof msg.session === "string" ? msg.session : "default";
        this.gatewayClient
          ?.request("chat.send", {
            sessionKey:     session,
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

  private scheduleReconnect(): void {
    if (this.closed) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, 30_000);
    setTimeout(() => this.connectUpstream(), delay).unref();
  }

  // ---------------------------------------------------------------------------
  // Local Gateway Client (local agent events → relay → browsers)
  // ---------------------------------------------------------------------------

  private connectLocalGateway(): void {
    const opts: GatewayClientOptions = {
      url:            this.gatewayWsUrl,
      onEvent:        (evt) => this.handleGatewayEvent(evt),
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
    if (evt.event !== "chat") return;

    const p = evt.payload as {
      type?: string;
      text?: string;
      role?: string;
      delta?: string;
      toolCallId?: string;
      toolName?: string;
      toolInput?: string;
      toolResult?: string;
    } | null | undefined;

    if (!p) return;

    switch (p.type) {
      case "delta":
        this.sendToRelay({ type: "chat.delta", delta: p.delta ?? "" });
        break;
      case "message":
        this.sendToRelay({ type: "chat.message", role: p.role ?? "assistant", text: p.text ?? "" });
        break;
      case "tool_use":
        this.sendToRelay({
          type:       "tool.start",
          toolCallId: p.toolCallId,
          toolName:   p.toolName,
          toolInput:  p.toolInput,
        });
        break;
      case "tool_result":
        this.sendToRelay({
          type:       "tool.result",
          toolCallId: p.toolCallId,
          toolResult: p.toolResult,
        });
        break;
      case "abort":
        this.sendToRelay({ type: "chat.abort" });
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
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      logDebug(`[clawlink-relay] heartbeat failed: ${String(err)}`);
    }
  }
}
