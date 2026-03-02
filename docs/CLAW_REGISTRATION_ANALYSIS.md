# Claw Registration — End-to-End Analysis

> Deep-dive across **coderClaw** and **coderClawLink** covering registration,
> connection, relay protocol, gaps blocking ROADMAP Phases 2 & 4, and the
> proposed **coderclawLLM** routing API.

---

## 1. Is Registration Implemented in Both Projects?

| Concern                        | coderClawLink (server)                                                               | coderClaw (client)                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| **Claw CRUD API**              | ✅ Full — `POST /api/claws`, `GET /api/claws`, `DELETE /api/claws/:id`               | N/A (consumer only)                                                                        |
| **Registration wizard**        | N/A (receives requests)                                                              | ✅ Full — interactive TUI wizard in `coderclaw init` (`promptClawLink`)                    |
| **API key generation**         | ✅ Server generates random key, hashes (bcrypt), stores hash, returns plaintext once | ✅ Client stores plaintext in `~/.coderclaw/.env` as `CODERCLAW_LINK_API_KEY`              |
| **WebSocket relay (upstream)** | ✅ `GET /api/claws/:id/upstream?key=` — Durable Object relay via `ClawRelayDO`       | ✅ Implemented via `ClawLinkRelayService` (persistent upstream WS + reconnect + heartbeat) |
| **WebSocket relay (browser)**  | ✅ `GET /api/claws/:id/ws?token=` — browser client connects via `ClawGateway` class  | N/A (this is the SPA side)                                                                 |
| **Task execution transport**   | ✅ Runtime routes at `POST /api/runtime/executions`                                  | ✅ `ClawLinkTransportAdapter` calls `/api/runtime/*` over HTTP                             |
| **Connection tracking**        | ✅ `connectedAt`/`lastSeenAt` columns on `coderclaw_instances`                       | Reads status indirectly via stored env vars                                                |

**Verdict**: Registration and relay connectivity are **fully wired end-to-end**,
and session-level execution history is now queryable. Remaining gaps are now
around claw domain modeling and claw-scoped skill resolution.

---

## 2. End-to-End Registration Flow

### Step-by-step: `coderclaw init`

```
┌───────────────────────────────────────────────────────────────┐
│   User runs:  coderclaw init                                  │
│   (TUI wizard — src/commands/coderclaw.ts, line ~700)         │
└───────────────────────────────┬───────────────────────────────┘
                                │
         ┌──────────────────────▼──────────────────────────┐
   1     │ Check if already connected                       │
         │   Reads CODERCLAW_LINK_API_KEY from              │
         │   ~/.coderclaw/.env                              │
         │   → if present, shows "Already connected" note   │
         └──────────────────────┬──────────────────────────┘
                                │ (not connected)
         ┌──────────────────────▼──────────────────────────┐
   2     │ Prompt: "Connect to coderClawLink?"              │
         │   → No  ⇒ writes CODERCLAW_LINK_SKIPPED=1       │
         │   → Yes ⇒ continue                              │
         └──────────────────────┬──────────────────────────┘
                                │
         ┌──────────────────────▼──────────────────────────┐
   3     │ Prompt: Server URL                               │
         │   Default: https://api.coderclaw.ai              │
         └──────────────────────┬──────────────────────────┘
                                │
         ┌──────────────────────▼──────────────────────────┐
   4     │ Prompt: Login or Register                        │
         │   → Login:    POST /api/auth/web/login           │
         │   → Register: POST /api/auth/web/register        │
         │   Result: webToken (JWT)                         │
         └──────────────────────┬──────────────────────────┘
                                │
         ┌──────────────────────▼──────────────────────────┐
   5     │ Pick or create tenant                            │
         │   GET  /api/auth/my-tenants  (Bearer: webToken)  │
         │   → 0 tenants: POST /api/tenants/create          │
         │   → 1 tenant:  auto-select                       │
         │   → N tenants: pick from list                    │
         │   Result: tenantId                               │
         └──────────────────────┬──────────────────────────┘
                                │
         ┌──────────────────────▼──────────────────────────┐
   6     │ Get tenant-scoped JWT                            │
         │   POST /api/auth/tenant-token                    │
         │     body: { tenantId }                           │
         │   Result: tenantJwt                              │
         └──────────────────────┬──────────────────────────┘
                                │
         ┌──────────────────────▼──────────────────────────┐
   7     │ Register claw instance                           │
         │   POST /api/claws                                │
         │     Authorization: Bearer <tenantJwt>            │
         │     body: { name: "my-claw" }                    │
         │                                                  │
         │   Server:                                        │
         │     • generates random API key                   │
         │     • hashes it (bcrypt)                         │
         │     • inserts into coderclaw_instances table      │
         │     • returns { claw: { id, name, slug }, apiKey }│
         └──────────────────────┬──────────────────────────┘
                                │
         ┌──────────────────────▼──────────────────────────┐
   8     │ Persist credentials                              │
         │   ~/.coderclaw/.env:                             │
         │     CODERCLAW_LINK_URL=https://api.coderclaw.ai  │
         │     CODERCLAW_LINK_WEB_TOKEN=<jwt>               │
         │     CODERCLAW_LINK_TENANT_ID=<int>               │
         │     CODERCLAW_LINK_API_KEY=<plaintext key>       │
         │                                                  │
         │   .coderClaw/context.yaml  (project-level):      │
         │     clawLink:                                    │
         │       instanceId: "42"                           │
         │       instanceSlug: "my-claw"                    │
         │       instanceName: "my-claw"                    │
         │       tenantId: 7                                │
         │       url: "https://api.coderclaw.ai"            │
         └──────────────────────┘
```

