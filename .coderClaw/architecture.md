# CoderClaw Architecture

> Last updated: 2026-03-04

## Overview

CoderClaw is a self-hosted AI coding agent gateway that runs on developer machines.
It provides 7 specialised agent roles, a multi-agent orchestrator, 53 skills, a
semantic knowledge loop, and a WebSocket-based transport layer. It connects to
**coderClawLink** (cloud portal) for fleet management, task delegation, approval
workflows, and observability.

---

## System Diagram

```
Human Developer
  │  (TUI / IDE / messaging channel)
  ▼
┌──────────────────────────────────────────────────────────────┐
│                    CoderClaw Gateway                          │
│                  ws://127.0.0.1:18789                         │
│                                                               │
│  ┌────────────┐  ┌─────────────────────────────────────┐     │
│  │  Sessions   │  │        Agent Dispatcher              │     │
│  │  (in-mem)   │  │  spawnSubagentDirect (7 roles)       │     │
│  └────────────┘  └─────────────────────────────────────┘     │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐     │
│  │ Tool Registry                                         │     │
│  │  Core: create | edit | view | bash | grep | glob      │     │
│  │  CoderClaw: orchestrate | workflow_status |           │     │
│  │    code_analysis | project_knowledge | git_history    │     │
│  │    save_session_handoff | claw_fleet                  │     │
│  └─────────────────────────────────────────────────────┘     │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐     │
│  │ TUI Slash Commands                                    │     │
│  │  /agent  /model  /think  /session  /init  /handoff   │     │
│  │  /compact  /spec  /workflow  /project  /sync         │     │
│  │  /verbose  /reasoning  /usage  /elevated  /gateway   │     │
│  │  /logs  /setup  /new  /reset  /abort  /exit          │     │
│  └─────────────────────────────────────────────────────┘     │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐     │
│  │ Orchestrator (dependency DAG + persistence)          │     │
│  │  Workflow types: feature | bugfix | refactor |        │     │
│  │    planning | adversarial | custom                    │     │
│  │  Roles: code-creator | code-reviewer | test-generator│     │
│  │    bug-analyzer | refactor-agent | documentation-    │     │
│  │    agent | architecture-advisor + custom YAML roles  │     │
│  └─────────────────────────────────────────────────────┘     │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐     │
│  │ Knowledge Loop (KnowledgeLoopService)                 │     │
│  │  Per-run: files created/edited, tools used            │     │
│  │  Semantic summary (heuristic, no model call)          │     │
│  │  Writes: .coderClaw/memory/YYYY-MM-DD.md              │     │
│  │  Auto-syncs to CoderClawLink on completion            │     │
│  └─────────────────────────────────────────────────────┘     │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐     │
│  │ Extension System                                      │     │
│  │  diagnostics-otel | memory-core | memory-lancedb     │     │
│  │  channels: Discord, Slack, Telegram, Matrix, IRC…    │     │
│  └─────────────────────────────────────────────────────┘     │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐     │
│  │ Model Providers (30+)                                 │     │
│  │  Anthropic | OpenAI | Google | Ollama | Bedrock      │     │
│  │  vLLM | Together | HuggingFace | Cloudflare | Venice │     │
│  │  Qianfan | MiniMax | Moonshot | NVIDIA | Qwen…       │     │
│  └─────────────────────────────────────────────────────┘     │
└──────────────────────────────────────┬───────────────────────┘
                                        │
                                        ▼
┌──────────────────────────────────────────────────────────────┐
│                  ClawLink Transport Layer                      │
│                                                               │
│  ClawLinkRelayService (WS)                                    │
│  → wss://.../api/claws/:id/upstream?key=…                    │
│  → bridges browser ↔ local gateway (bidirectional)           │
│  → PATCH .../heartbeat every 5 min (capabilities payload)    │
│  → receives remote.task, task.assign, task.broadcast          │
│                                                               │
│  ClawLinkDirectorySync (HTTP)                                 │
│  → PUT /api/claws/:id/directories/sync?key=…                 │
│  → one-way upload of .coderClaw/ files (max 200 × 512 KB)    │
│                                                               │
│  ClawLinkTransportAdapter (HTTP)                              │
│  → POST /api/runtime/executions                               │
│  → GET  /api/runtime/executions/:id   (polling)              │
│  → POST /api/runtime/executions/:id/cancel                    │
│                                                               │
│  Remote Subagent Dispatch (HTTP)                              │
│  → POST /api/claws/:targetId/forward?from=…&key=…            │
│  → fleet discovery: GET /api/claws/fleet?from=…&key=…        │
└──────────────────────────────────────┬───────────────────────┘
                                        │
                                        ▼
┌──────────────────────────────────────────────────────────────┐
│                   coderClawLink  (Cloud)                       │
│                                                               │
│  Runtime: Hono on Cloudflare Workers                          │
│  DB: Drizzle ORM → Postgres (Hyperdrive)                     │
│  Real-time: ClawRelayDO (Durable Object — WS relay hub)       │
│  SPA: React management portal                                 │
│                                                               │
│  Current API surface:                                         │
│    Auth, Tenants, Claws, Projects, Fleet, Heartbeat,          │
│    Directory Sync, Runtime Executions, Remote Dispatch        │
│                                                               │
│  Needed additions → see "coderClawLink Feature Gaps" section  │
└──────────────────────────────────────────────────────────────┘
```

