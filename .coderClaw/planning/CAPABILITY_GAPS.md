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
- Create custom role in `.coderClaw/agents/my-role.yaml` → `orchestrate` workflow steps can reference it

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

**Status**: PARTIALLY IMPLEMENTED — hub-and-spoke relay is now end-to-end functional; claw-to-claw mesh still completely missing

**Evidence**:

### What "mesh" implies:

- Multiple coderClaw instances collaborating as a workforce
- Claw-to-claw task delegation (claw A asks claw B to do work)
- Distributed orchestration across claws
- Fleet discovery (which claws are online, what are their capabilities)

### What was built (2026-03-01):

- **`ClawLinkRelayService`** (`src/infra/clawlink-relay.ts` — NEW): Persistent
  service that manages the upstream WebSocket connection from coderClaw to
  `ClawRelayDO`. Previously listed as `[PLANNED]`; now implemented.
  - Connects to `wss://.../api/claws/:id/upstream?key=<apiKey>` on gateway startup
  - Exponential backoff reconnect (1 s → 30 s cap) on disconnect
  - Bridges browser→agent: translates `chat`, `chat.abort`, `session.new` relay
    messages into local `gateway.request("chat.send", ...)` calls via `GatewayClient`
  - Bridges agent→browser: translates local gateway `"chat"` EventFrames
    (`delta`, `message`, `tool_use`, `tool_result`, `abort`) into ClawLink wire
    protocol messages broadcast over the upstream WebSocket
  - HTTP heartbeat: `PATCH /api/claws/:id/heartbeat?key=<apiKey>` every 5
    minutes to keep `lastSeenAt` fresh even when no messages are flowing
- **Wired into `startGatewaySidecars`** (`src/gateway/server-startup.ts`):
  reads `CODERCLAW_LINK_API_KEY` and `CODERCLAW_LINK_URL` from
  `~/.coderclaw/.env`; loads `clawLink.instanceId` from project context; starts
  `ClawLinkRelayService` if both are present. Returns handle for clean shutdown.
- **`.coderClaw` directory sync** (`src/infra/clawlink-directory-sync.ts`):
  on gateway startup, `syncCoderClawDirectoryOnStartup()` does a one-way HTTP
  PUT of local `.coderClaw` files (up to 200 items, 512 KB/file) to
  `PUT /api/claws/:id/directories/sync?key=<apiKey>`. The API side can now
  serve the project context to the browser.
- **Heartbeat API endpoint** (`coderClawLink /api/claws/:id/heartbeat` — NEW):
  `PATCH /:id/heartbeat?key=<apiKey>` updates `lastSeenAt`; API-key auth
  without requiring the full JWT flow.

### What now works:

- `connectedAt` is set when the upstream WS connects; cleared on disconnect. UI
  "Waiting for connection..." dot turns green.
- `lastSeenAt` is updated on connect and refreshed every 5 minutes. UI "Last
  seen: never" now shows an actual timestamp.
- Browser→agent chat flows: browser client → `ClawRelayDO` → upstream WS →
  `ClawLinkRelayService.handleRelayMessage` → local `GatewayClient.request("chat.send")`
- Agent→browser streaming flows: local gateway EventFrame → `ClawLinkRelayService.handleGatewayEvent`
  → upstream WS → `ClawRelayDO.broadcast()` → all browser `clientSockets`
- **Session execution timeline visibility**:
  - `executions` now persist `session_id` + `claw_id`
  - Runtime API supports `GET /api/runtime/executions?sessionId=<id>` and
    `GET /api/runtime/sessions/:sessionId/executions`
  - `ClawLinkTransportAdapter` now forwards `sessionId` and configured `clawId`
    when submitting executions, enabling per-session end-to-end traceability

### Still completely missing (original mesh gaps unchanged):

- **Hub-and-spoke only**: `ClawRelayDO` connects ONE claw to N browser clients.
  No claw-to-claw channel. No `forwardToUpstream` across DOs.
- **Local-only subagents**: `spawnSubagentDirect()` spawns in-process agents.
  No `RemoteSubagentAdapter` or equivalent.
- **No fleet discovery**: A claw cannot query which other claws are online or
  their capabilities. `coderclaw_instances` tracks registrations but has no
  capability metadata. `tenantRoutes.ts` already returns a `capabilitySummary`
  field per claw — but `distributed` is hardcoded to `false` and no real
  capability introspection exists.
- **No claw-to-claw routes**: No `/api/claws/:id/forward/:targetId`. No
  concept of routing a task to a specific claw.
- **No distributed task routing**: `ClawLinkTransportAdapter` is still a CRUD
  transport, not a distributed router.

### What's partially there (unchanged from prior audit):

- `ClawLinkTransportAdapter` (295 lines): Full HTTP transport to ClawLink.
  Could be extended for claw-addressed routing if the server supported it.
- `coderclaw_instances` table: Tracks multiple claws per tenant with status
  fields. Could become the fleet registry with capability metadata.
- `RuntimeStatus.mode` type includes `"distributed-cluster"` (never used).

**Impact**: Single-claw browser↔agent chat now works end-to-end. The platform
still cannot distribute work between claws. A "fleet" is still just a list in a
database — they can't collaborate.

**Fix** (remaining): Build claw discovery API, claw-to-claw relay extension to
`ClawRelayDO`, `RemoteSubagentAdapter`, orchestrator mesh mode. Tracked as
**Phase -1.6** (foundation) and **Phase 4** (full orchestration).

---

## Priority Order

| Priority | Gap                           | Status   | Why next                                                                        |
| -------- | ----------------------------- | -------- | ------------------------------------------------------------------------------- |
| ✅ done  | **-1.1** Wire executeWorkflow | RESOLVED | All workflow types execute synchronously via orchestrate tool                    |
| ✅ done  | **-1.2** Wire agent roles     | RESOLVED | Built-in + custom roles loaded and enforced at spawn time                        |
| ✅ done  | **-1.3** Wire session handoff | PARTIAL  | Save/load is wired; automatic save on exit/new still missing                     |
| ✅ done  | **-1.4** Workflow persistence | RESOLVED | Checkpoints + restore + resume after gateway restart                             |
| ✅ done  | **-1.5** Knowledge loop       | PARTIAL  | Activity log + sync + memory query wired; semantic synthesis still missing       |
| 1        | **-1.6b** Claw-to-claw mesh   | PARTIAL  | Browser↔single-claw relay works; claw↔claw delegation still missing             |

Item 1 is the remaining **enabling** gap: distributed work across claws.

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

### C) Claw-to-Claw Delegation (close remaining Gap -1.6b)

**Current**: Hub-and-spoke browser relay is functional; claws cannot delegate work to other claws.

**Required**:

- Add claw discovery with capabilities (online filter + capability metadata source of truth).
- Add claw-addressed forwarding route (source claw → target claw).
- Introduce remote subagent execution adapter and orchestrator routing policy.

**Acceptance criteria**:

- A claw can request another online claw to execute a task and receive streamed results.
- `GET /api/tenants/:id/claws?status=online` returns non-placeholder capability metadata.
- Orchestrator can route at least one workflow step remotely based on policy/capability match.

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
- [ ] **-1.6b**: `GET /api/tenants/:id/claws?status=online` returns online claws
      with capabilities. Orchestrator can dispatch a step to a remote claw.