### What Happens After Registration

#### Path A — Task delegation (HTTP transport, WORKS today)

```
coderClaw                        coderClawLink
   │                                   │
   │  ClawLinkTransportAdapter         │
   │  ─────────────────────────        │
  │  submitTask({ metadata.taskId })  │
  │  ──POST /api/runtime/executions──▶│  queues execution
  │  ◀──{ id, status: pending }──────│
   │                                   │
  │  streamTaskUpdates(executionId)   │
  │  ──GET /api/runtime/executions/:id▶│  (polling loop)
  │  ◀──{ status: running }──────────│
  │  ◀──{ status: completed }────────│
```

#### Path B — Real-time relay (WebSocket, WORKS today)

```
coderClaw                  ClawRelayDO              Browser (SPA)
   │                           │                        │
   │  wss://…/claws/:id/      │                        │
   │  upstream?key=<apiKey>    │                        │
   │ ─────────────────────────▶│  attachUpstream()      │
   │                           │◀────────────────────── │  wss://…/claws/:id/ws?token=
   │                           │  attachClient()        │
   │                           │                        │
   │ ──{ gateway message }────▶│ ── broadcast() ──────▶ │
   │                           │                        │
   │ ◀── forward upstream ────│◀──{ user message }──── │
```

---

## 3. Can Users See All Claws in a Tenant?

**Yes.**

- **API**: `GET /api/claws` (authenticated with tenant JWT) returns ALL claws for the caller's tenant — no per-user filtering.  
  Response shape: `[{ id, name, slug, status, registeredBy, lastSeenAt, createdAt }]`

- **SPA**: The `<ccl-claws>` view calls `clawsApi.list()` → `GET /api/claws` and renders a table showing:
  - Connected dot (green = `connectedAt` not null, gray = offline)
  - Name, Slug, Status badge (active/suspended/inactive), Last seen
  - Open (slide-out panel with 10 tabs: Chat, Agents, Config, Sessions, Skills, Usage, Cron, Nodes, Channels, Logs)
  - Delete (with confirmation modal)
  - "Register claw" button → modal (name input → POST → shows one-time API key)

- **RBAC**: Role checks happen at the route level (`authMiddleware`), but claw listing is tenant-scoped, not user-scoped. Any authenticated user in the tenant sees every claw.

---

## 4. Architectural Gap Analysis

### GAP 1: Agents ≠ Claws (Critical for Phase 2 & 4)

The schema has **two separate, unlinked entity systems**:

