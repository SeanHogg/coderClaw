# coderClawLink Feature Gaps

> Repo: https://github.com/SeanHogg/coderClawLink  
> Last updated: 2026-03-04 (revised 2026-03-04 — capability routing implemented)  
> Source: Deep audit of coderClaw ↔ coderClawLink API surface, capability gap analysis,
> and comparison with market-leading agents (Claude Code, Cursor, mini-swe-agent, Devin).

This document is the **canonical requirements handoff** from the coderClaw client to
the coderClawLink backend/portal team. Each item is prioritised, self-contained, and
traceable to a specific coderClaw gap or market capability.

> **Note on P2-3 (Fleet Capability Management)**: The coderClaw orchestrator now supports
> `remote:auto` and `remote:auto[cap1,cap2]` capability-based routing using the existing
> `GET /api/claws/fleet` heartbeat capabilities. The coderClaw-side implementation is
> complete. The SPA management UI for declaring additional capabilities is still a
> coderClawLink-side gap.

---

## Priority Levels

| Level | Meaning                                       |
| ----- | --------------------------------------------- |
| P0    | Blocking a shipped coderClaw feature today    |
| P1    | Required for spec-driven workflow parity      |
| P2    | Improves observability / developer experience |
| P3    | Nice-to-have / future-proofing                |

---

## P0 — Blocking Issues

### P0-1: Remote Task Result Streaming

**Problem**  
`POST /api/claws/:targetId/forward` is fire-and-forget. The coderClaw orchestrator
sends a `remote.task` to a peer claw via `ClawRelayDO` but receives no result.
Any orchestrator workflow step using `remote:<clawId>` always produces `output: ""`
— making multi-claw orchestration non-functional for dependent steps.

**Required Changes to coderClawLink**

1. **New relay frame type** in `ClawRelayDO`:
   ```json
   {
     "type": "remote.result",
     "taskCorrelationId": "<uuid from original remote.task>",
     "fromClawId": "<executor claw id>",
     "result": "<task output string>",
     "status": "completed" | "failed",
     "error": "<optional error message>"
   }
   ```
2. `POST /api/claws/:targetId/forward` must accept and return a `correlationId`:
   ```json
   // Request body addition
   { "correlationId": "<uuid>" }
   // Response addition
   { "ok": true, "delivered": true, "correlationId": "<uuid>" }
   ```
3. Target claw (executor) must send `remote.result` frame back to the relay after
   local execution completes.
4. Originating claw's `ClawLinkRelayService` must handle incoming `remote.result`
   frames and resolve the pending `dispatchToRemoteClaw()` promise.

**coderClaw side** (`src/infra/remote-subagent.ts`):  
Awaits a `remote.result` frame on the upstream WS with matching `correlationId`
(timeout configurable, default 10 min).

**Acceptance**: orchestrator step `{ role: "remote:<id>", task: "…" }` completes
with non-empty `output`; dependent steps receive it as `input`.

---

### P0-2: Execution WebSocket Streaming (replace polling)

**Problem**  
`GET /api/runtime/executions/:id` is polled every 2 seconds by
`src/transport/clawlink-adapter.ts`. This creates unnecessary load and adds up to
2 s of latency to every execution result.

**Required Changes to coderClawLink**

1. **WebSocket upgrade** on `GET /api/runtime/executions/:id`:
   - Client upgrades the connection; server streams `ExecutionEvent` frames:
     ```json
     { "type": "status_change", "status": "running" | "completed" | "failed" }
     { "type": "output_delta", "delta": "<text chunk>" }
     { "type": "done", "execution": { ...full execution object... } }
     ```
2. **Fallback**: keep existing polling endpoint for clients that cannot upgrade.

**coderClaw side** (`src/transport/clawlink-adapter.ts`):  
Code comment already flags this: _"CoderClawLink currently exposes polling;
WebSocket streaming is on its roadmap."_

---

## P1 — Spec-Driven Workflow Portal

### P1-1: Spec / Planning Storage API

**Problem**  
The `/spec <goal>` TUI command triggers a planning workflow that saves outputs to
`.coderClaw/planning/` locally. These files are eventually synced to coderClawLink
via the directory-sync endpoint, but they are stored as raw blobs with no structured
schema. There is no way to:

