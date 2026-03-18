# Builderforce.ai — Custom LLM Support

> **Companion to:** [Custom CoderClaws with a Custom LLM](custom-claws-llm.md)  
> **IDE spec reference:** `ide-architecture (1).md` in the repository root — the Builderforce.ai IDE
> architecture document (v2.0, March 2026). The filename with `(1)` is the verbatim filename as
> it exists in the repo root.

This document details every change the **Builderforce.ai** platform (IDE frontend +
Cloudflare Worker backend) must make to fully support custom LLMs built through the IDE —
so that fine-tuned agents can be stored, served, versioned, and consumed by coderClaw CLI
clients in production.

---

## Table of Contents

1. [Current State vs. Required State](#1-current-state-vs-required-state)
2. [Database Schema Changes](#2-database-schema-changes)
3. [New Worker Routes](#3-new-worker-routes)
   - 3.1 [Agent Inference Endpoint](#31-agent-inference-endpoint)
   - 3.2 [Mamba State Endpoints](#32-mamba-state-endpoints)
   - 3.3 [CLI Auth Token Endpoint](#33-cli-auth-token-endpoint)
   - 3.4 [Agent Package v2.0](#34-agent-package-v20)
4. [Updated Worker Routes](#4-updated-worker-routes)
   - 4.1 [AI Chat Route](#41-ai-chat-route)
   - 4.2 [Agent Publish Route](#42-agent-publish-route)
5. [Inference Service Architecture](#5-inference-service-architecture)
   - 5.1 [LoRA Adapter Loading](#51-lora-adapter-loading)
   - 5.2 [Provider Selection](#52-provider-selection)
   - 5.3 [Fallback Chain](#53-fallback-chain)
6. [CoderClaw CLI Authentication](#6-coderclaw-cli-authentication)
7. [IDE Frontend Changes](#7-ide-frontend-changes)
   - 7.1 [Training Panel](#71-training-panel)
   - 7.2 [Publish Panel](#72-publish-panel)
   - 7.3 [Agent State Viewer Panel](#73-agent-state-viewer-panel)
8. [Updated Worker SQL Schema](#8-updated-worker-sql-schema)
9. [API Reference — New and Changed Endpoints](#9-api-reference--new-and-changed-endpoints)
10. [End-to-End Flow: CLI Inference via Custom LLM](#10-end-to-end-flow-cli-inference-via-custom-llm)
11. [Implementation Checklist](#11-implementation-checklist)

---

## 1. Current State vs. Required State

### What exists today

| Component | Status | Notes |
|---|---|---|
| In-browser LoRA training (WebGPU) | ✅ | `frontend/src/lib/webgpu-trainer.ts` |
| Adapter storage in R2 | ✅ | `artifacts/{projectId}/{jobId}/adapter.bin` |
| Workforce Registry (publish / browse) | ✅ | `POST /api/agents`, `GET /api/agents` |
| Agent package download | ✅ | `GET /api/agents/:id/package` → v1.0 JSON |
| AI chat inference | ✅ | `POST /api/ai/chat` → Cloudflare AI / OpenRouter |
| Mamba State Engine (in-browser) | ✅ | `frontend/src/lib/mamba-engine.ts` |
| Agent Runtime SDK (in-browser) | ✅ | `frontend/src/lib/agent-runtime.ts` |

### What is missing

| Gap | Impact | Priority |
|---|---|---|
| **No inference endpoint for custom agents** | CoderClaw CLI cannot run a trained agent | P0 |
| **No LoRA adapter loading on inference server** | Training produces `.bin` but nothing serves it | P0 |
| **No `mamba_state` in DB / package** | v2.0 agents cannot round-trip their memory | P0 |
| **No CLI auth token** | CLI has no way to call Builderforce inference API | P0 |
| **`POST /api/ai/chat` ignores `model` field** | Cannot route to `workforce-<id>` | P1 |
| **No agent streaming inference** | CLI needs SSE chunked responses | P1 |
| **No rate limiting per API key** | Inference endpoint open to abuse | P1 |
| **No agent package v2.0** | Mamba state not shipped with download | P1 |
| **No usage tracking per agent** | Cannot bill or monitor custom model usage | P2 |
| **No model artifact versioning** | Cannot distinguish adapter generations | P2 |

---

## 2. Database Schema Changes

### 2a. `agents` table — new columns

```sql
-- Add to existing agents table
ALTER TABLE agents
  ADD COLUMN package_version  TEXT    NOT NULL DEFAULT '1.0',
  ADD COLUMN mamba_state      JSONB,          -- MambaStateSnapshot | null
  ADD COLUMN inference_mode   TEXT    NOT NULL DEFAULT 'base',
  --   'base'    → use base_model directly (no adapter)
  --   'lora'    → load LoRA adapter from r2_artifact_key
  --   'hybrid'  → LoRA + Mamba state injection
  ADD COLUMN request_count    INTEGER NOT NULL DEFAULT 0,  -- total CLI inference calls
  ADD COLUMN last_used_at     TIMESTAMPTZ;
```

### 2b. New `cli_api_keys` table

Stores API keys issued to coderClaw CLI users for authenticated inference.

```sql
CREATE TABLE cli_api_keys (
  id            TEXT PRIMARY KEY,          -- UUID
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash      TEXT NOT NULL UNIQUE,      -- SHA-256(raw_key), never store plaintext
  label         TEXT,                      -- e.g. "laptop", "CI"
  scopes        TEXT NOT NULL DEFAULT 'inference:read', -- space-separated
  last_used_at  TIMESTAMPTZ,
  request_count INTEGER NOT NULL DEFAULT 0,
  rate_limit    INTEGER NOT NULL DEFAULT 1000, -- requests per day
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at    TIMESTAMPTZ                 -- null = active
);

CREATE INDEX cli_api_keys_user_idx ON cli_api_keys(user_id);
CREATE INDEX cli_api_keys_hash_idx ON cli_api_keys(key_hash);
```

### 2c. New `agent_inference_logs` table

Audit trail for all inference calls made through the custom agent endpoint.

```sql
CREATE TABLE agent_inference_logs (
  id              TEXT PRIMARY KEY,
  agent_id        TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  cli_key_id      TEXT REFERENCES cli_api_keys(id) ON DELETE SET NULL,
  model_ref       TEXT NOT NULL,           -- e.g. "workforce-<agentId>"
  prompt_tokens   INTEGER,
  completion_tokens INTEGER,
  latency_ms      INTEGER,
  status          TEXT NOT NULL,           -- 'ok' | 'error' | 'timeout'
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX agent_inference_logs_agent_idx ON agent_inference_logs(agent_id);
CREATE INDEX agent_inference_logs_key_idx   ON agent_inference_logs(cli_key_id);
```

### 2d. `agents` table — update `mamba_state` on publish

The publish route must accept and store the `mamba_state` snapshot when the agent package
version is `2.0`.

---

## 3. New Worker Routes

### 3.1 Agent Inference Endpoint

**File:** `worker/src/routes/agents.ts`

```
POST /api/agents/:id/chat
```

This is the core new endpoint. It accepts an OpenAI-compatible chat completion request,
resolves the agent's LoRA adapter, runs inference, and streams tokens back.

**Request:**

```http
POST /api/agents/550e8400-e29b-41d4-a716-446655440000/chat
Authorization: Bearer <cli-api-key>
Content-Type: application/json

{
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "Explain this Python traceback: ..." }
  ],
  "stream": true,
  "max_tokens": 1024,
  "temperature": 0.7
}
```

**Response (streaming, `stream: true`):**

```
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache

data: {"id":"chatcmpl-abc","object":"chat.completion.chunk","choices":[{"delta":{"content":"The"},"index":0}]}

data: {"id":"chatcmpl-abc","object":"chat.completion.chunk","choices":[{"delta":{"content":" error"},"index":0}]}

data: [DONE]
```

**Response (non-streaming, `stream: false`):**

```json
{
  "id": "chatcmpl-abc",
  "object": "chat.completion",
  "choices": [{
    "message": { "role": "assistant", "content": "The error means..." },
    "finish_reason": "stop",
    "index": 0
  }],
  "usage": { "prompt_tokens": 180, "completion_tokens": 340, "total_tokens": 520 }
}
```

**Worker implementation sketch** (`worker/src/routes/agents.ts`):

```typescript
app.post("/api/agents/:id/chat", async (c) => {
  // 1. Authenticate CLI key
  const keyId = await authenticateCliKey(c);
  if (!keyId) return c.json({ error: "Unauthorized" }, 401);

  // 2. Load agent record
  const agent = await db.query("SELECT * FROM agents WHERE id = $1", [c.req.param("id")]);
  if (!agent) return c.json({ error: "Agent not found" }, 404);
  if (agent.status !== "active") return c.json({ error: "Agent is inactive" }, 403);

  // 3. Parse request body
  const body = await c.req.json<ChatRequest>();

  // 4. Resolve inference mode
  const result = await runAgentInference({
    agent,
    messages: body.messages,
    stream: body.stream ?? false,
    maxTokens: body.max_tokens ?? 1024,
    temperature: body.temperature ?? 0.7,
    env: c.env,
  });

  // 5. Log usage (non-blocking)
  c.executionCtx.waitUntil(
    logInference({ agentId: agent.id, keyId, ...result.usage, env: c.env })
  );

  return result.response;
});
```

### 3.2 Mamba State Endpoints

**File:** `worker/src/routes/agents.ts`

#### `GET /api/agents/:id/mamba-state`

Returns the stored Mamba state snapshot for the agent (if any).

```http
GET /api/agents/550e8400-e29b-41d4-a716-446655440000/mamba-state
Authorization: Bearer <cli-api-key>
```

```json
{
  "agentId": "550e8400-e29b-41d4-a716-446655440000",
  "snapshot": {
    "data": [0.12, -0.05, 0.31],
    "dim": 64, "order": 4, "channels": 16, "step": 142
  },
  "updatedAt": "2026-03-18T09:00:00.000Z"
}
```

#### `PUT /api/agents/:id/mamba-state`

Allows a coderClaw session to push an updated Mamba state after interaction — keeping the
server-side state in sync with the local `.coderClaw/memory/mamba-state.json`.

```http
PUT /api/agents/550e8400-e29b-41d4-a716-446655440000/mamba-state
Authorization: Bearer <cli-api-key>
Content-Type: application/json

{
  "data": [0.13, -0.04, 0.33],
  "dim": 64, "order": 4, "channels": 16, "step": 143
}
```

Returns `200 { success: true }`.

### 3.3 CLI Auth Token Endpoint

**File:** `worker/src/routes/auth.ts` (new sub-route)

#### `POST /api/auth/cli-key`

Issues a new CLI API key scoped to inference. Requires a valid web token.

```http
POST /api/auth/cli-key
Authorization: Bearer <web-token>
Content-Type: application/json

{ "label": "my-laptop" }
```

```json
{
  "keyId": "key_01HZ...",
  "rawKey": "ccl_sk_live_...",    ← shown ONCE, never stored in plaintext
  "label": "my-laptop",
  "scopes": ["inference:read"],
  "createdAt": "2026-03-18T09:00:00.000Z"
}
```

The `rawKey` is displayed once and then only the SHA-256 hash is stored. The user copies it
into `~/.coderclaw/.env` as `CODERCLAW_LINK_API_KEY`.

#### `DELETE /api/auth/cli-key/:keyId`

Revokes a key immediately.

### 3.4 Agent Package v2.0

**File:** `worker/src/routes/agents.ts` — update `GET /api/agents/:id/package`

When `agents.mamba_state IS NOT NULL`, return version `"2.0"`:

```typescript
app.get("/api/agents/:id/package", async (c) => {
  const agent = await db.query(...);
  const pkg = agent.mamba_state
    ? buildPackageV2(agent)   // includes mamba_state field
    : buildPackageV1(agent);

  return c.body(JSON.stringify(pkg), 200, {
    "Content-Type": "application/json",
    "Content-Disposition": `attachment; filename="agent-package.json"`,
  });
});
```

---

## 4. Updated Worker Routes

### 4.1 AI Chat Route

**File:** `worker/src/routes/ai.ts`

The existing `POST /api/ai/chat` endpoint needs to recognise the special
`"workforce-<agentId>"` model prefix and delegate to the agent inference service.

```typescript
// worker/src/routes/ai.ts
app.post("/api/ai/chat", async (c) => {
  const body = await c.req.json<ChatRequest>();

  // Detect Workforce agent model reference
  const workforceMatch = body.model?.match(/^(?:coderclawllm\/)?workforce-(.+)$/);
  if (workforceMatch) {
    const agentId = workforceMatch[1];
    // Authenticate and forward to agent inference
    return forwardToAgentInference(c, agentId, body);
  }

  // Original provider-based routing (Cloudflare AI / OpenRouter)
  return runStandardInference(c, body);
});
```

This means the CoderClaw CLI can continue using `POST /api/ai/chat` with
`model: "coderclawllm/workforce-<agentId>"` — no endpoint change required on the CLI side.

### 4.2 Agent Publish Route

**File:** `worker/src/routes/agents.ts` — update `POST /api/agents`

Accept `mamba_state` and `package_version` in the request body:

```typescript
// New fields in POST /api/agents body
{
  project_id: string;
  job_id?: string;
  name: string;
  title: string;
  bio: string;
  skills?: string[];
  base_model: string;
  lora_rank?: number;
  r2_artifact_key?: string;
  resume_md?: string;
  // NEW:
  mamba_state?: MambaStateSnapshot;
  package_version?: "1.0" | "2.0";  // default "1.0"
}
```

Set `inference_mode`:
- `"base"` if no `r2_artifact_key`
- `"lora"` if `r2_artifact_key` present but no `mamba_state`
- `"hybrid"` if both `r2_artifact_key` and `mamba_state` are present

---

## 5. Inference Service Architecture

### 5.1 LoRA Adapter Loading

**File:** `worker/src/services/ai.ts` — new function `runAgentInference()`

The LoRA adapter (`adapter.bin`) is a serialised ArrayBuffer of the fine-tuned
weight deltas. To apply it at inference time the system needs an inference backend
that supports dynamic LoRA adapter loading.

**Option A — Cloudflare Workers AI (recommended, hosted)**

Cloudflare Workers AI does not yet support dynamic LoRA loading via the standard API.
Use the **AI Gateway** `finetune` parameter once Cloudflare exposes it, or use the
`@cf/meta/llama-3.1-8b-instruct` model with a hosted fine-tune endpoint.

```typescript
// When Cloudflare AI supports finetune parameter:
const response = await c.env.AI.run("@cf/codeparrot-350m", {
  messages,
  stream: true,
  finetune: r2SignedUrl,   // Pre-signed R2 URL to adapter.bin
});
```

**Option B — OpenRouter with hosted fine-tune**

Not supported on OpenRouter for arbitrary adapters. Only works for models on
OpenRouter's fine-tune allowlist.

**Option C — Custom inference server (recommended for v1)**

Deploy a **custom inference microservice** (e.g. on Cloudflare Workers + Wasm,
or a separate GPU worker) that:

1. Receives `{ agentId, messages, stream }`.
2. Downloads the LoRA adapter from R2 using a service-account credential.
3. Loads the base model weights (cached in-memory or GPU memory).
4. Applies the adapter using the PEFT library equivalent in WASM/Rust.
5. Streams tokens back as SSE.

```
CoderClaw CLI
    │
    ▼  POST /api/agents/:id/chat  (Hono Worker)
Cloudflare Worker (api.builderforce.ai)
    │
    ├─ fetch agent record from Neon
    ├─ generate pre-signed R2 URL for adapter.bin (1 hr TTL)
    │
    ▼  POST https://inference.builderforce.ai/v1/lora-chat
Inference Service (GPU Worker / Durable Object)
    │
    ├─ GET <r2-presigned-url>  → adapter.bin bytes
    ├─ cache adapter by (agentId, jobId) in LRU (max 50 adapters)
    ├─ load base model (cached by base_model id)
    ├─ apply LoRA weights
    ├─ stream inference tokens
    │
    ▼  SSE chunks forwarded back through the Hono Worker
CoderClaw CLI
```

**Inference service tech stack:**

| Component | Technology |
|---|---|
| HTTP server | Rust (Axum) or Python (FastAPI) |
| Model loading | `candle` (Rust) or `transformers` (Python) with PEFT |
| LoRA application | PEFT `PeftModel.from_pretrained()` from bytes |
| Streaming | SSE (tokio-stream / asyncio) |
| Caching | LRU cache for adapter bytes + loaded model |
| Deployment | Cloudflare Workers (WASM for small models) or GPU server |

### 5.2 Provider Selection

The Hono Worker selects the inference backend using the following priority:

```
1. agents.r2_artifact_key IS NOT NULL AND inference service available
   → Custom inference service (LoRA adapter applied)

2. agents.base_model matches a Cloudflare Workers AI model id
   → Cloudflare Workers AI (base model only)

3. agents.base_model matches an OpenRouter model id
   → OpenRouter (base model only)

4. Fallback
   → Return 503 with { error: "Inference unavailable for this agent" }
```

### 5.3 Fallback Chain

When the LoRA inference service is unavailable, the system degrades gracefully:

```
try custom inference service
    │ fails (timeout / 5xx)
    ▼
try base model via Cloudflare Workers AI
    │ base_model not available on CF AI
    ▼
try base model via OpenRouter
    │ base_model not available on OpenRouter
    ▼
return 503 + note in X-Inference-Mode header:
  X-Inference-Mode: fallback-base | fallback-openrouter | unavailable
```

The CLI should surface the `X-Inference-Mode` header in the session banner so the
user knows when the custom LoRA is not being applied.

---

## 6. CoderClaw CLI Authentication

### Key issuance flow

```
1. User runs: coderclaw init  →  connects to Builderforce (promptClawLink wizard)
2. After Builderforce login the wizard calls:
   POST /api/auth/cli-key  { label: machineName }
3. rawKey returned once → saved to ~/.coderclaw/.env as CODERCLAW_LINK_API_KEY
4. Future API calls use: Authorization: Bearer <rawKey>
```

### Key validation (worker)

```typescript
// worker/src/services/cli-auth.ts
export async function authenticateCliKey(
  c: Context,
): Promise<{ keyId: string; userId: string } | null> {
  const authHeader = c.req.header("Authorization");
  const raw = authHeader?.match(/^Bearer (.+)$/)?.[1];
  if (!raw) return null;

  const hash = await sha256hex(raw);
  const row = await c.env.DB.prepare(
    "SELECT id, user_id, revoked_at, rate_limit FROM cli_api_keys WHERE key_hash = ?1",
  ).bind(hash).first();

  if (!row || row.revoked_at) return null;

  // Rate limit: count today's requests
  const today = new Date().toISOString().slice(0, 10);
  const count = await c.env.DB.prepare(
    "SELECT COUNT(*) as n FROM agent_inference_logs WHERE cli_key_id = ?1 AND DATE(created_at) = ?2",
  ).bind(row.id, today).first<{ n: number }>();

  if ((count?.n ?? 0) >= row.rate_limit) {
    c.header("Retry-After", "86400");
    return null; // caller should return 429
  }

  // Update last_used_at (non-blocking)
  c.executionCtx.waitUntil(
    c.env.DB.prepare(
      "UPDATE cli_api_keys SET last_used_at = CURRENT_TIMESTAMP, request_count = request_count + 1 WHERE id = ?1",
    ).bind(row.id).run(),
  );

  return { keyId: row.id, userId: row.user_id };
}
```

---

## 7. IDE Frontend Changes

### 7.1 Training Panel

**File:** `frontend/src/components/AITrainingPanel.tsx`

#### Add "Export Mamba state" to completed job actions

After a successful Hybrid training run the adapter has an associated Mamba snapshot in
`IndexedDB`. Add a button to serialise it and attach to the agent publish payload:

```tsx
{job.status === "completed" && mambaState && (
  <button onClick={() => setMambaForPublish(mambaState)}>
    📦 Include Mamba memory in publish
  </button>
)}
```

#### Add inference mode indicator to job list

Show which inference mode will be used for a completed job:

```
CodeParrot 350M  ✓ LoRA (r=8)  🧠 +Mamba   → Hybrid inference
CodeParrot 350M  ✓ LoRA (r=8)                → LoRA inference
GPT-NeoX 20M    (no adapter)                 → Base model only
```

### 7.2 Publish Panel

**File:** `frontend/src/components/AgentPublishPanel.tsx`

#### Include Mamba state in publish payload (v2.0)

When `mambaForPublish` is set, include it in `POST /api/agents`:

```typescript
const publishPayload = {
  // ... existing fields ...
  ...(mambaForPublish ? {
    mamba_state: mambaForPublish,
    package_version: "2.0" as const,
  } : {
    package_version: "1.0" as const,
  }),
};
```

#### Display package version badge

Show `v2.0 🧠` or `v1.0` on the publish success screen and in the agent profile header.

#### Show CLI install command

After publishing, show the coderClaw CLI install command (not just the PowerShell script):

```
📦 Install in coderClaw:
  coderclaw agent install <agentId>

📥 PowerShell:
  iwr -useb https://coderclaw.ai/install.ps1 | iex
```

### 7.3 Agent State Viewer Panel

**File:** `frontend/src/components/AgentStateViewer.tsx` (new component)

A new right-panel tab **🔬 State** (referenced in the spec's §22 but not yet implemented):

```tsx
export function AgentStateViewer({ agentId, projectId }: Props) {
  const [snapshot, setSnapshot] = useState<MambaStateSnapshot | null>(null);

  // Load from IndexedDB on mount
  useEffect(() => { loadMambaState(agentId).then(setSnapshot); }, [agentId]);

  return (
    <div className="state-viewer">
      <StateSummaryCards snapshot={snapshot} />
      <ChannelHeatmap data={snapshot?.data} channels={snapshot?.channels} />
      <InteractionHistory agentId={agentId} />
      <SequenceReplay agentId={agentId} />
      <button onClick={() => resetMambaState(agentId)}>Reset state</button>
    </div>
  );
}
```

The panel also offers a **"Sync to server"** button that calls
`PUT /api/agents/:id/mamba-state` with the current snapshot.

---

## 8. Updated Worker SQL Schema

Complete updated `worker/schema.sql` additions (apply as migrations):

```sql
-- Migration 001: CLI API keys
CREATE TABLE cli_api_keys (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash      TEXT NOT NULL UNIQUE,
  label         TEXT,
  scopes        TEXT NOT NULL DEFAULT 'inference:read',
  last_used_at  TIMESTAMPTZ,
  request_count INTEGER NOT NULL DEFAULT 0,
  rate_limit    INTEGER NOT NULL DEFAULT 1000,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at    TIMESTAMPTZ
);
CREATE INDEX cli_api_keys_user_idx ON cli_api_keys(user_id);
CREATE INDEX cli_api_keys_hash_idx ON cli_api_keys(key_hash);

-- Migration 002: Agent inference logs
CREATE TABLE agent_inference_logs (
  id                TEXT PRIMARY KEY,
  agent_id          TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  cli_key_id        TEXT REFERENCES cli_api_keys(id) ON DELETE SET NULL,
  model_ref         TEXT NOT NULL,
  prompt_tokens     INTEGER,
  completion_tokens INTEGER,
  latency_ms        INTEGER,
  status            TEXT NOT NULL,
  error_message     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX agent_inference_logs_agent_idx ON agent_inference_logs(agent_id);
CREATE INDEX agent_inference_logs_key_idx   ON agent_inference_logs(cli_key_id);

-- Migration 003: Agent table extensions
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS package_version  TEXT    NOT NULL DEFAULT '1.0',
  ADD COLUMN IF NOT EXISTS mamba_state      JSONB,
  ADD COLUMN IF NOT EXISTS inference_mode   TEXT    NOT NULL DEFAULT 'base',
  ADD COLUMN IF NOT EXISTS request_count    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_used_at     TIMESTAMPTZ;
```

---

## 9. API Reference — New and Changed Endpoints

### New endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/agents/:id/chat` | CLI key | Run inference on a custom agent (streaming SSE or JSON) |
| `GET` | `/api/agents/:id/mamba-state` | CLI key | Fetch the stored Mamba SSM state snapshot |
| `PUT` | `/api/agents/:id/mamba-state` | CLI key | Push an updated Mamba state from CLI session |
| `POST` | `/api/auth/cli-key` | Web token | Issue a new CLI API key |
| `DELETE` | `/api/auth/cli-key/:keyId` | Web token | Revoke a CLI API key |
| `GET` | `/api/auth/cli-keys` | Web token | List all CLI API keys for the current user |

### Changed endpoints

| Method | Path | Change |
|---|---|---|
| `POST` | `/api/agents` | Accept `mamba_state`, `package_version` in body; set `inference_mode` |
| `GET` | `/api/agents/:id/package` | Return v2.0 format when `mamba_state` is present |
| `POST` | `/api/ai/chat` | Detect `workforce-<id>` model prefix → delegate to agent inference |

### Request / response types (TypeScript)

```typescript
// POST /api/agents/:id/chat
type AgentChatRequest = {
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  stream?: boolean;            // default: false
  max_tokens?: number;         // default: 1024
  temperature?: number;        // default: 0.7
  mamba_context?: string;      // optional: pre-computed memory context from CLI
};

type AgentChatChunk = {
  id: string;
  object: "chat.completion.chunk";
  choices: [{ delta: { content?: string }; index: 0; finish_reason?: string }];
};

type AgentChatResponse = {
  id: string;
  object: "chat.completion";
  choices: [{ message: { role: "assistant"; content: string }; finish_reason: "stop"; index: 0 }];
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
};

// PUT /api/agents/:id/mamba-state body = MambaStateSnapshot (see types.ts)
```

---

## 10. End-to-End Flow: CLI Inference via Custom LLM

```
User types message in coderClaw TUI
     │
     ▼
1. [CLI] Load project context
   └── context.customAgent.modelRef = "coderclawllm/workforce-<agentId>"
     │
     ▼
2. [CLI] Advance Mamba state (if hasMambaState)
   └── jsSelectiveScan(currentState, embed(message)) → memoryContext
     │
     ▼
3. [CLI] Assemble system prompt
   └── [file context] + [project rules] + memoryContext
     │
     ▼
4. [CLI] POST https://api.builderforce.ai/api/ai/chat
   Authorization: Bearer <CODERCLAW_LINK_API_KEY>
   { model: "coderclawllm/workforce-<agentId>",
     messages: [...],
     stream: true }
     │
     ▼
5. [Hono Worker] Parse model prefix
   └── "workforce-550e8400-…" → agentId = "550e8400-…"
     │
     ▼
6. [Hono Worker] Authenticate CLI key
   └── hash(rawKey) → lookup cli_api_keys → check rate limit
     │
     ▼
7. [Hono Worker] Load agent from Neon
   └── SELECT * FROM agents WHERE id = $1
     │
     ▼
8. [Hono Worker] Generate pre-signed R2 URL
   └── env.R2.createSignedUrl(agent.r2_artifact_key, { expiresIn: 3600 })
     │
     ▼
9. [Hono Worker] Call inference service
   └── POST https://inference.builderforce.ai/v1/lora-chat
       { agentId, r2SignedUrl, messages, mamba_context?, stream: true }
     │
     ▼
10. [Inference Service] Load / cache adapter
    ├── check LRU cache by (agentId, r2_artifact_key)
    ├── cache miss → GET <r2SignedUrl> → load adapter bytes
    └── apply LoRA to base model weights
     │
     ▼
11. [Inference Service] Stream tokens → Worker → Client
     │
     ▼
12. [CLI] Render streamed tokens in TUI
     │
     ▼
13. [CLI] Persist updated Mamba state
    └── writeFile(.coderClaw/memory/mamba-state.json, newState)
     │
     ▼ (async, non-blocking)
14. [CLI] Push Mamba state to server
    └── PUT /api/agents/<agentId>/mamba-state { ...newState }
```

---

## 11. Implementation Checklist

### Phase 1 — Authentication & Package v2.0 (P0)

- [ ] **Schema migration 001** — `cli_api_keys` table
- [ ] **Schema migration 003** — Add columns to `agents` table (`package_version`, `mamba_state`, `inference_mode`, `request_count`, `last_used_at`)
- [ ] **`POST /api/auth/cli-key`** — issue API key, return raw key once
- [ ] **`GET /api/agents/:id/package`** — v2.0 response when `mamba_state` is set
- [ ] **`POST /api/agents`** — accept `mamba_state` and `package_version` fields
- [ ] **Frontend: Publish panel** — include Mamba state checkbox and CLI install command
- [ ] **CoderClaw CLI** — `coderclaw init` calls `POST /api/auth/cli-key` and saves key *(see `product/src/commands/coderclaw.ts`)*

### Phase 2 — Inference Routing (P0)

- [ ] **`POST /api/ai/chat`** — detect `workforce-<id>` model prefix, delegate
- [ ] **`POST /api/agents/:id/chat`** — full inference endpoint with auth + logging
- [ ] **`worker/src/services/ai.ts`** — `runAgentInference()` with fallback chain
- [ ] **Schema migration 002** — `agent_inference_logs` table
- [ ] **Rate limiting** — enforce per-key daily request quota

### Phase 3 — Inference Service (P1)

- [ ] **Deploy inference microservice** — choose Cloudflare WASM or GPU worker
- [ ] **LoRA adapter caching** — LRU in-memory / KV store
- [ ] **`X-Inference-Mode` header** — signal whether adapter was applied
- [ ] **`PUT /api/agents/:id/mamba-state`** — sync from CLI

### Phase 4 — Observability & UX (P2)

- [ ] **`GET /api/agents/:id/mamba-state`** — read stored state
- [ ] **Frontend: Agent State Viewer** — `AgentStateViewer.tsx` component
- [ ] **Frontend: Training panel** — inference mode indicator on completed jobs
- [ ] **Usage dashboard** — per-agent request counts, latency percentiles
- [ ] **`coderclaw agent list`** — CLI command to browse Workforce Registry

---

*Last updated: March 2026*