| Entity     | Table                 | Purpose                                                                              |
| ---------- | --------------------- | ------------------------------------------------------------------------------------ |
| **Claws**  | `coderclaw_instances` | Physical coderClaw installations (identified by API key, relay connection)           |
| **Agents** | `agents`              | Abstract LLM agent registrations (type: claude/openai/ollama/http, endpoint, apiKey) |

**Status**: ✅ PARTIALLY RESOLVED.

`executions` now persist optional `clawId` and `sessionId`, and runtime routes
support session-scoped history queries:

- `GET /api/runtime/executions?sessionId=<id>`
- `GET /api/runtime/sessions/:sessionId/executions`

Remaining part of this gap: deeper claw/agent capability binding and routing
policy still rely on route logic rather than a dedicated domain model.

### GAP 2: Upstream WebSocket Client in coderClaw

**Status**: ✅ RESOLVED.

`ClawLinkRelayService` now opens and maintains the upstream relay WebSocket,
bridges gateway chat events bidirectionally, auto-reconnects with exponential
backoff, and sends periodic heartbeat updates.

### GAP 3: ClawLink Transport Adapter Endpoint Alignment

**Status**: ✅ RESOLVED.

`ClawLinkTransportAdapter` now targets the implemented runtime contract:

- `POST /api/runtime/executions`
- `GET /api/runtime/executions/:id`
- `POST /api/runtime/executions/:id/cancel`

and discovery routes:

- `GET /api/agents`
- `GET /api/skills`

The adapter now supports authenticated calls via optional `authToken` in
`ClawLinkConfig`.

### GAP 4: No Claw Domain Entity in coderClawLink

`coderClawLink/api/src/domain/` has: agent, audit, execution, project, shared, skill, task, tenant, user — but **no `claw/` domain**. The claw registration routes directly query the DB with raw Drizzle calls instead of going through proper domain entities and repository abstractions.

**Impact**: Business rules for claw lifecycle (suspension, limits, audit trails) are ad-hoc in the route handlers. Phase 2 approval workflows need a proper claw domain entity.

### GAP 5: Skill Assignment Disconnection

The schema defines both:

- `tenant_skill_assignments` — all claws in a tenant inherit these
- `claw_skill_assignments` — per-claw overrides

But the coderClaw side has **no mechanism to query its own effective skill assignments** from coderClawLink. While discovery now uses `GET /api/skills`, this is tenant-global and not claw-scoped effective policy.

### GAP 6: Session execution visibility

**Status**: ✅ RESOLVED.

Execution records now carry `sessionId`, and the runtime API exposes full
session execution timelines so operators can inspect complete run history for a
single session without manual correlation.

---

## 5. Summary of What Works vs. What's Missing

```
✅ WORKS TODAY
  ├── Registration wizard (coderClaw init → POST /api/claws)
  ├── API key generation + hashing + storage
  ├── Credential persistence (global ~/.coderclaw/.env + project context.yaml)
  ├── SPA claw management (list, register, delete, status badges)
  ├── Durable Object relay infrastructure (ClawRelayDO)
  ├── Browser WebSocket client (ClawGateway) → relay → claw
  ├── Transport adapter concept (ClawLinkTransportAdapter)
  ├── Connection tracking (connectedAt/lastSeenAt DB columns)
  └── Tenant-scoped visibility (all users see all claws)

❌ MISSING / BROKEN
  ├── Claw domain entity in coderClawLink (routes use raw DB queries)
  └── Effective claw-scoped skill sync (claw can't query merged tenant+claw assignments)
```

---

## 6. coderclawLLM API Concept (OpenRouter-style)

### Vision

An LLM routing API that **coderClaw instances call instead of directly calling
provider APIs**. Like OpenRouter, but private to the coderClawLink mesh.

```
┌────────────┐       ┌──────────────────┐       ┌──────────────────┐
│  coderClaw  │──────▶│   coderclawLLM   │──────▶│  LLM Providers   │
│  instance   │ HTTP  │  (routing proxy)  │ HTTP  │  • Anthropic     │
│             │◀──────│                  │◀──────│  • OpenAI        │
└────────────┘       │  Tenant-scoped   │       │  • Ollama (local)│
                     │  Rate-limited    │       │  • llama.cpp     │
                     │  Budget-tracked  │       │  • Google        │
                     │  Approval-gated  │       │  • Mistral       │
                     └──────────────────┘       └──────────────────┘
```