---

## Core Modules

### Gateway (`src/gateway/`)

- WebSocket server on port 18789
- JSON-RPC message protocol
- Session management (create, switch, reset, message history)
- Agent dispatch — spawns subagents with tool access

### Agent System (`src/agents/`)

- `subagent-spawn.ts` — `spawnSubagentDirect()`: primary agent execution engine
- `agent-scope.ts` — resolves agent configuration from YAML config
- `model-selection.ts` — model routing, allowlists, provider resolution
- `system-prompt.ts` — modular system prompt builder (full / minimal / none modes)
- `tools/` — core tools: create, edit, view, bash, grep, glob, task
- `context.ts` — context window discovery and token budget management
- `pi-embedded-runner/` — embedded agent runner with auto-compaction, safety timeout,
  post-compaction audit, tool-result context guard

### CoderClaw Layer (`src/coderclaw/`)

- `agent-roles.ts` — 7 built-in roles + custom role loading from `.coderClaw/agents/*.yaml`;
  `registerCustomRoles()` / `clearCustomRoles()` for runtime management
- `orchestrator.ts` — workflow engine: dependency DAG, task scheduling, disk persistence,
  `remote:<clawId>` routing via `dispatchToRemoteClaw`
- `orchestrator-enhanced.ts` — workflow factory functions: `createPlanningWorkflow()`,
  `createFeatureWorkflow()`, `createBugFixWorkflow()`, `createRefactorWorkflow()`,
  `createAdversarialReviewWorkflow()`
- `project-context.ts` — `.coderClaw/` directory management, YAML I/O, session handoff,
  workflow state persistence, knowledge memory append
- `types.ts` — ProjectContext, AgentRole, SessionHandoff, CodeMap types
- `tools/` — orchestrate, workflow_status, code_analysis, project_knowledge,
  git_history, save_session_handoff, claw_fleet

### TUI (`src/tui/`)

- `@mariozechner/pi-tui` terminal interface
- **Full slash command set** (updated 2026-03-04):
  - Session: `/new`, `/reset`, `/handoff`, `/session`, `/sessions`, `/abort`
  - Context: `/compact [instructions]`, `/spec <goal>`, `/workflow [id]`
  - Agent: `/agent`, `/agents`, `/model`, `/models`, `/think`
  - Config: `/verbose`, `/reasoning`, `/usage`, `/elevated`, `/activation`
  - Project: `/init`, `/project`, `/sync`
  - System: `/gateway`, `/daemon`, `/logs`, `/setup`, `/settings`, `/exit`
- `tui-command-handlers.ts` — command dispatch with `/spec` → planning workflow,
  `/workflow` → status query, `/compact` → explicit compaction, `/new` → handoff hint
- `components/chat-log.ts` — `hasUserMessages()` tracks session activity for handoff hints

### Transport (`src/transport/`)

- `clawlink-adapter.ts` — HTTP adapter to coderClawLink runtime executions API
- Types: `TransportAdapter`, `ClawLinkConfig`, `RuntimeInterface`

### ClawLink Relay (`src/infra/`)

- `clawlink-relay.ts` — `ClawLinkRelayService`: persistent upstream WS + local gateway bridge
  - Bidirectional: browser→agent and agent→browser
  - Heartbeat PATCH every 5 min with capabilities array
  - Exponential backoff reconnect (1 s → 30 s)