- Query specs by goal / project
- Track spec status (draft → reviewed → approved → implemented)
- Link a spec to workflow executions

**Required Changes to coderClawLink**

1. **New table**: `specs`

   ```sql
   id           uuid PRIMARY KEY
   tenant_id    int NOT NULL REFERENCES tenants
   project_id   uuid REFERENCES projects
   claw_id      int REFERENCES claws
   goal         text NOT NULL
   status       enum('draft','reviewed','approved','in_progress','done') DEFAULT 'draft'
   prd          text                   -- Product Requirements Document
   arch_spec    text                   -- Architecture specification
   task_list    jsonb                  -- Ordered task breakdown
   created_at   timestamptz DEFAULT now()
   updated_at   timestamptz DEFAULT now()
   ```

2. **New endpoints**:

   ```
   POST   /api/specs                    Create spec (from /spec command result)
   GET    /api/specs                    List specs for tenant/project
   GET    /api/specs/:id                Get spec detail
   PATCH  /api/specs/:id               Update status / content
   DELETE /api/specs/:id               Archive spec
   GET    /api/specs/:id/workflows      List workflows linked to a spec
   POST   /api/specs/:id/workflows      Link an existing workflow to a spec
   ```

3. **Auth**: claw API key (same as directory-sync) so the coderClaw gateway can
   push spec results automatically after a `/spec` workflow completes.

**coderClaw side**: After `orchestrate` workflow `"planning"` completes, POST the
three outputs (PRD, arch spec, task list) to `/api/specs`.

---

### P1-2: Workflow Execution Portal

**Problem**  
Workflows run locally and are only visible via `.coderClaw/sessions/workflow-*.yaml`
files and the TUI `/workflow` command. There is no web UI showing workflow history,
task breakdown, timings, or outputs.

**Required Changes to coderClawLink**

1. **New table**: `workflows`

   ```sql
   id           uuid PRIMARY KEY
   tenant_id    int NOT NULL
   claw_id      int NOT NULL
   spec_id      uuid REFERENCES specs
   workflow_type enum('feature','bugfix','refactor','planning','adversarial','custom')
   status       enum('pending','running','completed','failed','cancelled')
   description  text
   created_at   timestamptz
   completed_at timestamptz
   ```

2. **New table**: `workflow_tasks`

   ```sql
   id           uuid PRIMARY KEY
   workflow_id  uuid NOT NULL REFERENCES workflows
   agent_role   text NOT NULL
   description  text NOT NULL
   status       enum('pending','running','completed','failed','cancelled')
   input        text
   output       text
   error        text
   started_at   timestamptz
   completed_at timestamptz
   depends_on   uuid[]
   ```

3. **New endpoints**:

   ```
   POST   /api/workflows                 Register a workflow (push from claw on create)
   GET    /api/workflows                 List workflows (filterable by status, type, claw)
   GET    /api/workflows/:id             Get workflow detail + tasks
   PATCH  /api/workflows/:id             Update status / task states
   GET    /api/workflows/:id/tasks       List tasks for workflow
   PATCH  /api/workflows/:id/tasks/:tid  Update individual task state
   ```

4. **Relay frame** for live updates:
   ```json
   { "type": "workflow.update", "workflowId": "…", "status": "…", "taskId": "…" }
   ```

**coderClaw side** (`src/coderclaw/orchestrator.ts`): Push workflow state changes to
coderClawLink so the portal shows live progress.

---

### P1-3: Spec Review Portal (SPA)

**Problem**  
The coderClawLink SPA has no page for viewing, reviewing, or approving specs. Product
owners cannot interact with agent-generated specs without accessing raw YAML files.

**Required Changes to coderClawLink SPA**

1. **Specs list page** (`/specs`): table of specs with goal, project, status, date.
2. **Spec detail page** (`/specs/:id`):
   - Tabbed view: PRD | Architecture | Task List
   - Inline status controls: Draft → Reviewed → Approved
   - "Start Implementation" button → creates a `feature` workflow linked to spec.
