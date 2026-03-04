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

## Phase 2: Orchestrator → Market Parity

> Source: `docs/FEATURE_GAP_ANALYSIS.md` (full competitor gap analysis)  
> Business context: `docs/BUSINESS_ROADMAP.md`

### 2.1 Orchestration Workspace Live UI 🔲 (P0)

**Problem**: No live visibility into which agent is executing, what it is doing, or how far along it is.  
**Competitors with this**: Devin, Windsurf Cascade, Cursor Composer, OpenHands web UI.

- coderClawLink portal: live workflow DAG with per-task status badge and elapsed time
- New WS relay frames: `workflow.update`, `task.started`, `task.output_delta`, `task.completed`
- TUI: `/pane` command to toggle chat ↔ live workflow view
- Per-task agent persona display (role name, model, current action)

Files: `src/coderclaw/orchestrator.ts`, `src/infra/clawlink-relay.ts`, coderClawLink SPA

### 2.2 MCP Codebase Semantic Search 🔲 (P0)

**Problem**: `project_knowledge` only does keyword search over memory files; no vector search over source.  
**Competitors with this**: Cursor (`@codebase`), Windsurf Cascade auto-context, Continue.dev, Goose MCP.

- Wire `memory-lancedb` extension into `project_knowledge` tool for vector search queries
- New `codebase_search` tool: embed query → LanceDB → return ranked file/function matches
- Expose CoderClaw tools as an MCP server so Cursor/Continue.dev/Windsurf can call them
- Semantic auto-context injection: pre-fetch top-K relevant files before subagent dispatch

Files: `src/coderclaw/tools/project-knowledge-tool.ts`, `extensions/memory-lancedb/`, new `src/mcp-server/`

### 2.3 Inline Diff / Pair Programming Mode 🔲 (P1)

**Problem**: `edit`/`create` tools apply immediately; no pre-apply diff review.  
**Competitors with this**: Aider (diff hunks), Cursor Composer (accept/reject panel), Windsurf Cascade.

- Diff staging buffer: agent writes to staged store; `/accept [file]` applies, `/reject [file]` discards
- TUI `/diff` command: show pending changes as unified diff
- TUI `/accept all` and `/reject all` for batch approval
- Integration with approval workflow API (coderClawLink P3-3)

Files: `src/agents/tools/`, `src/tui/commands.ts`, `src/tui/tui-command-handlers.ts`

### 2.4 Session Auto-Checkpoint 🔲 (P1)

**Problem**: Handoff is manual (`/handoff`); session context lost on unexpected exit.  
**Competitors with this**: Plandex (plan object), Aider (git-based undo), Claude Code (`--continue`).

- Auto-write handoff YAML on TUI exit or `/new` if session has user messages
- TUI `/sessions` picker: list handoffs with date/summary; select to resume
- TUI `/undo`: `git stash` to revert last agent file changes
- TUI `/fork`: create a git branch before running a risky workflow

Files: `src/tui/tui-command-handlers.ts`, `src/coderclaw/project-context.ts`

### 2.5 Persona Profiles 🔲 (P1)

**Problem**: System prompt customization is per-role only; no named persona concept.  
**Competitors with this**: Goose (persona config), Continue.dev (per-context model routing).

- Persona file format: `.coderClaw/personas/<name>.yaml` with `{ name, model, systemPromptAddition, thinkingLevel, tools }`
- TUI `/persona <name>` command to activate a persona for the current session
- Workflow YAML: optional `model` field per step (overrides role default)
- coderClawLink: team persona registry with shared persona sync

Files: `src/coderclaw/agent-roles.ts`, `src/tui/commands.ts`, new `src/coderclaw/personas.ts`

### 2.6 GitHub Issue → PR End-to-End Workflow 🔲 (P1)

**Problem**: No workflow type for resolving a GitHub issue end-to-end.  
**Competitors with this**: Devin (full issue → PR), GitHub Copilot (PR context).

- New workflow type: `issue` — fetches GitHub issue context, plans fix, implements, opens PR
- New `gh_issue` tool: fetch issue body + comments; surface as context to first workflow step
- Orchestrator post-workflow hook: `createPR()` if workflow completed without errors
- CI feedback loop: poll GitHub Actions after PR; spawn Bug Analyzer if CI fails

Files: `src/coderclaw/orchestrator-enhanced.ts`, new `src/coderclaw/tools/gh-issue-tool.ts`

### 2.7 PR Review GitHub App 🔲 (P2)

**Problem**: Code Reviewer role runs locally only; no automatic PR review on push.  
**Competitors with this**: CodeRabbit, Ellipsis, GitHub Copilot PR summary.

- GitHub App webhook: on PR opened/updated, trigger `adversarial` review workflow
- Post review as GitHub PR review comments via `gh` tool
- Configurable depth: quick (security/bugs only) vs. full (style + architecture)
- Free for open-source repositories (community growth driver)

Files: new `src/github-app/`, coderClawLink webhook handler

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