- `clawlink-directory-sync.ts` — one-way upload of `.coderClaw/` on startup and `/sync`
- `remote-subagent.ts` — `dispatchToRemoteClaw()` for claw-to-claw task delegation
- `knowledge-loop.ts` — `KnowledgeLoopService`: per-run activity accumulation,
  semantic summary derivation (`deriveActivitySummary()`), memory file append, auto-sync

### Extensions (`extensions/`)

- `diagnostics-otel` — 20+ OTel metrics, traces, logs via OTLP/http
- `memory-core` / `memory-lancedb` — hybrid BM25 + vector memory (node-llama-cpp embeddings)
- Channel extensions: Discord, Slack, Telegram, Matrix, IRC, and more

### Skills (`skills/`)

- 53 skill definitions with SKILL.md and tool mappings
- `coderclaw` meta-skill: code_analysis, project_knowledge, git_history,
  orchestrate, workflow_status
- `skill-creator`: scaffolds new skills from templates
- `gh-issues`, `github`: Git/GitHub workflow automation

---

## Capability Status (as of 2026-03-04)

### ✅ Core Infrastructure — Complete

1. ✅ `executeWorkflow()` wired — all 6 workflow types execute end-to-end
2. ✅ `agent-roles.ts` wired — 7 built-in + custom YAML roles enforced at spawn
3. ✅ Session handoff — `save_session_handoff` tool + `/handoff` + auto-load on start
4. ✅ Workflow persistence — checkpoints to `.coderClaw/sessions/workflow-*.yaml`; resume after restart
5. ✅ Knowledge loop — activity log + CoderClawLink sync + `project_knowledge memory` query
6. ✅ Claw mesh — fleet discovery, heartbeat, `/forward` dispatch, `claw_fleet` tool,
   `remote:<clawId>` orchestrator routing

### ✅ TUI UX & Context Quality — Complete

7. ✅ `/spec <goal>` — triggers spec-driven planning workflow (PRD → arch → tasks) from TUI
8. ✅ `/workflow [id]` — queries workflow status from TUI
9. ✅ `/compact` — explicit TUI handler + added to `/help` output
10. ✅ Handoff hint — `/new` shows `/handoff` reminder when session has user messages
11. ✅ Semantic knowledge — `deriveActivitySummary()` adds one-line semantic label to each run

### ✅ Distributed Runtime — Complete

12. ✅ Transport abstraction layer — `LocalTransportAdapter` + `ClawLinkTransportAdapter`
13. ✅ Distributed task lifecycle — formal state machine, audit trail, persistence
14. ✅ Identity & security model — RBAC, device trust, granular policy enforcement
15. ✅ Capability-based claw routing — `remote:auto` / `remote:auto[cap1,cap2]` in orchestrator

### 🔲 Open Items

- Remote task result streaming (claw-to-claw result channel — requires coderClawLink relay frame)
- Semantic knowledge synthesis (architecture.md auto-update after structural edits)
- coderClawLink: workflow/spec APIs, execution WebSocket streaming, spec portal UI

---

## New Subsystems

### `/spec` Command (`src/tui/tui-command-handlers.ts`)

Triggers a three-step planning workflow via the `orchestrate` tool:

1. Architecture Advisor writes PRD
2. Architecture Advisor writes architecture spec
3. Architecture Advisor decomposes into ordered task list with dependencies

All outputs are saved to `.coderClaw/planning/`.

### `/workflow` Command (`src/tui/tui-command-handlers.ts`)

Queries the running orchestrator for workflow status via the `workflow_status` tool.
Accepts an optional workflow ID; without one, returns the latest active workflow.

### Handoff Hint on `/new`

`ChatLog.hasUserMessages()` tracks whether any user message was sent in the current
session. When `/new` or `/reset` is called with the gateway connected and the session
has activity, a tip is shown: _"Run /handoff first to save session context before
resetting."_

### Semantic Knowledge Summaries (`src/infra/knowledge-loop.ts`)

`deriveActivitySummary({ created, edited, tools })` applies tool-usage heuristics to
produce a one-line English description of what happened in each agent run. No model
call required. Priority order:

