# CoderClaw Architecture

## Overview

CoderClaw is a self-hosted AI coding agent gateway that runs on developer machines.
It provides 7 specialized agent roles, a multi-agent orchestrator, 53 skills, and
a WebSocket-based transport layer. It connects to **coderClawLink** (cloud portal)
for fleet management, task delegation, approval workflows, and observability.

## System Diagram

```
Human Developer (TUI / IDE / messaging channel)
        │
        ▼
┌─────────────────────────────────────────┐
│            CoderClaw Gateway             │
│         ws://127.0.0.1:18789            │
│                                          │
│  ┌──────────┐  ┌────────────────────┐   │
│  │ Sessions  │  │ Agent Dispatcher   │   │
│  │ (in-mem)  │  │ spawnSubagentDirect│   │
│  └──────────┘  └────────────────────┘   │
│  ┌──────────────────────────────────┐   │
│  │ Tool Registry                    │   │
│  │ create|edit|view|bash|grep|glob  │   │
│  │ + coderclaw tools (orchestrate,  │   │
│  │   workflow_status, code_analysis, │   │
│  │   project_knowledge, git_history) │   │
│  └──────────────────────────────────┘   │
│  ┌──────────────────────────────────┐   │
│  │ Extension System                 │   │
│  │ diagnostics-otel, memory-core,   │   │
│  │ memory-lancedb, channels, etc.   │   │
│  └──────────────────────────────────┘   │
│  ┌──────────────────────────────────┐   │
│  │ Model Providers                  │   │
│  │ Anthropic, OpenAI, Google,       │   │
│  │ Ollama, node-llama-cpp,          │   │
│  │ coderclawLLM (planned)           │   │
│  └──────────────────────────────────┘   │
└─────────────┬───────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│  ClawLinkTransportAdapter (HTTP)        │
│  → POST /api/runtime/executions         │
│  → GET  /api/runtime/executions/:id     │
│                                          │
│  ClawLinkRelayService (WS)              │
│  → wss://.../api/claws/:id/upstream     │
│  → bridges local gateway ↔ ClawRelayDO  │
│  → PATCH .../heartbeat every 5 min      │
│                                          │
│  ClawLinkDirectorySync (HTTP)           │
│  → PUT /api/claws/:id/directories/sync  │
│  → one-way upload of .coderClaw/ files  │
└─────────────┬───────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│        coderClawLink (Cloud)            │
│  Hono on Cloudflare Workers             │
│  Drizzle ORM → Postgres (Hyperdrive)    │
│  ClawRelayDO (Durable Object, WS relay) │
│  SPA (React) for management             │
└─────────────────────────────────────────┘
```

## Core Modules

### Gateway (`src/gateway/`)

- WebSocket server on port 18789
- JSON-RPC message protocol
- Session management (create, switch, reset, message history)
- Agent dispatch — spawns subagents with tool access

### Agent System (`src/agents/`)

- `subagent-spawn.ts` — `spawnSubagentDirect()`: the actual agent execution engine
- `agent-scope.ts` — resolves agent configuration from YAML config
- `model-selection.ts` — model routing, allowlists, provider resolution
- `tools/` — built-in tools (create, edit, view, bash, grep, glob, task)

### CoderClaw Layer (`src/coderclaw/`)

- `agent-roles.ts` — 7 built-in roles + custom role loading from `.coderClaw/agents/`
- `orchestrator.ts` — workflow engine, dependency DAG, task scheduling, disk persistence,
  `remote:<clawId>` routing via `dispatchToRemoteClaw`
- `project-context.ts` — `.coderClaw/` directory management, YAML I/O, session handoff,
  workflow state persistence, knowledge memory append
- `types.ts` — ProjectContext, AgentRole, SessionHandoff, CodeMap types
- `tools/` — orchestrate, workflow_status, code_analysis, project_knowledge (incl. memory),
  git_history, save_session_handoff, claw_fleet

### TUI (`src/tui/`)

- Ink + React terminal interface
- Slash commands: /agent, /model, /init, /session, /think, /compact, /cost, /handoff
- `tui-command-handlers.ts` — command dispatch

### Transport (`src/transport/`)

- `clawlink-adapter.ts` — HTTP transport to coderClawLink API (runtime executions)
- Types: TransportAdapter interface, ClawLinkConfig, RuntimeInterface

### ClawLink Relay (`src/infra/`)

- `clawlink-relay.ts` — `ClawLinkRelayService`: persistent upstream WS + local gateway bridge
  - Connects to `wss://.../api/claws/:id/upstream` on gateway startup
  - Bridges browser→agent: translates relay wire messages into local `GatewayClient` requests
  - Bridges agent→browser: converts `"chat"` EventFrames to ClawLink wire protocol for broadcast
  - HTTP heartbeat PATCH every 5 minutes to keep `lastSeenAt` fresh in the DB
  - Exponential backoff reconnect (1 s → 30 s) on WS drop
- `clawlink-directory-sync.ts` — `syncCoderClawDirectoryOnStartup()`: one-way HTTP PUT of
  all `.coderClaw/` files to the API on gateway boot (up to 200 files, 512 KB each)

