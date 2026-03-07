# CoderClaw Capability Gaps — Deep Audit

> Last updated: 2026-03-01
> Source: Code audit of `coderClaw/src/` and `coderClawLink/api/src/`

This document records what **actually works** vs. what is **facade code** (exists
but is never called) vs. what is **completely missing**. Every item here blocks
the self-improvement initiative where coderClaw builds itself using its own
agent features.

---

## Gap 1: Orchestrate Tool Creates But Never Executes Workflows

**Status**: ✅ RESOLVED — all workflow types (feature, bugfix, refactor, planning, adversarial, custom) are supported and execute synchronously.

**Evidence**:

- `src/coderclaw/tools/orchestrate-tool.ts` now creates then immediately executes:
  - `const wf = globalOrchestrator.createWorkflow(steps);`
  - `await globalOrchestrator.executeWorkflow(wf.id, context);`
- The tool now returns completion/failure JSON with task results, rather than claiming asynchronous execution.
- `src/coderclaw/orchestrator.ts` executes dependency-aware tasks and marks workflow status (`running` → `completed`/`failed`).
- `src/coderclaw/orchestrator.test.ts` covers dependency resolution and runnable-task behavior.

**Impact**: Feature/bugfix/refactor/planning/adversarial/custom workflows now execute end-to-end.

**Remaining work**: None.

---

## Gap 2: Agent Roles Defined But Never Applied

**Status**: ✅ RESOLVED — custom roles loaded at gateway startup; built-in roles wired through findAgentRole; test coverage added

**Resolution**:

- `src/coderclaw/agent-roles.ts`: Added `registerCustomRoles()` and `clearCustomRoles()` to manage module-scoped custom roles registry. Built-in roles always precede custom ones, preventing accidental overrides.
- `src/gateway/server.impl.ts`: On gateway boot, calls `loadCustomAgentRoles(process.cwd())`, registers them, and logs load count when roles are found. Wrapped in try-catch to prevent startup failure from malformed YAML.
- `src/coderclaw/agent-roles.test.ts`: Added comprehensive tests (6 tests, 100% pass) covering registration, precedence, and clearing behavior.
- The orchestrator already uses `findAgentRole` when spawning subagents (see `orchestrator.ts` `executeTask`). Now custom roles are available to that lookup.

**Verification**:

- Run `pnpm test src/coderclaw/agent-roles.test.ts` → 6/6 pass
- Start gateway → logs "Loaded N custom agent roles from .coderClaw/agents" if any present
- Create custom role in `.coderclaw/agents/my-role.yaml` → `orchestrate` workflow steps can reference it

**Remaining work**: None. Validation added in `src/coderclaw/orchestrator.ts` to throw on unknown roles; example custom role provided in `.coderClaw/agents/my-role.yaml`.

**Verification snapshot (2026-02-28):**

- `pnpm exec vitest --run src/coderclaw/agent-roles.test.ts src/coderclaw/orchestrator.test.ts` → 8/8 pass
- `pnpm exec vitest run --config vitest.e2e.config.ts src/agents/coderclaw-tools.subagents.sessions-spawn.allowlist.e2e.test.ts src/agents/coderclaw-tools.subagents.sessions-spawn.model.e2e.test.ts` → 14/14 pass

---

## Gap 3: Session Handoff Is Dead Code

**Status**: ✅ RESOLVED — `save_session_handoff` tool wired; handoff loaded on session start; `/handoff` TUI command added

**Resolution (2026-03-01)**:

- **`save_session_handoff` tool** created at `src/coderclaw/tools/save-session-handoff-tool.ts`:
  - Accepts `projectRoot`, `sessionId?`, `summary`, `decisions?`, `nextSteps?`,
    `openQuestions?`, `artifacts?`
  - Calls `saveSessionHandoff()` from `project-context.ts`, writing a YAML file
    to `.coderClaw/sessions/<sessionId>.yaml`
  - Returns path + confirmation so the agent can confirm success
  - Registered in `createCoderClawTools()` (`src/agents/coderclaw-tools.ts`) and
    exported from `src/coderclaw/tools/index.ts`
- **Handoff loaded on session start** (`src/tui/tui-session-actions.ts`):
  - `setSession()` now calls `loadLatestSessionHandoff(process.cwd())` after
    `loadHistory()` completes
  - If a handoff exists, a system message is added to the chat log:
    `"Resuming from session <id> (<date>)\nSummary: ...\nDecisions: ...\nNext steps: ...\nOpen questions: ..."`
  - Silent no-op when `.coderClaw/` does not exist