1. Multi-agent workflow execution (orchestrate/workflow_status tools present)
2. Code review / analysis (git_history / code_analysis / project_knowledge)
3. Test suite created / updated (_.test._ or _.spec._ files touched)
4. Codebase exploration (read-only grep/glob/view, no bash, no file changes)
5. Feature implementation (new files + edits)
6. New file creation only
7. Code modifications only
8. Agent activity (tools used, no file changes)

---

## coderClawLink Feature Gaps

See `.coderClaw/planning/CODERCLAW_LINK_GAPS.md` for the full feature gap summary
targeting the `SeanHogg/coderClawLink` repository.

---

## Data Flow: Agent Task Execution

```
1. User sends message via TUI / WS / channel
2. Gateway routes to active session
3. Session dispatches to agent (via spawnSubagentDirect)
4. Agent receives system prompt + role guidance + tools + message
5. Agent calls tools (create, edit, bash, orchestrate, etc.)
6. KnowledgeLoopService accumulates tool/file activity
7. Tool results streamed back to session
8. Agent produces response
9. Response rendered in TUI / forwarded to channel
10. On lifecycle.end: knowledge entry written + CoderClawLink synced
```

## Data Flow: Spec-Driven Development (/spec)

```
1. User types: /spec Add real-time collaboration
2. TUI command handler sends structured planning request to agent
3. Agent calls orchestrate tool with workflow: "planning"
4. Orchestrator creates 3-step workflow:
   Step 1 (arch-advisor): Write PRD for goal
   Step 2 (arch-advisor): Write architecture spec [depends on Step 1]
   Step 3 (arch-advisor): Decompose into ordered task list [depends on Step 2]
5. Each step spawns a subagent with architecture-advisor role config
6. Results accumulated; workflow reaches "completed"
7. Outputs saved to .coderClaw/planning/
8. Agent reports summary to user
```

## Data Flow: coderClawLink Integration

```
1. coderclaw init → login → register claw → get API key
2. API key stored in ~/.coderclaw/.env (CODERCLAW_LINK_API_KEY)
3. clawLink.instanceId stored in .coderClaw/context.yaml
4. On gateway startup:
   a. ClawLinkRelayService opens WS to /api/claws/:id/upstream?key=…
   b. ClawLinkDirectorySync uploads .coderClaw/ files via HTTP PUT
   c. DB: connectedAt and lastSeenAt set immediately
5. Browser client connects to /api/claws/:id/ws → ClawRelayDO
   a. ClawRelayDO sends { type:"claw_online" } immediately
6. Browser → ClawRelayDO → upstream WS → ClawLinkRelayService
   → GatewayClient.request("chat.send") → local agent
7. Agent response → GatewayClient event → ClawLinkRelayService
   → upstream WS → ClawRelayDO.broadcast() → all browser clients
8. HTTP heartbeat PATCH every 5 min keeps lastSeenAt fresh
   Payload: { capabilities: ["chat","tasks","relay","remote-dispatch"] }
9. On run complete: KnowledgeLoopService calls syncCoderClawDirectory()
   → PUT /api/claws/:id/directories/sync (pushes memory files)
```

## Data Flow: Multi-Claw Orchestration

### Explicit Target (`remote:<clawId>`)

```
1. Agent calls orchestrate with role: "remote:<targetClawId>"
2. Orchestrator calls dispatchToRemoteClaw(targetClawId, task)
3. POST /api/claws/:targetId/forward?from=…&key=…
   Body: { type: "remote.task", task: "…", fromClawId: "…", timestamp: "…" }
4. coderClawLink receives request → delivers via ClawRelayDO to target upstream WS
5. Target claw receives { type: "remote.task", task: "…" }
6. Target executes as a local chat message
7. [OPEN] Result streaming back to orchestrating claw — requires coderClawLink relay frame
```

### Capability-Based Auto-Routing (`remote:auto` or `remote:auto[cap1,cap2]`)

```
1. Agent calls orchestrate with role: "remote:auto" or "remote:auto[gpu,high-memory]"
2. Orchestrator calls selectClawByCapability(opts, requiredCaps)
3. GET /api/claws/fleet?from=…&key=… — fetch all online peer claws
4. Filter to claws satisfying ALL required capabilities; pick highest-scoring
5. If no match → workflow step fails with descriptive error
6. Proceed with resolved clawId as if "remote:<selectedId>" was specified
```
