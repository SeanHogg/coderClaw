# CoderClaw Capability Gaps — Deep Audit

> Last updated: 2026-03-01
> Source: Code audit of `coderClaw/src/` and `coderClawLink/api/src/`

This document records what **actually works** vs. what is **facade code** (exists
but is never called) vs. what is **completely missing**. Every item here blocks
the self-improvement initiative where coderClaw builds itself using its own
agent features.

---

## Gap 1: Orchestrate Tool Creates But Never Executes Workflows

**Status**: ✅ PARTIALLY RESOLVED — orchestrate now executes workflows synchronously; workflow-type expansion still pending

**Evidence**:

- `src/coderclaw/tools/orchestrate-tool.ts` now creates then immediately executes:
  - `const wf = globalOrchestrator.createWorkflow(steps);`
  - `await globalOrchestrator.executeWorkflow(wf.id, context);`
- The tool now returns completion/failure JSON with task results, rather than claiming asynchronous execution.
- `src/coderclaw/orchestrator.ts` executes dependency-aware tasks and marks workflow status (`running` → `completed`/`failed`).
- `src/coderclaw/orchestrator.test.ts` covers dependency resolution and runnable-task behavior.

**Impact**: Feature/bugfix/refactor/custom workflows now execute. Remaining gap is workflow-type coverage (`planning`, `adversarial`) and production-grade execution semantics.

**Remaining work**:

- Add `planning` and `adversarial` workflow types (currently only `feature`, `bugfix`, `refactor`, `custom`).
- Add persistence/resume (tracked separately as Gap 4).
- Add stronger end-to-end tests around real subagent completion paths.

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

**Remaining work**: None for Gap 2. The multi-agent system now has role-specific behavior, and custom roles are fully supported.

**Verification snapshot (2026-02-28):**

- `pnpm exec vitest --run src/coderclaw/agent-roles.test.ts src/coderclaw/orchestrator.test.ts` → 8/8 pass
- `pnpm exec vitest run --config vitest.e2e.config.ts src/agents/coderclaw-tools.subagents.sessions-spawn.allowlist.e2e.test.ts src/agents/coderclaw-tools.subagents.sessions-spawn.model.e2e.test.ts` → 14/14 pass

---

## Gap 3: Session Handoff Is Dead Code

**Status**: FACADE — fully implemented, zero callers

**Evidence**:

- `project-context.ts` lines 291-349: `saveSessionHandoff()`,
  `loadLatestSessionHandoff()`, `listSessionHandoffs()` — complete
  implementations with YAML serialization, sorted file listing, error handling.
- `SessionHandoff` type in `types.ts` lines 191-211: well-defined with
  `sessionId`, `timestamp`, `summary`, `decisions`, `nextSteps`,
  `openQuestions`, `artifacts`, `context`.
- `grep -r "saveSessionHandoff\|loadLatestSessionHandoff" --include="*.ts"`
  returns ONLY `project-context.ts` itself. **Zero imports. Zero callers.**
- No agent session startup code loads prior handoffs.
- No session teardown code saves handoffs.

**Impact**: Sessions have zero continuity. Every new session starts from
scratch. An agent cannot "resume from where we left off." Multi-session
roadmap work requires the human to manually re-explain context each time.

**Fix**: Save handoff on session end, load on session start, expose `/handoff`
TUI command. Tracked as **Phase -1.3**.

---

## Gap 4: Workflow State Is Ephemeral

**Status**: MISSING — no persistence at all

**Evidence**:

- `orchestrator.ts`: `private workflows = new Map<string, Workflow>()`
- Process restart = total state loss. No disk writes, no checkpoints.
- No `resumeWorkflow()` function exists.

**Impact**: Long-running workflows (multi-step feature implementation) cannot
survive TUI restart, network disconnection, or even an accidental Ctrl+C.

**Fix**: Serialize workflow state to `.coderClaw/sessions/workflow-{id}.yaml`
after each step. Add resume logic. Tracked as **Phase -1.4**.