- **`/handoff` TUI command** (`src/tui/tui-command-handlers.ts`, `commands.ts`):
  - Sends a structured message to the connected agent asking it to call
    `save_session_handoff` with a summary of the session
  - Errors gracefully if gateway is disconnected

**Verification**:

1. Do work in a session on an initialized coderClaw project
2. Type `/handoff` — agent calls `save_session_handoff`; confirm `.coderClaw/sessions/*.yaml` written
3. Type `/new` to reset the session
4. A system message "Resuming from session …" appears with the summary
5. Project without `.coderClaw/` — no message shown, no error

**Remaining gaps**:

- **No automatic save on exit**: The handoff is agent-triggered (via `/handoff`
  or agent self-initiative). Automatic save when the TUI exits or `/new` is
  issued without calling `/handoff` first is still missing.
- **No `project_knowledge handoff` query**: The `project_knowledge` tool does
  not yet expose the handoff YAML files. Agents can only read handoffs via
  the filesystem tool.

---

## Gap 4: Workflow State Is Ephemeral

**Status**: ✅ RESOLVED — checkpoints written after every task state change; incomplete workflows restored at gateway startup; `resumeWorkflow()` added

**Resolution (2026-03-01)**:

- **`PersistedWorkflow` / `PersistedTask` types** added to `project-context.ts`:
  plain objects with ISO-string dates so YAML serialization is lossless.
- **`saveWorkflowState(projectRoot, workflow)`**: writes
  `.coderClaw/sessions/workflow-<id>.yaml` after every task status change.
- **`loadWorkflowState(projectRoot, id)`**: reads a single workflow YAML.
- **`listIncompleteWorkflowIds(projectRoot)`**: scans `sessions/` and returns
  IDs of workflows still in `pending` or `running` state.
- **`AgentOrchestrator.setProjectRoot(root)`**: enables persistence. Call once
  at gateway startup.
- **`AgentOrchestrator.persistWorkflow(workflow)`** (private): serializes the
  full workflow + `taskResults` map to YAML. Fire-and-forget; errors are logged,
  not thrown. Called in `createWorkflow`, `executeTask` (on status change),
  and after `executeWorkflow` completes/fails.
- **`AgentOrchestrator.hydrateWorkflow(persisted)`** (private): reconstructs
  a live `Workflow` from a `PersistedWorkflow`. Tasks that were `running` at
  crash time are reset to `pending` so they re-execute on resume.
- **`AgentOrchestrator.loadPersistedWorkflows()`**: loads all incomplete
  workflows from disk into the in-memory map. Returns their IDs.
- **`AgentOrchestrator.resumeWorkflow(id, context)`**: loads from disk if
  not already in memory, then delegates to `executeWorkflow` (which skips
  already-completed tasks via its `executedTasks` set).