3. **Workflow detail page** (`/workflows/:id`):
   - Task DAG visualisation (dependency graph)
   - Real-time status updates via WS relay
   - Per-task output expandable panels
4. **Spec ↔ Workflow linking**: breadcrumb from workflow back to originating spec.

---

## P2 — Observability & Developer Experience

### P2-1: Knowledge / Memory Query API

**Problem**  
`.coderClaw/memory/` files are synced to coderClawLink via directory-sync but are
stored as raw text blobs. There is no structured endpoint to search, filter, or render
them. Agents currently query memory only locally via `project_knowledge memory`.

**Required Changes to coderClawLink**

1. **Memory indexing job**: after directory-sync, parse `memory/YYYY-MM-DD.md` files
   and extract structured entries (timestamp, session key, created/edited/tools, summary).

2. **New endpoints**:

   ```
   GET  /api/memory?clawId=&from=&to=&q=   Full-text search memory entries
   GET  /api/memory/stats                  Aggregate activity stats (files touched, tools used)
   ```

3. **SPA**: Memory timeline page showing agent activity history with semantic summaries.

---

### P2-2: Context Window & Token Usage Dashboard

**Problem**  
Token usage per session is visible only in the TUI status footer. There is no
historical view of token spend, context pressure, or compaction events.

**Required Changes to coderClawLink**

1. **New relay frame** from upstream WS:
   ```json
   {
     "type": "usage.snapshot",
     "sessionKey": "…",
     "inputTokens": 12000,
     "outputTokens": 3400,
     "contextTokens": 87000,
     "contextWindowMax": 200000,
     "compactionCount": 2,
     "ts": "2026-03-04T…"
   }
   ```
2. **Persist** `usage_snapshots` table (claw_id, session_key, ts, tokens…).
3. **SPA dashboard**: context pressure gauge, token spend over time, compaction event markers.

---

### P2-3: Fleet Capability Management

**Problem**  
Heartbeat capabilities are stored in the DB but the SPA has no UI to view or configure
them. Fleet routing (`remote:auto`) needs a way to declare required capabilities per claw.

**Required Changes to coderClawLink**

1. **Extend claws table**: `declared_capabilities jsonb` (user-configured, in addition to
   the runtime `capabilities` from heartbeat).
2. **SPA fleet page**: show per-claw: online status, last seen, reported capabilities,
   declared capabilities, active workflows.
3. **Capability routing endpoint**:
   ```
   GET /api/claws/fleet/route?requires=gpu,high-memory
   → { clawId: "…", name: "…", score: 0.95 }
   ```

---

### P2-4: Agent Run Audit Trail

**Problem**  
There is no immutable, queryable log of which agent called which tool with what arguments
and results. This makes debugging multi-agent orchestration extremely difficult.

**Required Changes to coderClawLink**

1. **New relay frame** from upstream WS:
   ```json
   {
     "type": "tool.audit",
     "runId": "…",
     "sessionKey": "…",
     "toolCallId": "…",
     "toolName": "bash",
     "args": { "command": "npm test" },
     "result": "…",
     "durationMs": 1234,
     "ts": "…"
   }
   ```
2. **`tool_audit_events` table**: immutable append-only log.
3. **SPA run viewer**: timeline of tool calls for a specific run with args/results
   expandable inline.

---

## P3 — Future Capabilities

### P3-1: Cross-Claw Memory Sharing API

**Problem**  
Memory sharing between claws is opt-in via local config but has no backend enforcement,
deduplication, or conflict resolution.

**Required**:

- `/api/memory/share` endpoint for claw-to-claw memory sync with tenant-scoped access control.
- Deduplication by content hash.
- Privacy filter: entries tagged `#private` in the source never shared.

---

### P3-2: Model Cost Tracking

**Required**:

- Per-session model cost estimate (token count × model pricing).
- Monthly budget alerts.
- Per-project cost breakdown.

---

### P3-3: Approval Workflow API

**Required**:

- When an agent wants to perform a destructive action (rm, force-push, deploy), it can
  request human approval via coderClawLink.