### API Surface

**Base URL**: `https://llm.coderclaw.ai` (or `https://api.coderclaw.ai/v1`)

The API is **OpenAI-compatible** so coderClaw can use it as a drop-in provider.

```
POST   /v1/chat/completions          – standard chat completion (streaming supported)
POST   /v1/completions               – legacy completion
GET    /v1/models                    – list available models for this tenant
POST   /v1/embeddings                – embedding generation

# coderclawLLM-specific extensions
GET    /v1/routing/policies           – tenant routing rules
PUT    /v1/routing/policies           – update routing rules
GET    /v1/usage                     – usage/cost breakdown by model, claw, agent
GET    /v1/budget                    – remaining budget for tenant/claw
POST   /v1/approval/request          – request HITL approval for expensive operation
GET    /v1/approval/:id              – poll approval status
```

### Authentication

```
Authorization: Bearer <CODERCLAW_LINK_API_KEY>
X-Claw-Id: <instanceId>
X-Tenant-Id: <tenantId>
```

Using the **same API key** the claw already has from registration. No new credentials needed.

### Routing Engine

```typescript
type RoutingPolicy = {
  /** Tenant-level default provider */
  defaultProvider: "anthropic" | "openai" | "ollama" | "llamacpp" | "google" | "mistral";

  /** Model aliasing: coderClaw requests "fast" → router resolves to actual model */
  aliases: Record<string, { provider: string; model: string }>;

  /** Priority chain for failover */
  fallbackChain: Array<{ provider: string; model: string }>;

  /** Cost controls */
  budget: {
    /** Monthly budget in USD */
    monthlyLimitUsd: number;
    /** Per-request cost ceiling — requests exceeding this require approval */
    approvalThresholdUsd: number;
    /** Alert threshold (% of monthly budget) */
    alertAtPercent: number;
  };

  /** Local-first: prefer local models when capable */
  localFirst: boolean;

  /** Rate limiting per claw */
  rateLimits: {
    requestsPerMinute: number;
    tokensPerMinute: number;
  };
};
```

### Routing Flow

```
1.  coderClaw sends:  POST /v1/chat/completions
      model: "claude-sonnet-4-20250514"  (or alias like "fast" / "smart" / "local")
      messages: [...]

2.  coderclawLLM resolves model:
      → Check aliases table  (e.g. "fast" → gpt-4o-mini)
      → Check localFirst     (if Ollama/llama.cpp claw is online, prefer it)
      → Check budget          (if over limit → 402 or → approval request)
      → Check rate limits     (if over → 429)

3.  coderclawLLM forwards to provider:
      → If approval required (cost > threshold):
          POST /v1/approval/request → returns { approvalId, status: "pending" }
          coderClaw polls GET /v1/approval/:id
          Manager approves in SPA → status: "approved"
          coderclawLLM proceeds with the actual LLM call

      → If approved or no approval needed:
          Forward to provider API (Anthropic, OpenAI, etc.)
          Stream response back to coderClaw
          Log: tokens, cost, latency, model, clawId, tenantId

4.  Emit OpenTelemetry span:
      service.name: "coderclawLLM"
      llm.model, llm.provider, llm.tokens.input, llm.tokens.output
      llm.cost_usd, tenant.id, claw.id
```

### How This Enables Phase 2 (Approval Workflows)

The LLM proxy is the natural **chokepoint** for approval. Instead of
modifying every agent in coderClaw, the proxy intercepts expensive requests:

```
coderClaw agent                 coderclawLLM                  SPA Dashboard
    │                               │                              │
    │ POST /v1/chat/completions     │                              │
    │ (estimated: $0.50)            │                              │
    │ ─────────────────────────────▶│                              │
    │                               │ cost > $0.10 threshold       │
    │                               │ → create approval            │
    │ ◀── 202 { approvalId } ──────│                              │
    │                               │ ── push notification ──────▶ │
    │ GET /v1/approval/:id          │                              │
    │ ─────────────────────────────▶│                              │
    │ ◀── { status: "pending" } ───│          Manager sees:        │
    │                               │          "Claw my-claw wants │
    │                               │           to run claude-opus │
    │                               │           est. $0.50"        │
    │                               │                              │
    │                               │ ◀── PATCH approve ────────── │
    │ GET /v1/approval/:id          │                              │
    │ ─────────────────────────────▶│                              │
    │ ◀── { status: "approved" } ──│                              │
    │                               │                              │
    │ POST /v1/chat/completions     │                              │
    │ (retry with approvalId)       │                              │
    │ ─────────────────────────────▶│ → forward to Anthropic       │
    │ ◀── streaming response ──────│                              │
```

### How This Enables Phase 4 (Orchestration)

`coderclawLLM` becomes the **model registry** that orchestration depends on:

- The orchestrator knows which models are available (via `GET /v1/models`)
- Task routing can consider cost (cheap tasks → `gpt-4o-mini`, complex → `claude-opus`)
- Local LLM agents (`llama.cpp` / `ollama`) register as models in the same pool
- Budget allocation per workflow becomes natural (each workflow has a budget, the proxy enforces it)

### Implementation Plan

| Step | What                                             | Where                                                                                                            |
| ---- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| 1    | Create `/v1/chat/completions` proxy route        | `coderClawLink/api/src/presentation/routes/llmRoutes.ts`                                                         |
| 2    | Add `llm_requests` table (log every call)        | `schema.ts`: clawId, tenantId, model, provider, inputTokens, outputTokens, costUsd, latencyMs, approvalId        |
| 3    | Build routing engine (aliases, fallback, budget) | `coderClawLink/api/src/application/llm/RoutingEngine.ts`                                                         |
| 4    | Add `routing_policies` table                     | schema: tenantId, policy JSON, monthlyBudgetUsd, alertPercent                                                    |
| 5    | Wire approval workflow                           | Reuse execution approval from Phase 2; add `status: 'awaiting_approval'` to LLM request lifecycle                |
| 6    | Configure coderClaw to use it                    | New provider in `src/providers/coderclawllm.ts` that points at `CODERCLAW_LINK_URL + /v1` using existing API key |
| 7    | Add `/v1/models` endpoint                        | Aggregates provider models + local models from connected claws                                                   |
| 8    | OTel metrics                                     | Extend `diagnostics-otel` with `llm.proxy.*` metrics                                                             |

### coderClaw Provider Integration

```typescript
// src/providers/coderclawllm.ts  (sketch)
import { readSharedEnvVar } from "../coderclaw/env.js";

export function createCoderClawLLMProvider() {
  const baseUrl = readSharedEnvVar("CODERCLAW_LINK_URL") ?? "https://api.coderclaw.ai";
  const apiKey = readSharedEnvVar("CODERCLAW_LINK_API_KEY");
  const clawId = readSharedEnvVar("CODERCLAW_LINK_CLAW_ID"); // from context.yaml

  return {
    name: "coderclawLLM",
    baseUrl: `${baseUrl}/v1`,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "X-Claw-Id": clawId,
    },
    // OpenAI-compatible — works with existing chat/completion handlers
    type: "openai-compatible" as const,
  };
}
```

---

## 7. Recommended Implementation Order

```
Phase 0 — Fix Foundation (prerequisite for everything)
  ├── 0a. Create claw domain entity in coderClawLink
  └── 0b. Add effective claw-skill endpoint + client sync path

Phase 2 — Approval Workflows (from ROADMAP.md)
  ├── 2a. Add AWAITING_APPROVAL status to executions
  ├── 2b. Build coderclawLLM proxy (POST /v1/chat/completions)
  ├── 2c. Routing engine + budget enforcement
  ├── 2d. Approval request/poll/approve API
  └── 2e. SPA approval queue view

Phase 4 — Orchestration (from ROADMAP.md)
  ├── 4a. /v1/models aggregation (provider + local + claw-hosted)
  ├── 4b. Workflow templates with model selection
  ├── 4c. Fan-out with per-subtask budget
  └── 4d. Claw fleet routing (pick best claw for a task)
```