### Extensions (`extensions/`)

- Plugin system with lifecycle hooks (load, unload, on-message, etc.)
- `diagnostics-otel` — 634 lines, 20+ metrics, OTel traces + logs via OTLP/http
- `memory-core` / `memory-lancedb` — vector memory with node-llama-cpp embeddings
- Channel extensions: Discord, Slack, Telegram, Matrix, IRC, etc.

### Skills (`skills/`)

- 53 skill definitions, each with SKILL.md (instructions + tool mappings)
- `coderclaw` meta-skill: code_analysis, project_knowledge, git_history, orchestrate, workflow_status
- `skill-creator` skill: scaffolds new skills from templates
- `gh-issues`, `github`: Git/GitHub workflow automation
- `coding-agent`: core coding skill used by all code-creation agents

## Capability Status

All enabling gaps closed as of 2026.3.1. See `.coderClaw/planning/CAPABILITY_GAPS.md` for details.

1. ✅ RESOLVED — `executeWorkflow()` wired into `orchestrate` tool; all 6 workflow types execute
2. ✅ RESOLVED — `agent-roles.ts` wired; custom roles loaded from `.coderClaw/agents/` at startup
3. ✅ RESOLVED — Session handoff: `save_session_handoff` tool + `/handoff` cmd + auto-load on session start
4. ✅ RESOLVED — Workflow persistence: checkpoints to `.coderClaw/sessions/workflow-<id>.yaml`;
   incomplete workflows restored at gateway restart
5. ✅ RESOLVED — Knowledge loop: `KnowledgeLoopService` writes `.coderClaw/memory/YYYY-MM-DD.md`
   after each run; auto-synced to CoderClawLink; `project_knowledge memory` query added
6. ✅ RESOLVED — Claw-to-claw mesh: fleet discovery, capability reporting, `/forward` HTTP dispatch,
   `claw_fleet` tool, `remote:<clawId>` orchestrator routing

### New Subsystems (2026.3.1)

**Session Handoff** (`src/coderclaw/tools/save-session-handoff-tool.ts`):

- Agent tool that writes `.coderClaw/sessions/<id>.yaml` with summary, decisions, next steps
- TUI loads latest handoff on session start and shows a system message
- `/handoff` slash command triggers agent to produce and save a handoff

**Workflow Persistence** (`src/coderclaw/project-context.ts`, `orchestrator.ts`):

- `saveWorkflowState()` — serializes full workflow (Map→Record, Date→ISO string) to YAML
- `loadPersistedWorkflows()` — scans `sessions/` and hydrates incomplete workflows at startup
- `resumeWorkflow()` — picks up from last checkpoint; in-flight tasks reset to `pending`

**Knowledge Loop** (`src/infra/knowledge-loop.ts`):

- Subscribes to `onAgentEvent`; accumulates tool/file activity per run
- On `lifecycle.end`: appends timestamped entry to `.coderClaw/memory/YYYY-MM-DD.md`
- Calls `syncCoderClawDirectory()` to push the updated file to CoderClawLink

**Claw-to-Claw Mesh** (`src/infra/remote-subagent.ts`, `src/coderclaw/tools/claw-fleet-tool.ts`):

- `claw_fleet` tool: queries `GET /api/claws/fleet` (claw-keyed auth) → returns online claws + capabilities
- `remote:<clawId>` orchestrator role: dispatches task via `POST /api/claws/:id/forward`
- Target claw receives `remote.task` via WS; executes as local chat message
- `ClawLinkRelayService` heartbeat now reports `capabilities: ["chat","tasks","relay","remote-dispatch"]`

## Data Flow: Agent Task Execution

```
1. User sends message via TUI / WS / channel
2. Gateway routes to active session
3. Session dispatches to agent (via spawnSubagentDirect)
4. Agent receives system prompt + tools + message
5. Agent calls tools (create, edit, bash, etc.)
6. Tool results streamed back to session
7. Agent produces response
8. Response rendered in TUI / forwarded to channel
```

## Data Flow: coderClawLink Integration

```
1. coderclaw init → login → register claw → get API key
2. API key stored in ~/.coderclaw/.env (CODERCLAW_LINK_API_KEY)
3. clawLink.instanceId stored in .coderClaw/context.yaml
4. On gateway startup:
   a. ClawLinkRelayService opens WS to /api/claws/:id/upstream
   b. ClawLinkDirectorySync uploads .coderClaw/ files via HTTP PUT
   c. DB: connectedAt and lastSeenAt set immediately
5. Browser client connects to /api/claws/:id/ws → ClawRelayDO
   a. ClawRelayDO sends { type:"claw_online" } immediately
6. Browser → ClawRelayDO → upstream WS → ClawLinkRelayService
   → GatewayClient.request("chat.send") → local agent
7. Agent response → GatewayClient event → ClawLinkRelayService
   → upstream WS → ClawRelayDO.broadcast() → all browser clients
8. HTTP heartbeat PATCH every 5 min keeps lastSeenAt fresh
```