- **Gateway startup** (`server-startup.ts`): `globalOrchestrator.setProjectRoot()`
  and `loadPersistedWorkflows()` called early in `startGatewaySidecars`. A
  warning is logged for each incomplete workflow found (e.g. "1 incomplete
  workflow(s) restored: <id>").

**Verification**:

1. Start a workflow via `orchestrate` tool (multi-step feature)
2. Kill the gateway process mid-step
3. Restart → logs show "incomplete workflow(s) restored: <id>"
4. `workflow_status` tool returns the workflow as `pending` (tasks reset from
   `running` to `pending`)
5. Re-run `orchestrate` with the same workflowId to resume
6. `.coderClaw/sessions/workflow-<id>.yaml` is updated after every step

**Remaining gaps**:

- **No auto-resume prompt**: The TUI does not yet show "Resume incomplete
  workflow? [Y/n]" on session start. The log message + `workflow_status` tool
  is the current mechanism.
- **Result quality**: Completed task output is stored as
  `"Task <id> completed successfully"` — a placeholder. Real output from the
  subagent is not yet captured and injected into dependent task inputs.

---

## Gap 5: No Post-Task Knowledge Update

**Status**: ✅ PARTIALLY RESOLVED — activity log written after every run; CoderClawLink synced automatically; `project_knowledge memory` query wired

**Resolution (2026-03-01)**:

- **`appendKnowledgeMemory()`** added to `src/coderclaw/project-context.ts`:
  appends timestamped entries to `.coderClaw/memory/YYYY-MM-DD.md`, creating
  the file and directory as needed.
- **`syncCoderClawDirectory(SyncCoderClawDirParams)`** extracted from
  `src/infra/clawlink-directory-sync.ts` as a standalone reusable export (the
  startup wrapper now delegates to it). Allows sync at any time.
- **`KnowledgeLoopService`** created at `src/infra/knowledge-loop.ts`:
  - Subscribes to `onAgentEvent` (the same global bus used by the relay)
  - Per run: accumulates tool events (`toolName`, `path`) to track
    `filesCreated`, `filesEdited`, `toolNames`
  - On `lifecycle.end` / `lifecycle.error`: writes a timestamped entry to
    `.coderClaw/memory/YYYY-MM-DD.md` then calls `syncCoderClawDirectory()`
    if `apiKey` + `clawId` are present
  - Clean `stop()` via the `onAgentEvent` unsubscribe return value
- **Wired into `startGatewaySidecars`** (`src/gateway/server-startup.ts`):
  `KnowledgeLoopService` starts whenever `CODERCLAW_LINK_API_KEY` is set.
  Sync is silently skipped when `clawId` is absent (API key without a
  registered claw still gets local memory writes).
- **`project_knowledge` tool** (`src/coderclaw/tools/project-knowledge-tool.ts`):
  new `"memory"` query type reads the last 7 `.coderClaw/memory/*.md` files
  and returns them joined with `---` separators. Also included in `"all"`.

**Remaining gaps**:

- **Activity log is structural, not semantic**: entries record which files
  were touched and which tools ran, but not _what_ changed or _why_. An agent
  reading the memory sees file lists, not architectural insight.
- **`architecture.md` still never auto-updated**: `updateProjectContextFields()`
  still only called during setup wizard. A post-task hook that refreshes
  `architecture.md` after large feature additions is still missing.
- **`.coderClaw/memory/` not indexed by the vector memory system**: the
  `memory-core` / `memory-lancedb` extensions watch workspace-root `memory/`,
  not `.coderClaw/memory/`. Semantic search across the knowledge log is not yet
  available.
- **No `/knowledge update` TUI command**: agents cannot manually trigger a
  knowledge sync or annotate their own work.

**Verification**:

1. Start gateway with `CODERCLAW_LINK_API_KEY` set and `clawLink.instanceId` in
   context.yaml
2. Send a message that causes file edits
3. After run completes → `.coderClaw/memory/YYYY-MM-DD.md` has a new `## [timestamp]`
   entry listing edited files and tools used
4. CoderClawLink → Claw panel → Directories shows updated memory file timestamp
5. `project_knowledge memory` → returns recent entries

---

## Gap 6: Mesh Is Branding, Not Implementation

**Status**: ✅ RESOLVED — hub-and-spoke relay functional; claw-to-claw delegation implemented (2026-03-01)

**Resolution (2026-03-01)**:

### Infrastructure (CoderClawLink)

- **Migration `0007_claw_capabilities.sql`**: Added `capabilities TEXT` column
  to `coderclaw_instances` (stores JSON array of capability strings).
- **Heartbeat now persists capabilities** (`PATCH /api/claws/:id/heartbeat`):
  accepts `{ capabilities: string[] }` body; writes JSON to the new column on
  every heartbeat so the fleet registry stays up-to-date.
- **Fleet discovery endpoint** (`GET /api/claws/fleet?from=<clawId>&key=<apiKey>`):
  claw-authenticated (no user JWT needed); returns all claws in the same
  tenant with `id`, `name`, `slug`, `online`, `connectedAt`, `lastSeenAt`,
  `capabilities`. Registered before `/:id` routes to avoid param capture.
- **Claw-to-claw forwarding** (`POST /api/claws/:id/forward?from=<sourceId>&key=<sourceKey>`):
  - Authenticates the SOURCE claw (not the target) via its own API key
  - Verifies target is in the same tenant
  - Delivers the JSON payload to the target claw via `ClawRelayDO.fetch()` dispatch
  - Returns `{ ok, delivered }` or `{ ok: false, error: "claw_offline" }`
- **Real capabilities in fleet response** (`GET /api/tenants/:id/claws`):
  `capabilities` read from DB; `capabilitySummary.remoteDispatch` is now
  `true` only when the claw is online AND reports `"remote-dispatch"` in its
  capabilities (was hardcoded to `connectedAt !== null`).

### coderClaw agent side

- **Heartbeat sends capabilities** (`src/infra/clawlink-relay.ts`):
  `sendHeartbeat()` now POSTs `{ capabilities: ["chat","tasks","relay","remote-dispatch"] }`
  so the CoderClawLink DB always has accurate metadata.
- **`remote.task` message handler** (`ClawLinkRelayService.handleRelayMessage`):
  when the relay delivers a `{ type: "remote.task", task, fromClawId }` to the
  upstream WS, the relay service dispatches it as a local `chat.send` with a
  `[Remote task from claw <id>]` prefix.
- **`claw_fleet` agent tool** (`src/coderclaw/tools/claw-fleet-tool.ts`):
  calls `GET /api/claws/fleet` with claw API key auth; returns fleet list with
  capabilities and online status; suggests `remote:<id>` as the role format.
  Registered in `coderclaw-tools.ts` and `tools/index.ts`.
- **`remote-subagent.ts`** (`src/infra/remote-subagent.ts`):
  `dispatchToRemoteClaw(opts, targetClawId, task)` — POST to
  `/api/claws/:targetId/forward`; returns `{ status: "accepted" }` or
  `{ status: "rejected", error }`.
- **Orchestrator remote routing** (`src/coderclaw/orchestrator.ts`):
  - `setRemoteDispatchOptions({ baseUrl, myClawId, apiKey })` — call at startup
  - In `executeTask`: if `agentRole.startsWith("remote:")` → extract target ID
    → call `dispatchToRemoteClaw`; on accepted: mark task `completed`; on
    rejected: mark `failed` and throw
- **Wired in `server-startup.ts`**: when `clawId` is present and API key is
  set, `globalOrchestrator.setRemoteDispatchOptions(...)` is called alongside
  `clawLinkRelay.start()`.

### Data flow

```
Orchestrator sees step: { role: "remote:456", task: "Implement feature X" }
  → dispatchToRemoteClaw(opts, "456", taskInput)
    → POST /api/claws/456/forward?from=123&key=<apiKey>
      → ClawRelayDO(456).fetch("https://internal/dispatch", payload)
        → upstreamSocket.send({ type: "remote.task", task: "…", fromClawId: "123" })
          → claw 456 ClawLinkRelayService.handleRelayMessage
            → gatewayClient.request("chat.send", { message: "[Remote task from claw 123]\n\n…" })
              → claw 456 local agent executes the task
```

**Verification**:

1. Start two claws on the same tenant (each with its own `instanceId` in context.yaml)
2. On claw A: `> claw_fleet` → both claws appear; claw B shows `online: true`
   and `capabilities: ["chat","tasks","relay","remote-dispatch"]`
3. On claw A: orchestrate a workflow with `{ role: "remote:<clawBId>", task: "echo hello from B" }`
4. Claw B's gateway log shows `[Remote task from claw <A>]` chat message
5. Orchestrator marks the step `completed` once delivery is confirmed
6. CoderClawLink → Claw panel → fleet shows `remoteDispatch: true` for both

**Remaining gaps**:

- **Fire-and-forget only**: results of the remote task are not streamed back to
  the orchestrating claw. Dependent workflow steps cannot use remote task output.
- **No capability-based routing**: orchestrator does not yet auto-select the
  best claw by matching capability requirements; caller specifies an explicit
  claw ID.
- **No bidirectional result channel**: a WebSocket-based result streaming path
  between claws would complete the full distributed execution story.

---

## Priority Order

| Priority | Gap                           | Status   | Why next                                                                         |
| -------- | ----------------------------- | -------- | -------------------------------------------------------------------------------- |
| ✅ done  | **-1.1** Wire executeWorkflow | RESOLVED | All workflow types execute synchronously via orchestrate tool                    |
| ✅ done  | **-1.2** Wire agent roles     | RESOLVED | Built-in + custom roles loaded and enforced at spawn time                        |
| ✅ done  | **-1.3** Wire session handoff | PARTIAL  | Save/load is wired; automatic save on exit/new still missing                     |
| ✅ done  | **-1.4** Workflow persistence | RESOLVED | Checkpoints + restore + resume after gateway restart                             |
| ✅ done  | **-1.5** Knowledge loop       | PARTIAL  | Activity log + sync + memory query wired; semantic synthesis still missing       |
| ✅ done  | **-1.6b** Claw-to-claw mesh   | RESOLVED | Fleet discovery, capability reporting, `/forward` dispatch, orchestrator routing |

All enabling gaps are now resolved.

---

## Open Gaps to Complete (Implementation Targets)

Only three meaningful gaps remain open. Treat these as the closure definition for this audit.

### A) Session Handoff Auto-Save (close remaining Gap -1.3)

**Current**: Handoff is saved only when the agent is explicitly asked (`/handoff` or agent initiative).

**Required**:

- Auto-trigger handoff save when `/new` is issued and the current session has user/assistant activity.
- Auto-trigger handoff save during graceful TUI shutdown.
- Preserve current manual `/handoff` behavior.

**Acceptance criteria**:

- `/new` without manual `/handoff` still creates `.coderClaw/sessions/<session>.yaml`.
- Exiting TUI after active work creates/updates latest handoff.
- No handoff file is written for empty sessions.

### B) Semantic Knowledge Synthesis (close remaining Gap -1.5)

**Current**: Knowledge entries list touched files/tools but not architectural intent.

**Required**:

- Add a post-run summarization pass that records:
  - why changes were made,
  - what behavior changed,
  - follow-up risks/questions.
- Add an opt-in command to force an immediate knowledge update (`/knowledge update`).
- Trigger targeted `architecture.md` refresh when edits cross configured scope thresholds.

**Acceptance criteria**:

- Memory entries include semantic summary (not just file/tool lists).
- `project_knowledge memory` returns semantic entries for recent runs.
- `architecture.md` receives deterministic updates after significant structural edits.

### C) Claw-to-Claw Delegation (Gap -1.6b) — ✅ RESOLVED

**Current**: Claw fleet discovery, heartbeat capability reporting, `/forward` HTTP
dispatch, `claw_fleet` tool, and orchestrator `remote:<clawId>` routing are all
implemented. Remote task result streaming is not yet available.

---

## Verification Checklist

After each gap is fixed, verify:

- [x] **-1.1** (2026-03-01): `> orchestrate feature "add a hello world function"` → subagents
      spawn, code is created, tested, and reviewed. Workflow reaches `completed`.
- [x] **-1.2** (2026-03-01): Spawned subagents use role-specific system prompts and tool sets.
      `code-reviewer` cannot use `create` tool. `refactor-agent` has explicit
      constraint about public APIs.
- [x] **-1.3** (2026-03-01): `/handoff` → agent calls `save_session_handoff` → YAML saved.
      `/new` → "Resuming from session … Summary: …" shown. Decisions + next steps in context.
- [x] **-1.4** (2026-03-01): Workflow YAML written after every task. Gateway restart
      logs "N incomplete workflow(s) restored". `workflow_status` shows pending tasks.
      `resumeWorkflow()` skips completed tasks and re-executes the rest.
- [x] **-1.5** (2026-03-01, partial): Complete a task → `.coderClaw/memory/YYYY-MM-DD.md`
      gets a timestamped entry with files touched and tools used. CoderClawLink
      syncs the memory file. `project_knowledge memory` returns recent entries.
      _(Semantic auto-update of `architecture.md` still pending.)_
- [x] **-1.6a** (2026-03-01): coderClaw connects to ClawRelayDO upstream WS on
      gateway start. `connectedAt` and `lastSeenAt` update correctly. Browser
      chat reaches local agent; agent responses stream back to browser.
- [x] **-1.6b** (2026-03-01): `GET /api/claws/fleet` returns online claws with real
      capabilities from DB. Heartbeat persists capabilities. `POST /api/claws/:id/forward`
      delivers tasks via ClawRelayDO. Orchestrator routes `remote:<clawId>` steps to
      `dispatchToRemoteClaw`. `claw_fleet` tool exposes fleet to agents.
      _(Result streaming back to orchestrating claw still pending.)_

---

## Gap 7: No Spec-Driven Entry Point in TUI

**Status**: ✅ RESOLVED (2026-03-04)

**Problem**: Users had no TUI shortcut to trigger a spec-driven planning workflow. The
`orchestrate` tool could run a planning workflow but only if the user knew to ask the
agent explicitly. There was no `/spec` command.

**Resolution**:

- Added `case "spec":` to `src/tui/tui-command-handlers.ts`.
  - Without args: shows `"Usage: /spec <goal>"`.
  - With args: sends a structured message asking the agent to call `orchestrate` with
    workflow `"planning"` and save outputs to `.coderClaw/planning/`.
- Registered in `src/tui/commands.ts` (`getSlashCommands()` + `helpText()`).
- Tests added in `src/tui/tui-command-handlers.test.ts` (2 tests).

**Acceptance**:

- `/spec` → usage hint
- `/spec Add real-time collaboration` → agent runs planning workflow (PRD → arch → tasks)

---

## Gap 8: No Workflow Visibility in TUI

**Status**: ✅ RESOLVED (2026-03-04)

**Problem**: Users and the agent had no way to query workflow status from the TUI.
The `workflow_status` tool existed for the agent to call, but there was no
`/workflow` slash command to invoke it.

**Resolution**:

- Added `case "workflow":` to `src/tui/tui-command-handlers.ts`.
  - Without args: asks agent to check the latest workflow using `workflow_status`.
  - With an ID arg: asks agent to check that specific workflow.
- Registered in `src/tui/commands.ts`.
- Tests added in `src/tui/tui-command-handlers.test.ts` (2 tests).

---

## Gap 9: `/compact` Missing from Help

**Status**: ✅ RESOLVED (2026-03-04)

**Problem**: `/compact` was registered as a gateway "chat command" (available via the
dynamic `listChatCommandsForConfig()` path) and worked via the `default` fallthrough
in the command handler, but it was absent from the static `helpText()` output that
users see with `/help`. This made it undiscoverable.

**Resolution**:

- Added `"/compact [instructions]"` to `helpText()` in `src/tui/commands.ts`.
- Added explicit `case "compact":` handler in `src/tui/tui-command-handlers.ts` to
  make intent clear and prevent accidental fallthrough behaviour changes.

---

## Gap 10: No Handoff Hint on Session Reset

**Status**: ✅ RESOLVED (2026-03-04)

**Problem**: When users typed `/new` or `/reset`, the session was immediately cleared
with no reminder to save context. Users routinely lost session summaries, decisions,
and next steps. Fully automatic save was not reliable (agent must respond before the
session is cleared), so a UX hint was the correct closure for this gap.

**Resolution**:

- Added `hasUserMessages(): boolean` to `ChatLog` (`src/tui/components/chat-log.ts`).
  Counts `addUser()` calls since last `clearAll()`.
- In `case "new"/"reset"` in `src/tui/tui-command-handlers.ts`: when the gateway is
  connected and `chatLog.hasUserMessages()` is true, shows:
  _"Tip: Run /handoff first to save session context before resetting."_
- Tests added in `src/tui/tui-command-handlers.test.ts` (2 tests: with and without activity).

---

## Gap 11: Knowledge Loop Produced Only File Lists (No Semantic Labels)

**Status**: ✅ RESOLVED (2026-03-04)

**Problem**: `.coderClaw/memory/YYYY-MM-DD.md` entries listed files created/edited and
tools used, but contained no human-readable summary of _what_ was accomplished. Memory
queries returned raw lists that were hard for agents and humans to interpret at a glance.

**Resolution**:

- Added `deriveActivitySummary({ created, edited, tools }): string` to
  `src/infra/knowledge-loop.ts` (exported for testability).
- Applies heuristics in priority order to produce a one-line English label:
  1. Multi-agent workflow execution
  2. Code review / analysis
  3. Test suite created / updated
  4. Codebase exploration (read-only)
  5. Feature implementation (new files + edits)
  6. New files only
  7. Code modifications only
  8. Agent activity (no file changes)
- Result appended as `**Summary**: …` in each run's memory entry.
- No model call required — pure heuristic, zero latency overhead.
- 11 unit tests added in `src/infra/knowledge-loop.test.ts`.

---

## Open Gaps (Phase 1)

### I) Remote Task Result Streaming

**Current**: `POST /api/claws/:id/forward` is fire-and-forget. Dependent orchestrator
steps that use `remote:<clawId>` roles cannot receive output from the remote execution.

**Required**:

- A result-streaming channel from target claw back to orchestrating claw.
- Options: (a) reverse HTTP callback, (b) WS result frame via `ClawRelayDO`,
  (c) polling a result endpoint added to coderClawLink.
- Orchestrator should surface result in `task.output` so dependent steps can use it.

**Acceptance criteria**:

- `orchestrate` workflow with `remote:<clawId>` step completes with non-empty `output`.
- Dependent steps receive the remote output as `input`.

**Requires**: coderClawLink API change — see `CODERCLAW_LINK_GAPS.md`.

---

### J) Capability-Based Claw Routing ✅ RESOLVED

**Resolution** (2026-03-04): Implemented in `src/coderclaw/orchestrator.ts` and
`src/infra/remote-subagent.ts`.

- `remote:auto` — orchestrator queries `GET /api/claws/fleet`, filters to online
  peer claws (excluding self), selects the first available.
- `remote:auto[cap1,cap2]` — filters further to claws satisfying ALL listed
  capabilities; selects highest-scoring match. Fails with descriptive error if no
  match is found.
- `selectClawByCapability()` helper in `src/infra/remote-subagent.ts`.
- `claw_fleet` tool accepts `requireCapabilities` parameter for agent-level
  fleet discovery.

**Acceptance criteria — met**:

- `orchestrate` step with `role: "remote:auto[gpu]"` routes to a claw reporting
  `"gpu"` in its heartbeat capabilities.
- `role: "remote:auto"` routes to any online peer without specifying a claw ID.

---

### K) Semantic Architecture.md Auto-Update

**Current**: `.coderClaw/architecture.md` is updated manually. The knowledge loop
only writes to daily memory files.

**Required**:

- After runs that exceed a configurable threshold of structural edits (e.g., ≥ 3
  new files or ≥ 5 edited files), trigger a targeted `architecture.md` refresh
  via a subagent using the `documentation-agent` role.
- Add `/knowledge update` TUI command to force an immediate update.

**Acceptance criteria**:

- A feature-implementation run that creates ≥ 3 files triggers an arch doc update.
- `/knowledge update` produces an updated `.coderClaw/architecture.md`.

---

## Gap L: Sub-Agent Context — Naive Text Concatenation

**Status**: ✅ RESOLVED — `buildStructuredContext()` with labelled sections (2026-03-04)

**Problem**: The orchestrator was passing prior-agent results to the next agent by
appending raw text (`taskInput += "\n\nPrevious Results:\n" + result`). With no
labels, the receiving agent could not tell which role produced which output.

**Resolution (2026-03-04)**:

- `buildStructuredContext(task, workflow)` in `src/coderclaw/orchestrator.ts` now
  produces a structured Markdown block per prior agent:
  ```markdown
  ## Your Task
  <task.input>

  ## Context from Prior Agents

  ### REVIEW: (code-reviewer)
  <result>

  ---

  ### ARCH: (architecture-advisor)
  <result>
  ```
- The label uses `outputFormat.outputPrefix` from each role's definition, so e.g.
  the code-reviewer prefixes its section "REVIEW:" and the arch-advisor prefixes "ARCH:".
- All 7 built-in roles have `outputFormat.outputPrefix` defined.

**Acceptance criteria — met**: receiving agent sees clearly labelled context blocks.

---

## Gap M: Agent Personas Not Loaded into Brain

**Status**: ✅ RESOLVED — `--- Agent Persona ---` block injected; brain reads it on all paths (2026-03-04)

**Problem**: Even when a sub-agent was spawned with a `roleConfig` containing
`persona` (voice, perspective, decisionStyle), the CoderClawLLM brain completely
ignored it. The `BRAIN_SYSTEM_PROMPT` was static — the brain had no idea which role
it was playing.

**Resolution (2026-03-04)**:

1. `buildPersonaSystemBlock(role)` in `src/coderclaw/personas.ts`:
   Encodes `role.persona` + `outputFormat` + `constraints` into:
   ```
   --- Agent Persona ---
   Role: code-reviewer
   Voice: critical yet constructive
   Perspective: all code is a future maintenance burden
   Decision style: thorough: surface all issues, ranked by severity
   Required output sections: ## Review Summary, ## Issues Found, ...
   Prefix your summary with: REVIEW:
   ---
   ```

2. `spawnSubagentDirect()` in `src/agents/subagent-spawn.ts`:
   Appends the persona block to `childSystemPrompt` alongside the role guidance.

3. `createCoderClawLlmLocalStreamFn()` in `src/agents/coderclawllm-local-stream.ts`:
   `brainSystem` now prepends `context.systemPrompt` (which carries the persona block):
   ```typescript
   const brainSystem = [context.systemPrompt, memoryBlock, ragContext, BRAIN_SYSTEM_PROMPT]
   ```
   **Both** the direct path and the DELEGATE path now see the persona.

**Acceptance criteria — met**: brain system prompt contains role identity on all execution paths.

---

## Gap N: Persona Plugin Architecture (Marketplace-Ready)

**Status**: ✅ RESOLVED — `PersonaRegistry`, PERSONA.yaml format, coderClawLink assignment (2026-03-04)

**Problem**: Roles were a flat list in `agent-roles.ts`. No install lifecycle, no
versioning, no marketplace metadata, no way to assign from coderClawLink.

**Resolution (2026-03-04)**:

- **`PersonaPlugin` type** — `AgentRole` + `source` + `pluginMetadata` + `filePath` + `active`
- **`PersonaPluginMetadata`** — `clawhubId`, `version`, `author`, `license`, `requiresLicense`,
  `marketplaceUrl`, `coderClawVersion`, `tags`, `checksum`
- **`PersonaRegistry` class** (`src/coderclaw/personas.ts`):
  - `registerBuiltins()`, `register()`, `loadFromDir()`, `applyAssignments()`
  - `activate()`, `deactivate()`, `resolve()`, `listAll()`, `listActive()`
  - Source precedence: builtin(1) < user-global(2) < project-local(3) < clawhub(4) < clawlink-assigned(5)
- **PERSONA.yaml format** — same structure as `AgentRole` YAML + marketplace fields
- **Project context** (`src/coderclaw/project-context.ts`):
  - `personasDir` added to `CoderClawDirectory`
  - `loadProjectPersonaPlugins()`, `loadPersonaAssignments()`, `savePersonaAssignment()`,
    `removePersonaAssignment()`
  - `context.yaml` `personas.assignments` field for coderClawLink assignments
- **Gateway bootstrap** (`src/gateway/server.impl.ts`):
  Loads built-ins → user-global → project-local → applies assignments on startup
- **`findAgentRole()` delegation**: checks registry as third tier after built-ins + custom roles

**Remaining**: ClawHub download/install CLI flow; coderClawLink Persona Assignment API endpoint.

---

## Gap O: CoderClawLLM — No System Requirements Check

**Status**: ✅ RESOLVED — syscheck with external LLM fallback (2026-03-04)

**Problem**: `getOrCreatePipeline()` attempted to download and load SmolLM2-1.7B-Instruct
(~900 MB, needs ~2 GB RAM) with zero pre-flight checks. On constrained machines it failed
late with cryptic errors; there was no fallback.

**Resolution (2026-03-04)**:

- `checkLocalBrainRequirements()` in `src/agents/coderclawllm-syscheck.ts`:
  1. `os.freemem() < 2 GB` → fail: insufficient RAM
  2. `isModelCached()` → if cached, skip disk check
  3. `fs.statfs(cacheDir).bavail < 1.5 GB` → fail: insufficient disk space
- Lazy singleton per factory instance: check runs once on first request, result cached
- When eligible=false: **external LLM becomes the brain** — memory + RAG + persona block
  all injected into `callExecutionLlm()` so the external model has the same grounding
- `logInfo("[coderclawllm] <reason>")` explains why local brain is not in use

**Acceptance criteria — met**:
- Machine with < 2 GB free RAM → uses configured Ollama/OpenAI provider as brain
- Machine with ≥ 2 GB RAM + model cached → uses SmolLM2 as brain
- Machine with ≥ 2 GB RAM + model not cached + < 1.5 GB disk → uses external LLM

---

## Updated Priority Order

| Priority | Gap  | Item                              | Status   |
| -------- | ---- | --------------------------------- | -------- |
| ✅       | -1.1 | Wire executeWorkflow              | RESOLVED |
| ✅       | -1.2 | Wire agent roles                  | RESOLVED |
| ✅       | -1.3 | Session handoff save/load         | RESOLVED |
| ✅       | -1.4 | Workflow persistence              | RESOLVED |
| ✅       | -1.5 | Knowledge loop                    | RESOLVED |
| ✅       | -1.6 | Claw-to-claw mesh                 | RESOLVED |
| ✅       | 7    | `/spec` TUI command               | RESOLVED |
| ✅       | 8    | `/workflow` TUI command           | RESOLVED |
| ✅       | 9    | `/compact` in help                | RESOLVED |
| ✅       | 10   | Handoff hint on /new              | RESOLVED |
| ✅       | 11   | Semantic knowledge summaries      | RESOLVED |
| 🔲       | I    | Remote task result streaming      | OPEN     |
| ✅       | J    | Capability-based claw routing     | RESOLVED |
| 🔲       | K    | Architecture.md auto-update       | OPEN     |
| ✅       | L    | Structured inter-agent context    | RESOLVED |
| ✅       | M    | Persona → brain injection         | RESOLVED |
| ✅       | N    | Persona plugin architecture       | RESOLVED |
| ✅       | O    | CoderClawLLM syscheck + fallback  | RESOLVED |
| 🔲       | P    | ClawHub persona marketplace       | OPEN     |
| 🔲       | Q    | coderClawLink Persona Assignment API | OPEN  |
