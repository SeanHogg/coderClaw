# CoderClaw Roadmap

> Last updated: 2026-03-04

---

## ✅ Core Infrastructure — Complete

### Wire `executeWorkflow()` into `orchestrate` ✅

- `orchestrate` tool calls `globalOrchestrator.executeWorkflow()` synchronously.
- All 6 workflow types (feature, bugfix, refactor, planning, adversarial, custom) execute.

### Bridge `agent-roles.ts` into runtime ✅

- 7 built-in roles + custom roles from `.coderClaw/agents/*.yaml` loaded at gateway startup.
- Role model / tools / system-prompt applied at subagent spawn via `roleConfig`.

### Session handoff save/load ✅

- `save_session_handoff` tool writes `.coderClaw/sessions/<id>.yaml`.
- TUI auto-loads latest handoff on session start.
- `/handoff` slash command triggers agent to produce and save a handoff.

### Workflow persistence ✅

- `saveWorkflowState()` checkpoints each task transition to disk.
- `loadPersistedWorkflows()` restores incomplete workflows at gateway restart.
- `resumeWorkflow()` resets in-flight tasks to `pending` and re-executes.

### Post-task knowledge loop ✅

- `KnowledgeLoopService` writes `.coderClaw/memory/YYYY-MM-DD.md` after every run.
- `project_knowledge memory` query surfaces recent entries to agents.
- Auto-synced to CoderClawLink on write.

### Claw-to-claw mesh ✅

- Fleet discovery via `GET /api/claws/fleet`.
- Heartbeat PATCH reports capabilities array.
- `POST /api/claws/:id/forward` delivers `remote.task` to peer claw.
- `claw_fleet` tool exposes fleet to agents.
- Orchestrator routes `remote:<clawId>` steps via `dispatchToRemoteClaw`.

---

## ✅ TUI UX & Context Quality — Complete

### `/spec <goal>` TUI command ✅

- Triggers spec-driven planning workflow from TUI (PRD → arch spec → task breakdown).
- File: `src/tui/commands.ts`, `src/tui/tui-command-handlers.ts`

### `/workflow [id]` TUI command ✅

- Queries orchestrator workflow status directly from TUI.
- File: `src/tui/commands.ts`, `src/tui/tui-command-handlers.ts`

### `/compact` in TUI help ✅

- Explicit `case "compact":` handler added; `/compact [instructions]` added to `/help`.
- File: `src/tui/commands.ts`, `src/tui/tui-command-handlers.ts`

### Session-reset handoff hint ✅

- `ChatLog.hasUserMessages()` tracks session activity.
- `/new`/`/reset` shows `/handoff` reminder when session has user messages.
- File: `src/tui/components/chat-log.ts`, `src/tui/tui-command-handlers.ts`

### Semantic knowledge summaries ✅

- `deriveActivitySummary()` produces one-line semantic label per run (no model call).
- Appended as `**Summary**:` in each memory entry.
- File: `src/infra/knowledge-loop.ts`, `src/infra/knowledge-loop.test.ts`

---

## ✅ Distributed Runtime — Complete

### Transport abstraction layer ✅

- Protocol-agnostic `RuntimeInterface` + pluggable `TransportAdapter`.
- `LocalTransportAdapter` — in-process execution reference implementation.
- `ClawLinkTransportAdapter` — HTTP adapter to CoderClawLink runtime API.
- File: `src/transport/`

### Distributed task lifecycle ✅

- Formal state machine: PENDING → PLANNING → RUNNING → COMPLETED (+ WAITING / FAILED / CANCELLED).
- Validated transitions; invalid moves throw.
- Structured per-task event log (audit trail).
- Long-running job persistence + resumable execution.
- File: `src/transport/task-engine.ts`

### Identity & security model ✅

- `BasicSecurityService`: RBAC, device trust levels, session/agent/skill/repo policies.
- Built-in roles: admin, developer, readonly, ci.
- Comprehensive audit logging.
- File: `src/security/`

### Capability-based claw routing ✅

- `remote:auto` — orchestrator auto-selects any available online peer claw.
- `remote:auto[cap1,cap2]` — requires ALL listed capabilities; highest-scoring match wins.
- `selectClawByCapability()` helper queries fleet and scores candidates.
- `claw_fleet` tool accepts `requireCapabilities` filter.
- File: `src/infra/remote-subagent.ts`, `src/coderclaw/orchestrator.ts`

---

## 🔲 Open Items

### Remote task result streaming

- Claw-to-claw tasks are fire-and-forget; dependent steps cannot consume remote output.
- **Requires coderClawLink change**: `remote.result` relay frame in `ClawRelayDO`.
- See CAPABILITY_GAPS.md Gap I.

### Architecture.md semantic auto-update

- After runs with ≥ N structural file changes, trigger a `documentation-agent` subagent
  to refresh `.coderClaw/architecture.md`.
- Add `/knowledge update` TUI command.
- See CAPABILITY_GAPS.md Gap K.

### coderClawLink feature gaps

- See `.coderClaw/planning/CODERCLAW_LINK_GAPS.md` for full list.
- Key items: workflow/spec portal UI, execution WS streaming, spec storage API,
  result-streaming relay frame, enhanced fleet management.

---

## Canonical Code Paths

```
src/tui/commands.ts                              — slash command definitions + helpText
src/tui/tui-command-handlers.ts                  — slash command handlers (spec, workflow, compact…)
src/tui/components/chat-log.ts                   — ChatLog with hasUserMessages()
src/infra/knowledge-loop.ts                      — KnowledgeLoopService + deriveActivitySummary
src/infra/remote-subagent.ts                     — dispatchToRemoteClaw + selectClawByCapability
src/coderclaw/tools/orchestrate-tool.ts          — orchestrate tool entry point
src/coderclaw/orchestrator.ts                    — workflow engine (AgentOrchestrator)
src/coderclaw/orchestrator-enhanced.ts           — workflow factory functions
src/coderclaw/agent-roles.ts                     — role registry
src/coderclaw/tools/claw-fleet-tool.ts           — claw_fleet tool
src/agents/subagent-spawn.ts                     — spawnSubagentDirect
src/infra/clawlink-relay.ts                      — ClawLinkRelayService
src/transport/                                   — transport abstraction layer
src/security/                                    — RBAC + security service
```

## Non-Existent Paths (do not reference)

```
src/coderclaw/agents/subagent-spawn.ts   ← wrong directory
src/coderclaw/tools/common.ts            ← does not exist
src/agents/agent-manager.ts             ← does not exist
```
