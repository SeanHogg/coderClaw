# CoderClaw Architecture

## Overview

CoderClaw is a self-hosted AI coding agent gateway that runs on developer machines.
It provides 7 specialized agent roles, a multi-agent orchestrator, 56 skills, and
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
│  ClawLinkUpstreamClient (WS) [PLANNED]  │
│  → wss://.../api/claws/:id/upstream     │
│  → bridges gateway ↔ ClawRelayDO        │
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

- `agent-roles.ts` — 7 built-in role definitions (⚠️ not wired to runtime yet)
- `orchestrator.ts` — workflow engine, dependency DAG, task scheduling
- `orchestrator-enhanced.ts` — distributed orchestrator (Phase 2 target)
- `project-context.ts` — `.coderClaw/` directory management, YAML I/O
- `types.ts` — ProjectContext, AgentRole, SessionHandoff, CodeMap types
- `tools/` — orchestrate, workflow_status, code_analysis, project_knowledge, git_history

### TUI (`src/tui/`)

- Ink + React terminal interface
- Slash commands: /agent, /model, /init, /session, /think, /compact, /cost
- `tui-command-handlers.ts` — command dispatch

### Transport (`src/transport/`)

- `clawlink-adapter.ts` — HTTP transport to coderClawLink API
- Types: TransportAdapter interface, ClawLinkConfig, RuntimeInterface

### Extensions (`extensions/`)

- Plugin system with lifecycle hooks (load, unload, on-message, etc.)
- `diagnostics-otel` — 634 lines, 20+ metrics, OTel traces + logs via OTLP/HTTP
- `memory-core` / `memory-lancedb` — vector memory with node-llama-cpp embeddings
- Channel extensions: Discord, Slack, Telegram, Matrix, IRC, etc.

### Skills (`skills/`)

- 56 skill definitions, each with SKILL.md (instructions + tool mappings)
- `coderclaw` meta-skill: code_analysis, project_knowledge, git_history, orchestrate, workflow_status
- `skill-creator` skill: scaffolds new skills from templates
- `gh-issues`, `github`: Git/GitHub workflow automation
- `coding-agent`: core coding skill used by all code-creation agents

## Known Architectural Gaps

See `.coderClaw/planning/ROADMAP.md` Phase -1 for the 4 critical gaps:

1. `executeWorkflow()` never called — orchestrator is dead code
2. `agent-roles.ts` orphaned — role definitions not read by runtime
3. Session handoff never wired — save/load functions exist but unused
4. No workflow persistence — all state in-memory

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
2. API key stored in ~/.coderclaw/.env
3. ClawLinkTransportAdapter reads API key on boot
4. HTTP requests to /api/runtime/* for task lifecycle
5. [PLANNED] ClawLinkUpstreamClient opens WS to relay DO
6. [PLANNED] Messages bridge local gateway ↔ cloud SPA
```
