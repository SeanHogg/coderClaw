---
summary: "Connect CoderClaw to a CoderClawLink node for remote multi-agent orchestration"
read_when:
  - You want to run CoderClaw workflows on a remote CoderClawLink node
  - You want to understand the ClawLink transport adapter
title: "CoderClawLink Integration"
---

# CoderClawLink Integration

[CoderClawLink](https://github.com/SeanHogg/coderClawLink) is a companion portal to CoderClaw: a Python FastAPI application that provides a Jira-style web UI, Telegram bot, and remote agent execution runtime. The two systems share the same transport abstraction contract — tasks submitted from CoderClaw can be executed on a CoderClawLink node as naturally as local tasks.

## How they fit together

```
┌────────────────────────────────┐        HTTP        ┌───────────────────────────────┐
│          CoderClaw             │  ──────────────►   │        CoderClawLink          │
│   (TypeScript orchestrator)    │                     │   (Python execution portal)   │
│                                │                     │                               │
│  Planning workflow             │   POST /tasks/submit│  Claude, OpenAI, Ollama,      │
│  Adversarial review            │   GET  /tasks/state │  OpenDevin, Goose agents      │
│  Feature / bug-fix pipelines   │   GET  /agents      │  Kanban board, Telegram bot   │
│  Session handoffs              │   GET  /skills      │  GitHub PR automation         │
└────────────────────────────────┘                     └───────────────────────────────┘
```

CoderClaw is the intelligence layer: it plans, orchestrates, and coordinates. CoderClawLink is the execution portal: it runs the agents, tracks projects, and exposes a visual UI.

## Quick start

### 1. Start CoderClawLink

```bash
git clone https://github.com/SeanHogg/coderClawLink.git
cd coderClawLink
pip install -r requirements.txt
cp .env.example .env   # fill in ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.
python -m app.main     # starts on http://localhost:8000
```

### 2. Connect CoderClaw to it

```typescript
import { ClawLinkTransportAdapter } from "coderclaw/transport";
import { CoderClawRuntime } from "coderclaw/transport";

const adapter = new ClawLinkTransportAdapter({
  baseUrl: "http://localhost:8000",
  userId: "my-user", // optional — for audit trails
  deviceId: "my-workstation", // optional
});

await adapter.connect(); // creates a session on the CoderClawLink node

const runtime = new CoderClawRuntime(adapter, "remote-enabled");
```

### 3. Submit tasks — same API, remote execution

```typescript
const state = await runtime.submitTask({
  agentId: "claude", // maps to CoderClawLink's agent_type
  description: "Build login page",
  input: "Create a login component with email + password fields",
  metadata: { project: "my-app" },
});

console.log(state.id, state.status); // uuid, "pending"

// Stream progress until completion
for await (const event of runtime.streamTaskUpdates(state.id)) {
  console.log(event.status, event.progress);
}
```

Or use CoderClaw's higher-level multi-agent workflows — they route through the adapter automatically:

```bash
# These run on the CoderClawLink node when ClawLink adapter is active
coderclaw agent --message "Plan the authentication feature" --thinking high
coderclaw agent --message "Adversarially review the API design" --thinking high
```

## Configuration reference

| Option           | Type     | Default | Description                                             |
| ---------------- | -------- | ------- | ------------------------------------------------------- |
| `baseUrl`        | `string` | —       | CoderClawLink server URL, e.g. `http://localhost:8000`  |
| `userId`         | `string` | —       | User ID attached to the session (appears in audit logs) |
| `deviceId`       | `string` | —       | Device ID attached to the session                       |
| `pollIntervalMs` | `number` | `1000`  | How often (ms) to poll for task status updates          |
| `timeoutMs`      | `number` | `30000` | Per-request timeout in ms                               |

## How the mapping works

CoderClaw and CoderClawLink share the same task state machine:

```
PENDING → PLANNING → RUNNING → WAITING → COMPLETED
                                        → FAILED
                                        → CANCELLED
```

Field mapping on task submission:

| CoderClaw field        | ClawLink field        |
| ---------------------- | --------------------- |
| `agentId`              | `agent_type`          |
| `input`                | `prompt`              |
| `metadata`             | merged into `context` |
| session (from adapter) | `session_id`          |

## Security

The ClawLink adapter creates one session per `ClawLinkTransportAdapter` instance. CoderClawLink enforces RBAC on every operation — the session user must have `task:submit`, `agent:execute`, and `task:view` permissions. Assign the `DEVELOPER` role to your user in CoderClawLink for standard development workflows.

## What CoderClawLink adds

Running tasks through CoderClawLink gives CoderClaw access to:

- **Visual Kanban board** — tasks are visible at `http://localhost:8000`
- **Telegram bot** — team members can interact with tasks via Telegram
- **GitHub PR automation** — agents can create pull requests directly from task results
- **Ollama / local LLM support** — run Llama, CodeLlama, and other local models without API keys
- **OpenDevin and Goose agents** — additional open-source agent runtimes
- **Audit logs** — full execution history at `/api/audit/events`

## Further reading

- [CoderClawLink repository](https://github.com/SeanHogg/coderClawLink)
- [Phase 2 architecture in CoderClawLink](https://github.com/SeanHogg/coderClawLink/blob/main/PHASE2.md)
- [CoderClaw workflows](/coderclaw-workflows)
- [Phase 2 distributed runtime](/phase2)