---

## Gap 5: No Post-Task Knowledge Update

**Status**: MISSING — no automatic knowledge loop

**Evidence**:

- `.coderClaw/` is populated once by `coderclaw init` (interactive wizard).
- `architecture.md` is a skeleton created at init time, never refreshed.
- `.coderClaw/memory/` directory is created but **never indexed** by the
  memory system — only workspace-root `memory/` and `MEMORY.md` are watched
  by `manager-sync-ops.ts`.
- The **memory flush** hook (`memory-flush.ts`) fires pre-compaction only —
  it writes to workspace-root `memory/YYYY-MM-DD.md`, not `.coderClaw/memory/`.
- `updateProjectContextFields()` exists but is only called during the
  interactive setup wizard, never after task completion.
- No post-task hook in the agent lifecycle.

**Impact**: coderClaw cannot learn from its own work. After implementing a
feature, the project context doesn't reflect the new modules. After discovering
a bug pattern, no rule is added. The knowledge base is write-once, never
updated.

**Fix**: Add post-task hook, bridge `.coderClaw/memory/` to indexing, add
`/knowledge update` command. Tracked as **Phase -1.5**.

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

### Still completely missing (original mesh gaps unchanged):

- **Hub-and-spoke only**: `ClawRelayDO` connects ONE claw to N browser clients.
  No claw-to-claw channel. No `forwardToUpstream` across DOs.
- **Local-only subagents**: `spawnSubagentDirect()` spawns in-process agents.
  No `RemoteSubagentAdapter` or equivalent.
- **No fleet discovery**: A claw cannot query which other claws are online or
  their capabilities. `coderclaw_instances` tracks registrations but has no
  capability metadata or online-status query API.
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

| Priority | Gap                           | Why first                                            |
| -------- | ----------------------------- | ---------------------------------------------------- |
| 1        | **-1.1** Wire executeWorkflow | Nothing works without this — it's the core engine    |
| 2        | **-1.2** Wire agent roles     | Workflows need role-specific behavior to be useful   |
| 3        | **-1.3** Wire session handoff | Multi-session work needs continuity                  |
| 4        | **-1.5** Knowledge loop       | Agents need updated context to work effectively      |
| 5        | **-1.4** Workflow persistence | Nice-to-have once workflows actually run             |
| 6        | **-1.6b** Claw-to-claw mesh   | Relay works (single-claw chat ✅); claw→claw still missing |

Items 1-4 are **blocking**: coderClaw literally cannot self-improve without them.
Items 5-6 are **enabling**: they improve reliability and scale but aren't required
for the single-claw self-bootstrapping loop.

---

## Verification Checklist

After each gap is fixed, verify:

- [ ] **-1.1**: `> orchestrate feature "add a hello world function"` → subagents
      spawn, code is created, tested, and reviewed. Workflow reaches `completed`.
- [ ] **-1.2**: Spawned subagents use role-specific system prompts and tool sets.
      `code-reviewer` cannot use `create` tool. `refactor-agent` has explicit
      constraint about public APIs.
- [ ] **-1.3**: Start session → do work → exit. Start new session → see
      "Resuming from: [summary]" → prior decisions and next steps in context.
- [ ] **-1.4**: Start workflow → kill process mid-step → restart → see
      "Incomplete workflow found. Resume? [Y/n]" → continues from last checkpoint.
- [ ] **-1.5**: Complete a task that adds a new module → `architecture.md` is
      updated → next agent session sees the new module in its context.
- [x] **-1.6a** (2026-03-01): coderClaw connects to ClawRelayDO upstream WS on
      gateway start. `connectedAt` and `lastSeenAt` update correctly. Browser
      chat reaches local agent; agent responses stream back to browser.
- [ ] **-1.6b**: `GET /api/tenants/:id/claws?status=online` returns online claws
      with capabilities. Orchestrator can dispatch a step to a remote claw.