- `POST /api/approvals` creates a pending approval.
- `PATCH /api/approvals/:id` accepts/rejects.
- Relay frame `{ type: "approval.request" }` triggers browser notification.
- coderClaw waits on approval before executing the tool.

---

### P3-4: Spec Import (GitHub Issues / Linear / Jira)

**Required**:

- OAuth connections to issue trackers.
- "Import as spec" converts a GitHub Issue / Linear ticket into a coderClawLink spec.
- `/spec import <url>` TUI command triggers the import and starts planning.

---

## Summary Table

| ID   | Priority | Feature                           | Backend | SPA | coderClaw         |
| ---- | -------- | --------------------------------- | ------- | --- | ----------------- |
| P0-1 | P0       | Remote task result streaming      | ✅ New  | —   | ✅ Update         |
| P0-2 | P0       | Execution WS streaming            | ✅ New  | —   | ✅ Update         |
| P1-1 | P1       | Spec / planning storage API       | ✅ New  | —   | ✅ Update         |
| P1-2 | P1       | Workflow execution portal API     | ✅ New  | —   | ✅ Update         |
| P1-3 | P1       | Spec review + workflow portal SPA | —       | ✅  | —                 |
| P2-1 | P2       | Knowledge / memory query API      | ✅ New  | ✅  | —                 |
| P2-2 | P2       | Token usage dashboard             | ✅ New  | ✅  | ✅ Update         |
| P2-3 | P2       | Fleet capability management       | ✅ New  | ✅  | ✅ Done (routing) |
| P2-4 | P2       | Agent run audit trail             | ✅ New  | ✅  | ✅ Update         |
| P3-1 | P3       | Cross-claw memory sharing API     | ✅ New  | —   | —                 |
| P3-2 | P3       | Model cost tracking               | ✅ New  | ✅  | —                 |
| P3-3 | P3       | Approval workflow API             | ✅ New  | ✅  | ✅ Update         |
| P3-4 | P3       | Spec import (GitHub/Linear/Jira)  | ✅ New  | ✅  | ✅ Update         |

> **P2-3 coderClaw status**: `remote:auto` and `remote:auto[cap1,cap2]` capability routing
> implemented in `src/coderclaw/orchestrator.ts` and `src/infra/remote-subagent.ts`.
> The SPA fleet management UI (declared capabilities, fleet routing endpoint) is the
> remaining coderClawLink-side work.

---

## Existing API Surface (for reference)

All endpoints currently implemented and called by coderClaw:

| Method | Endpoint                             | Auth         | Purpose                   |
| ------ | ------------------------------------ | ------------ | ------------------------- |
| POST   | `/api/auth/web/register`             | None         | Create account            |
| POST   | `/api/auth/web/login`                | None         | Login                     |
| GET    | `/api/auth/my-tenants`               | JWT (web)    | List user workspaces      |
| POST   | `/api/auth/tenant-token`             | JWT (web)    | Get workspace token       |
| POST   | `/api/tenants/create`                | JWT (web)    | Create workspace          |
| POST   | `/api/claws`                         | JWT (tenant) | Register claw instance    |
| GET    | `/api/claws/fleet`                   | API Key      | List peer claws           |
| WS     | `/api/claws/:id/upstream`            | API Key      | Bidirectional relay       |
| PATCH  | `/api/claws/:id/heartbeat`           | API Key      | Keep-alive + capabilities |
| POST   | `/api/claws/:id/forward`             | API Key      | Remote task dispatch      |
| POST   | `/api/projects/upsert`               | JWT (tenant) | Create/update project     |
| PUT    | `/api/claws/:id/projects/:pid`       | JWT (tenant) | Link project to claw      |
| PUT    | `/api/claws/:id/directories/sync`    | API Key      | Upload .coderClaw/ files  |
| POST   | `/api/runtime/executions`            | Bearer       | Submit execution          |
| GET    | `/api/runtime/executions/:id`        | Bearer       | Poll execution status     |
| POST   | `/api/runtime/executions/:id/cancel` | Bearer       | Cancel execution          |
| GET    | `/api/agents`                        | Bearer       | List agents               |
| GET    | `/api/skills`                        | Bearer       | List skills               |
