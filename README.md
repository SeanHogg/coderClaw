# CoderClaw — Developer-First Multi-Agent AI System

<p align="center">
    <img src="https://raw.githubusercontent.com/SeanHogg/coderClaw/main/assets/coderclaw.png" alt="CoderClaw" width="300">
</p>

<p align="center">
  <strong>CREATE. REVIEW. TEST. DEBUG. REFACTOR. UNDERSTAND.</strong>
</p>

<p align="center">
  <a href="https://github.com/SeanHogg/coderClaw/actions/workflows/release.yml?branch=main"><img src="https://img.shields.io/github/actions/workflow/status/SeanHogg/coderClaw/release.yml?branch=main&style=for-the-badge&label=release" alt="Release status"></a>
  <a href="https://github.com/SeanHogg/coderClaw/releases"><img src="https://img.shields.io/github/v/release/SeanHogg/coderClaw?include_prereleases&style=for-the-badge" alt="GitHub release"></a>
  <a href="https://discord.gg/coderclaw"><img src="https://img.shields.io/discord/1456350064065904867?label=Discord&logo=discord&logoColor=white&color=5865F2&style=for-the-badge" alt="Discord"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
</p>

**CoderClaw** is the self-hosted, multi-agent AI coding system that replaces GitHub Copilot, Cursor, Windsurf, and Claude Code. Your code stays on your machine. Your agents run your workflows. No vendor lock-in, no IDE tether, no subscription ceiling. It’s self-hosted and MIT‑licensed.

More broadly, **coderClaw.ai** is a **self-healing AI engineering agent and orchestration platform** that manages tasks, workflows, and collaboration across all AI agents. It provides persistent memory, context-aware reasoning, and self-repair, allowing AI systems to detect failures, fix themselves, and adapt over time. Every autonomous action surfaces a human-in-the-loop approval gate, so teams stay in control. The result: resilient, self-healing software systems with less engineering toil and better delivery outcomes.

## 🔌 Connect Cursor or Continue.dev to CoderClaw (MCP)

CoderClaw exposes its tools as an **MCP server** at `http://localhost:18789/mcp`.
Add it to Cursor or Continue.dev to get CoderClaw's semantic search, project knowledge,
and git history inside your existing IDE:

**Cursor** (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "coderclaw": {
      "url": "http://localhost:18789/mcp"
    }
  }
}
```

**Continue.dev** (`~/.continue/config.json`):

```json
{
  "contextProviders": [
    {
      "name": "mcp",
      "params": {
        "serverUrl": "http://localhost:18789/mcp"
      }
    }
  ]
}
```

Once connected, use `@codebase_search`, `@project_knowledge`, and `@git_history`
as context in Cursor Composer or Continue.dev chat.

## 🔍 Pair Programming with Staged Diffs

CoderClaw now supports **staged edit mode** — agent file changes are buffered for
your review before landing on disk, exactly like Cursor Composer's accept/reject panel:

```bash
# Enable staged mode (agent edits are buffered, not written immediately)
CODERCLAW_STAGED=true coderclaw gateway

# Review what the agent wants to change
/diff

# Review a specific file
/diff src/auth/login.ts

# Accept all changes
/accept

# Accept one file
/accept src/auth/login.ts

# Reject everything and start over
/reject all
```

## 🔄 Why CoderClaw instead of GitHub Copilot, Cursor, or Claude Code?

|                                            | **CoderClaw**                            | GitHub Copilot              | Cursor / Windsurf  | Claude Code        | Continue.dev      |
| ------------------------------------------ | ---------------------------------------- | --------------------------- | ------------------ | ------------------ | ----------------- |
| **Price**                                  | Free (MIT)                               | $19/user/month              | $20/user/month     | Usage-based        | Free (MIT)        |
| **Self-hosted / open source**              | ✅ MIT, fully self-hosted                | ❌ Microsoft cloud          | ❌ Vendor cloud    | ❌ Anthropic cloud | ✅ MIT, extension |
| **IDE-independent**                        | ✅ Any channel / CLI                     | ❌ VS Code only             | ❌ Fork of VS Code | ⚠️ Terminal only   | ❌ IDE extension  |
| **Any model provider**                     | ✅ 30+ providers (Ollama, API, Bedrock…) | ❌ GPT-4o / Claude only     | ⚠️ Limited list    | ❌ Anthropic only  | ✅ Any model      |
| **MCP support — consume**                  | ✅ via mcporter bridge                   | ❌                          | ✅ Native          | ❌                 | ✅ Native         |
| **MCP support — expose as server**         | ✅ `/mcp` endpoint on gateway            | ❌                          | ❌                 | ❌                 | ❌                |
| **Codebase semantic search**               | ✅ `codebase_search` tool                | ⚠️ Limited                  | ✅ `@codebase`     | ⚠️ Basic RAG       | ✅ `@codebase`    |
| **Staged diff / accept-reject**            | ✅ `/diff`, `/accept`, `/reject`         | ❌                          | ✅ Composer panel  | ❌                 | ✅ `⌘K` diff      |
| **Multi-agent orchestration**              | ✅ 7 roles + dependency DAG              | ❌ Single inline suggestion | ❌ Single agent    | ❌ Single agent    | ❌ Single agent   |
| **Planning workflow (PRD → Arch → Tasks)** | ✅ `/spec` command                       | ❌                          | ❌                 | ❌                 | ❌                |
| **Adversarial review pass**                | ✅ Built-in workflow type                | ❌                          | ❌                 | ❌                 | ❌                |
| **Session handoffs**                       | ✅ `/handoff` cmd + auto-load            | ❌                          | ❌                 | ❌                 | ❌                |
| **Workflow persistence across restarts**   | ✅ YAML checkpoint + resume              | ❌                          | ❌                 | ❌                 | ❌                |
| **Post-task knowledge loop**               | ✅ `.coderClaw/memory/` auto-updated     | ❌                          | ❌                 | ❌                 | ❌                |
| **Claw-to-claw distributed delegation**    | ✅ `remote:<id>` / `remote:auto[caps]`   | ❌                          | ❌                 | ❌                 | ❌                |
| **Deep AST + git-history analysis**        | ✅                                       | ❌                          | ⚠️ Basic RAG       | ⚠️ Basic RAG       | ⚠️ Basic RAG      |
| **Persistent project knowledge**           | ✅ `.coderClaw/`                         | ❌                          | ⚠️ In-session only | ⚠️ In-session only | ❌                |
| **Works in WhatsApp / Telegram / Slack**   | ✅                                       | ❌                          | ❌                 | ❌                 | ❌                |
| **RBAC + audit trails**                    | ✅                                       | ❌                          | ❌                 | ❌                 | ❌                |
| **Open source (MIT)**                      | ✅                                       | ❌                          | ❌                 | ❌                 | ✅                |

CoderClaw is not a plugin or an IDE extension. It is a **full orchestration runtime** that understands your codebase, coordinates specialized agents, and works wherever you do — in your terminal, your chat apps, or your CI pipeline.

## 📁 Repository structure

This repository is organized so that the **CoderClaw product** (CLI, gateway, agents, docs) lives in one place; **apps** and **assets** are separate and shared, and can be built or used independently.

| Directory    | Purpose |
| ------------ | ------- |
| **`product/`** | All CoderClaw product code: CLI, gateway, agents, extensions, skills, tests. This is the main package you run and extend. |
| **`apps/`**    | Companion apps (e.g. Android, iOS, macOS) — shared, built separately from the product. |
| **`assets/`**  | Shared assets (images, branding). Used by product and apps. |
| **`docs-site/`** | Documentation site (now inside this repo). Source for [docs.coderclaw.ai](https://docs.coderclaw.ai). |

When you run CoderClaw (e.g. `coderclaw gateway` or `coderclaw agent`), it **only creates or updates files** in:

- **Project-local:** `<cwd>/.coderclaw/` — context, memory, sessions, personas, agents, skills for the project you’re in.
- **Global:** `~/.coderclaw/` (or `CODERCLAW_STATE_DIR`) — config, logs, models cache, credentials, daemon scripts, workspace data.

No other directories are written to by the product.

## 🔀 Running multiple CoderClaw instances (side-by-side versions)

You can run and install **two or more CoderClaw instances** on the same machine (e.g. one default, one for “work”, one for experiments). Each instance has its own config, port, state, and (when installed as a daemon) its own service name.

**How it works**

- **Install-path isolation** — State dir is derived from where CoderClaw is installed. Different installs (e.g. different npm/pnpm global roots) get different state dirs: `~/.coderclaw/<install-id>`. Run the v1 binary in terminal A and the v2 binary in terminal B; each gets its own `~/.coderclaw/<id>` and gateway. No env vars needed.
- **Legacy** — If you already have `~/.coderclaw` with `coderclaw.json`, that keeps working; new installs use the subdir.
- **Config** — Config is loaded from that state dir: `<state-dir>/coderclaw.json`. Override with `CODERCLAW_CONFIG_PATH` if needed.
- **Port** — Each instance must listen on a different port. Set `gateway.port` in that instance’s config (or `CODERCLAW_GATEWAY_PORT` when starting). Default is `18789`; use e.g. `18790` for a second instance.
- **Daemon (launchd / systemd / schtasks)** — When you install the gateway as a service, the **profile** (or state dir) is baked into the service: different profile → different state dir, script path, and service name (e.g. “CoderClaw Gateway (work)” on Windows, `coderclaw-gateway-work` on Linux, `ai.coderclaw.work` on macOS).
- **Gateway lock** — The lock file is keyed by config path, so multiple instances do not block each other.

**Ways to run a second instance**

1. **Different version in another terminal (automatic)** — Install another version (e.g. `pnpm add -g coderclaw@next`). In that terminal run `coderclaw gateway`. It uses `~/.coderclaw/<other-id>` and its own config/port. Set a different `gateway.port` in that config so it doesn't clash.

2. **Profile (same binary, different instance)** — `coderclaw --profile work gateway` → state dir `~/.coderclaw-work`; set port in `~/.coderclaw-work/coderclaw.json`. Or `CODERCLAW_PROFILE=work` in the env.

3. **Explicit state dir** — `CODERCLAW_STATE_DIR=~/.coderclaw-v2 coderclaw gateway` and a different port.

**Summary**

| What        | Default (single instance) | Second instance (e.g. profile `work`)      |
| ----------- | ------------------------- | ------------------------------------------ |
| State dir   | `~/.coderclaw`            | `~/.coderclaw-work`                        |
| Config      | `~/.coderclaw/coderclaw.json` | `~/.coderclaw-work/coderclaw.json`     |
| Port        | `18789` (or config)       | Set in that instance’s config (e.g. 18790) |
| Daemon name | “CoderClaw Gateway”       | “CoderClaw Gateway (work)” / `coderclaw-gateway-work` |

So: **two terminals, two versions** — run the right `coderclaw` in each and give each gateway a different port. They can't share one gateway; each gets its own state and port by install path (or by profile / `CODERCLAW_STATE_DIR` if you set them).

## 🎯 Core Mission

The complete software development lifecycle — planning, coding, reviewing, testing, debugging, refactoring, documenting — orchestrated by specialized agents that deeply understand your codebase. No IDE required. No cloud lock-in. Runs on your infra.

### Key Capabilities

**🧠 Deep Knowledge & Context Engine**

- **AST Parsing**: Extract semantic information from TypeScript/JavaScript code
- **Semantic Code Maps**: Track functions, classes, interfaces, dependencies
- **Dependency Graphs**: Understand file relationships and impact radius
- **Cross-File References**: Track imports, exports, and usage patterns
- **Git History Awareness**: Analyze evolution, blame, diffs, and change patterns
- **Persistent Context**: Maintain `.coderClaw/` directory with project knowledge

**🤖 Multi-Agent Orchestration**

- **Dynamic Agent Spawning**: Create specialized agents on-demand
- **Task Lifecycle Management**: Track status, dependencies, progress
- **Iterative Refinement**: Generate → Test → Debug → Re-run loops
- **Result Aggregation**: Combine outputs from multiple agents
- **Deterministic Execution**: Formal state machine with audit trails

**👨‍💻 Developer-Centric Agent Roles**

- **Code Creator**: Implements features and generates code
- **Code Reviewer**: Reviews for quality, security, performance
- **Test Generator**: Creates comprehensive test suites
- **Bug Analyzer**: Diagnoses and fixes bugs systematically
- **Refactor Agent**: Improves structure while preserving behavior
- **Documentation Agent**: Creates clear, helpful documentation
- **Architecture Advisor**: Provides high-level design guidance

**🔌 Extensible & Pluggable**

- Define custom agent roles via `.coderclaw/personas/`
- Community-extensible agent libraries
- Project-specific skills in `.coderClaw/skills/`
- Long-lived memory in `.coderClaw/memory/`

### Distributed Runtime

CoderClaw's distributed runtime ships fully production-ready:

- **Transport Abstraction Layer**: Protocol-agnostic local or remote execution via pluggable adapters
- **Distributed Task Lifecycle**: Formal state machine with validated transitions and complete audit trails
- **Identity & Security Model**: RBAC, device trust, granular policy enforcement
- **Enhanced Orchestrator**: Multi-claw team workflows with deterministic execution and capability-based routing

It connects to the channels you already use (WhatsApp, Telegram, Slack, Discord, Google Chat, Signal, iMessage, Microsoft Teams, WebChat), plus extension channels like BlueBubbles, Matrix, Zalo, and Zalo Personal. It can speak and listen on macOS/iOS/Android, and can render a live Canvas you control.

If you want to stop paying for Copilot subscriptions, escape the IDE tether, and run AI agents that actually orchestrate your full dev workflow — this is it.

[Website](https://coderclaw.ai) · [Docs](https://docs.coderclaw.ai) · [Vision](VISION.md) · [Multi-Agent System](docs/coderclaw.md) · [Examples](examples/coderclaw) · [Getting Started](https://docs.coderclaw.ai/start/getting-started) · [Updating](https://docs.coderclaw.ai/install/updating) · [Showcase](https://docs.coderclaw.ai/start/showcase) · [FAQ](https://docs.coderclaw.ai/start/faq) · [Discord](https://discord.gg/coderclaw)

## 🚀 Quick Start

### Installation

Runtime: **Node ≥22**.

**Optional — local brain:** If you enable the dual local brain (amygdala + hippocampus) during onboarding, CoderClaw downloads two ONNX models (SmolLM2 for routing, Qwen3-0.6B for planning). Total disk needed: **~3.5 GB** (~0.9 GB + ~2.3 GB). Ensure at least **4 GB free disk** before enabling.

```bash
npm install -g coderclaw@latest
# or: pnpm add -g coderclaw@latest

coderclaw onboard --install-daemon
```

The wizard installs the Gateway daemon (launchd/systemd user service) so it stays running.

### Initialize a CoderClaw Project

```bash
# Navigate to your project directory
cd my-project

# Initialize coderClaw context (interactive wizard)
coderclaw init

# This creates .coderClaw/ with:
#   - context.yaml     project metadata, languages, frameworks, dependencies
#   - architecture.md  design docs and patterns
#   - rules.yaml       coding standards and testing requirements
#   - personas/        custom agent roles/personas (YAML, community-extensible)
#   - skills/          project-specific skills
#   - memory/          persistent knowledge base and semantic indices
#   - sessions/        session handoff docs (resume any session instantly)

# Check project status
coderclaw project status
```

### Run Multi-Agent Workflows

```bash
# Start the gateway
coderclaw gateway --port 18789 --verbose

# Deep-analyze the codebase (AST + dependency graph + git history)
coderclaw agent --message "Analyze the codebase structure" --thinking high

# Planning workflow (start here for major features):
# Architecture Advisor → PRD → Architecture Spec → Task Breakdown
coderclaw agent --message "Plan a real-time collaboration feature" --thinking high

# Full feature development workflow:
# Architecture Advisor → Code Creator → Test Generator + Code Reviewer (parallel)
coderclaw agent --message "Create a user authentication feature with tests and review" --thinking high

# Bug fix workflow: Bug Analyzer → Code Creator → Test Generator + Code Reviewer
coderclaw agent --message "Fix the memory leak in the parser" --thinking high

# Refactor workflow: Code Reviewer → Refactor Agent → Test Generator
coderclaw agent --message "Refactor the authentication module" --thinking high

# Adversarial review (built-in critique pass — no external tool needed):
# Architecture Advisor (Proposal) → Code Reviewer (Critique) → Architecture Advisor (Revised)
coderclaw agent --message "Adversarially review the API authentication design" --thinking high

# Save a session handoff so the next session picks up right where you left off
coderclaw agent --message "Save a session handoff for what we accomplished today" --thinking low
```

### Access CoderClaw from Messaging Channels

Send messages to your connected channels (WhatsApp, Telegram, Slack, Discord, etc.):

```
@coderclaw analyze the dependency graph for src/api/

@coderclaw create a refactoring plan for the authentication module

@coderclaw review the latest changes for security issues
```

Upgrading? [Updating guide](https://docs.coderclaw.ai/install/updating) (and run `coderclaw doctor`).

## 🏗️ Project Structure

When you initialize a coderClaw project, it creates a `.coderClaw/` directory:

```
.coderClaw/
├── context.yaml          # Project metadata, languages, frameworks, dependencies
├── architecture.md       # Architectural documentation and design patterns
├── rules.yaml           # Coding standards, testing requirements, git conventions
├── personas/            # Custom agent roles/personas (community-extensible)
│   └── custom-agent.yaml
├── skills/              # Project-specific skills
│   └── project-skill.ts
├── memory/              # Persistent project knowledge and semantic indices
│   └── semantic-index.db
└── sessions/            # Session handoff docs — resume any session instantly
    └── <session-id>.yaml
```

This persistent context enables deep codebase understanding and intelligent agent coordination.

**Subscriptions (OAuth):**

- **[Anthropic](https://www.anthropic.com/)** (Claude Pro/Max)
- **[OpenAI](https://openai.com/)** (ChatGPT/Codex)

Model note: while any model is supported, the default is **CoderClawLLM (`coderclawllm/auto`)** for a managed free-model pool with automatic failover. See [Onboarding](https://docs.coderclaw.ai/start/onboarding).

## Models (selection + auth)

- Models config + CLI: [Models](https://docs.coderclaw.ai/concepts/models)
- Auth profile rotation (OAuth vs API keys) + fallbacks: [Model failover](https://docs.coderclaw.ai/concepts/model-failover)

## Install (recommended)

Runtime: **Node ≥22**.

```bash
npm install -g coderclaw@latest
# or: pnpm add -g coderclaw@latest

coderclaw onboard --install-daemon
```

The wizard installs the Gateway daemon (launchd/systemd user service) so it stays running.

## Quick start (TL;DR)

Runtime: **Node ≥22**.

Full beginner guide (auth, pairing, channels): [Getting started](https://docs.coderclaw.ai/start/getting-started)

```bash
coderclaw onboard --install-daemon

# Initialize coderClaw in your project
coderclaw init

coderclaw gateway --port 18789 --verbose

# Deep-analyze your codebase
coderclaw agent --message "Analyze the codebase structure" --thinking high

# Ship a feature end-to-end
coderclaw agent --message "Create a user authentication feature with tests and review" --thinking high
```

Upgrading? [Updating guide](https://docs.coderclaw.ai/install/updating) (and run `coderclaw doctor`).

## Development channels

- **stable**: tagged releases (`vYYYY.M.D` or `vYYYY.M.D-<patch>`), npm dist-tag `latest`.
- **beta**: prerelease tags (`vYYYY.M.D-beta.N`), npm dist-tag `beta` (macOS app may be missing).
- **dev**: moving head of `main`, npm dist-tag `dev` (when published).

Switch channels (git + npm): `coderclaw update --channel stable|beta|dev`.
Details: [Development channels](https://docs.coderclaw.ai/install/development-channels).

## From source (development)

Prefer `pnpm` for builds from source. Bun is optional for running TypeScript directly.

```bash
git clone https://github.com/SeanHogg/coderClaw.git
cd coderClaw

pnpm install
pnpm ui:build # auto-installs UI deps on first run
pnpm build

pnpm coderclaw onboard --install-daemon

# Dev loop (auto-reload on TS changes)
pnpm gateway:watch
```

Note: `pnpm coderclaw ...` runs TypeScript directly (via `tsx`). `pnpm build` produces `dist/` for running via Node / the packaged `coderclaw` binary.

## Security defaults (DM access)

CoderClaw connects to real messaging surfaces. Treat inbound DMs as **untrusted input**.

Full security guide: [Security](https://docs.coderclaw.ai/gateway/security)

Default behavior on Telegram/WhatsApp/Signal/iMessage/Microsoft Teams/Discord/Google Chat/Slack:

- **DM pairing** (`dmPolicy="pairing"` / `channels.discord.dmPolicy="pairing"` / `channels.slack.dmPolicy="pairing"`; legacy: `channels.discord.dm.policy`, `channels.slack.dm.policy`): unknown senders receive a short pairing code and the bot does not process their message.
- Approve with: `coderclaw pairing approve <channel> <code>` (then the sender is added to a local allowlist store).
- Public inbound DMs require an explicit opt-in: set `dmPolicy="open"` and include `"*"` in the channel allowlist (`allowFrom` / `channels.discord.allowFrom` / `channels.slack.allowFrom`; legacy: `channels.discord.dm.allowFrom`, `channels.slack.dm.allowFrom`).

Run `coderclaw doctor` to surface risky/misconfigured DM policies.

## Highlights

- **[Local-first Gateway](https://docs.coderclaw.ai/gateway)** — single control plane for sessions, channels, tools, and events.
- **[Multi-channel inbox](https://docs.coderclaw.ai/channels)** — WhatsApp, Telegram, Slack, Discord, Google Chat, Signal, BlueBubbles (iMessage), iMessage (legacy), Microsoft Teams, Matrix, Zalo, Zalo Personal, WebChat, macOS, iOS/Android.
- **[Multi-agent routing](https://docs.coderclaw.ai/gateway/configuration)** — route inbound channels/accounts/peers to isolated agents (workspaces + per-agent sessions).
- **[Voice Wake](https://docs.coderclaw.ai/nodes/voicewake) + [Talk Mode](https://docs.coderclaw.ai/nodes/talk)** — always-on speech for macOS/iOS/Android with ElevenLabs.
- **[Live Canvas](https://docs.coderclaw.ai/platforms/mac/canvas)** — agent-driven visual workspace with [A2UI](https://docs.coderclaw.ai/platforms/mac/canvas#canvas-a2ui).
- **[First-class tools](https://docs.coderclaw.ai/tools)** — browser, canvas, nodes, cron, sessions, and Discord/Slack actions.
- **[Companion apps](https://docs.coderclaw.ai/platforms/macos)** — macOS menu bar app + iOS/Android [nodes](https://docs.coderclaw.ai/nodes).
- **[Onboarding](https://docs.coderclaw.ai/start/wizard) + [skills](https://docs.coderclaw.ai/tools/skills)** — wizard-driven setup with bundled/managed/workspace skills.

## CoderClaw Distributed Runtime

**Distributed AI Runtime & Secure Control Mesh** — All four pillars are production-ready and shipping today:

### 🔄 Transport Abstraction Layer

- **Protocol-agnostic runtime interface** for submitting tasks locally or remotely
- **Pluggable adapter system** — swap local, HTTP, WebSocket, or gRPC adapters without changing application code
- **ClawLink HTTP adapter** included for zero-boilerplate remote execution
- **Runtime status monitoring** with agent and skill discovery

### 📊 Distributed Task Lifecycle

- **Formal state machine** with validated transitions (PENDING → PLANNING → RUNNING → COMPLETED)
- **Long-running job persistence** with resumable execution after restart
- **Complete audit trail** with structured event logs per task
- **Task relationships** supporting parent/child hierarchies
- **Progress tracking** with real-time streaming updates

### 🔐 Identity & Security Model

- **Multi-provider authentication**: OIDC, GitHub, Google, Local
- **Device trust levels**: trusted, verified, untrusted
- **Role-based access control (RBAC)** with built-in roles (admin, developer, readonly, ci)
- **Granular permissions system** at session, agent, skill, and repo levels
- **Comprehensive audit logging** for all security events

### 🎯 Enhanced Orchestrator

- **Capability-based claw routing**: `remote:auto` selects the best available peer; `remote:auto[gpu,high-memory]` requires specific capabilities
- **Explicit target routing**: `remote:<clawId>` delegates to a named peer
- **Distributed task engine integration** with full backward compatibility
- **Deterministic execution** with workflow pattern preservation
- **CI/CD integration ready** for automated pipelines

See [examples/phase2/](examples/phase2/) for distributed runtime usage examples.

**Status**: Fully shipped — 194+ passing tests, backward compatible, zero breaking changes.

## 🔗 CoderClawLink

**[Builderforce.ai](https://builderforce.ai)** is the orchestration portal (API: api.builderforce.ai). CoderClaw connects to it via the built-in **ClawLink transport adapter** — your multi-agent workflows run seamlessly on Builderforce with zero protocol boilerplate:

```typescript
import { ClawLinkTransportAdapter, CoderClawRuntime } from "coderclaw/transport";

const adapter = new ClawLinkTransportAdapter({ baseUrl: "http://localhost:8000" });
await adapter.connect();
const runtime = new CoderClawRuntime(adapter, "remote-enabled");

// Planning, feature, adversarial-review workflows all run on the ClawLink node
const state = await runtime.submitTask({
  agentId: "claude",
  description: "Plan auth feature",
  input: "...",
});
```

Full guide: [Builderforce Integration](https://docs.coderclaw.ai/coderclaw-link)

### Builderforce in the coderClaw.ai Ecosystem

CoderClaw **leverages [Builderforce.ai](https://builderforce.ai)** as the **centralized orchestration portal** (API: api.builderforce.ai). Builderforce **replaces Jira** by giving teams full visibility into AI-driven workflows — workflow visibility, auditability, and human-in-the-loop control.

```
+-------------------------------------------------------------+
|                      coderClaw.ai Platform                  |
|                                                             |
|  +-----------------+   +------------------------------+    |
|  |  coderClaw      |   |  Builderforce.ai             |    |
|  |  (core agent)   |<->|  (orchestration portal)      |    |
|  |                 |   |  builderforce.ai             |    |
|  |  Self-healing   |   |  api.builderforce.ai         |    |
|  |  Multi-agent    |   |                              |    |
|  |  Persistent mem |   |  Projects, Tasks, Agents     |    |
|  +--------+--------+   |  Runtime, Audit, RBAC        |    |
|           |            +--------------+---------------+    |
|           |                           |                     |
|  +--------+--------------------------+---------------+     |
|  |              coderClawLLM                         |     |
|  |  Pay-per-use AI agent compute API                 |     |
|  |  Free model pool, Pro model pool, Usage metrics   |     |
|  +---------------------------------------------------+     |
+-------------------------------------------------------------+
```

**Builderforce provides:**

- Workflow visibility and auditability for all agent actions
- Human-in-the-loop control with approval gates at every autonomous step
- Seamless adoption across teams of any size — no workflow disruption
- RBAC-enforced multi-tenancy for enterprise governance
- Full execution history and immutable audit log for compliance

### Self-Healing Agent Execution

coderClaw.ai agents monitor their own execution state. When a task fails, the system automatically diagnoses the failure, attempts remediation, and escalates to human review only when it cannot self-repair. The execution lifecycle is tracked end-to-end:

```
PENDING -> SUBMITTED -> RUNNING -> COMPLETED
    |           |           |
    +---------> +---------> +-> FAILED  (auto-remediation attempted)
    |           |           |
    +---------> +---------> +-> CANCELLED
```

Any state before completion can be cancelled; failure triggers automatic remediation before escalating to human review.

### CI/CD Integration

Builderforce integrates with existing CI/CD workflows. Agents can be triggered on PR events, push events, or scheduled jobs. Execution state callbacks allow CI runners to report progress and attach code-change telemetry:

```bash
# Submit task for execution from a CI/CD pipeline
curl -X POST https://api.builderforce.ai/api/runtime/executions \
  -H "Authorization: Bearer $CODERCLAW_TOKEN" \
  -d '{"taskId": "...", "agentId": "...", "input": "Review PR #42"}'

# Agent reports completion back
curl -X PATCH https://api.builderforce.ai/api/runtime/executions/$ID/state \
  -d '{"state": "completed", "output": "Review complete: 3 issues found"}'
```

### Private & Self-Hosted Deployments

For compliance-sensitive or air-gapped environments, Builderforce provides Docker-based self-hosted deployment:

```bash
# Self-hosted via Docker Compose (dev, deploy, or migrate profiles)
docker compose --profile deploy up
```

The entire platform can run on Cloudflare Workers (zero cold-start, globally distributed) backed by your own Postgres database, or entirely on-premises using the provided Dockerfile.

### Builderforce API Reference (Summary)

All protected routes require `Authorization: Bearer <jwt>`.

| Route                                     | Description                                |
| ----------------------------------------- | ------------------------------------------ |
| `POST /api/auth/register`                 | Create user + receive one-time API key     |
| `POST /api/auth/token`                    | Exchange API key for JWT                   |
| `GET/POST /api/projects`                  | List or create projects                    |
| `GET/POST /api/tasks`                     | List or create tasks                       |
| `POST /api/runtime/executions`            | Submit task for agent execution            |
| `PATCH /api/runtime/executions/:id/state` | Agent callback: update execution state     |
| `GET /api/audit/events`                   | Tenant-wide immutable event log (MANAGER+) |
| `GET /api/agents`                         | Discover registered agents and skills      |
| `POST /llm/v1/chat/completions`           | coderClawLLM proxy (free/pro model pools)  |

RBAC roles (ascending authority): `viewer` -> `developer` -> `manager` -> `owner`

## coderClawLLM — AI Agent Compute API

coderClawLLM is the **pay-per-use API layer** for AI agent compute, built into Builderforce:

| Feature               | Detail                                                                      |
| --------------------- | --------------------------------------------------------------------------- |
| Free model pool       | Shared, rate-limited pool for development and low-volume workloads          |
| Pro model pool        | Dedicated, higher-capacity models for production agent pipelines            |
| OpenAI-compatible API | Use `https://api.builderforce.ai/llm/v1` as the `baseURL` in any OpenAI SDK |
| Tenant-aware billing  | Usage tracked per tenant and per user (`GET /llm/v1/usage`)                 |
| Automatic failover    | Model routing handles provider outages transparently                        |

Agents authenticate with the same JWT issued by `POST /api/auth/token` — no separate credential management needed. The default model is `coderclawllm/auto` for a managed free-model pool with automatic failover.

## Who Uses coderClaw.ai?

### Startups (5–50 developers)

Use coderClaw.ai as a **virtual AI workforce**: a small human team coordinates a fleet of AI agents that handle code generation, review, testing, and documentation — with Builderforce as the task board and audit trail. A free tier is available; see [coderclaw.ai](https://coderclaw.ai) for pricing.

### Enterprises (100–1,000+ developers)

Run **complex multi-agent pipelines** at scale: parallel execution across hundreds of repositories, strict RBAC for department-level isolation, full audit trails for compliance (SOC 2, HIPAA-adjacent workflows), and private/self-hosted deployment options. Adoption is seamless — Builderforce slots in as the orchestration layer without disrupting existing developer tooling.

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=SeanHogg/coderClaw&type=date&legend=top-left)](https://www.star-history.com/#SeanHogg/coderClaw&type=date&legend=top-left)

## Everything we built so far

### Core platform

- [Gateway WS control plane](https://docs.coderclaw.ai/gateway) with sessions, presence, config, cron, webhooks, [Control UI](https://docs.coderclaw.ai/web), and [Canvas host](https://docs.coderclaw.ai/platforms/mac/canvas#canvas-a2ui).
- [CLI surface](https://docs.coderclaw.ai/tools/agent-send): gateway, agent, send, [wizard](https://docs.coderclaw.ai/start/wizard), and [doctor](https://docs.coderclaw.ai/gateway/doctor).
- [Pi agent runtime](https://docs.coderclaw.ai/concepts/agent) in RPC mode with tool streaming and block streaming.
- [Session model](https://docs.coderclaw.ai/concepts/session): `main` for direct chats, group isolation, activation modes, queue modes, reply-back. Group rules: [Groups](https://docs.coderclaw.ai/concepts/groups).
- [Media pipeline](https://docs.coderclaw.ai/nodes/images): images/audio/video, transcription hooks, size caps, temp file lifecycle. Audio details: [Audio](https://docs.coderclaw.ai/nodes/audio).

### Channels

- [Channels](https://docs.coderclaw.ai/channels): [WhatsApp](https://docs.coderclaw.ai/channels/whatsapp) (Baileys), [Telegram](https://docs.coderclaw.ai/channels/telegram) (grammY), [Slack](https://docs.coderclaw.ai/channels/slack) (Bolt), [Discord](https://docs.coderclaw.ai/channels/discord) (discord.js), [Google Chat](https://docs.coderclaw.ai/channels/googlechat) (Chat API), [Signal](https://docs.coderclaw.ai/channels/signal) (signal-cli), [BlueBubbles](https://docs.coderclaw.ai/channels/bluebubbles) (iMessage, recommended), [iMessage](https://docs.coderclaw.ai/channels/imessage) (legacy imsg), [Microsoft Teams](https://docs.coderclaw.ai/channels/msteams) (extension), [Matrix](https://docs.coderclaw.ai/channels/matrix) (extension), [Zalo](https://docs.coderclaw.ai/channels/zalo) (extension), [Zalo Personal](https://docs.coderclaw.ai/channels/zalouser) (extension), [WebChat](https://docs.coderclaw.ai/web/webchat).
- [Group routing](https://docs.coderclaw.ai/concepts/group-messages): mention gating, reply tags, per-channel chunking and routing. Channel rules: [Channels](https://docs.coderclaw.ai/channels).

### Apps + nodes

- [macOS app](https://docs.coderclaw.ai/platforms/macos): menu bar control plane, [Voice Wake](https://docs.coderclaw.ai/nodes/voicewake)/PTT, [Talk Mode](https://docs.coderclaw.ai/nodes/talk) overlay, [WebChat](https://docs.coderclaw.ai/web/webchat), debug tools, [remote gateway](https://docs.coderclaw.ai/gateway/remote) control.
- [iOS node](https://docs.coderclaw.ai/platforms/ios): [Canvas](https://docs.coderclaw.ai/platforms/mac/canvas), [Voice Wake](https://docs.coderclaw.ai/nodes/voicewake), [Talk Mode](https://docs.coderclaw.ai/nodes/talk), camera, screen recording, Bonjour pairing.
- [Android node](https://docs.coderclaw.ai/platforms/android): [Canvas](https://docs.coderclaw.ai/platforms/mac/canvas), [Talk Mode](https://docs.coderclaw.ai/nodes/talk), camera, screen recording, optional SMS.
- [macOS node mode](https://docs.coderclaw.ai/nodes): system.run/notify + canvas/camera exposure.

### Tools + automation

- [Browser control](https://docs.coderclaw.ai/tools/browser): dedicated coderclaw Chrome/Chromium, snapshots, actions, uploads, profiles.
- [Canvas](https://docs.coderclaw.ai/platforms/mac/canvas): [A2UI](https://docs.coderclaw.ai/platforms/mac/canvas#canvas-a2ui) push/reset, eval, snapshot.
- [Nodes](https://docs.coderclaw.ai/nodes): camera snap/clip, screen record, [location.get](https://docs.coderclaw.ai/nodes/location-command), notifications.
- [Cron + wakeups](https://docs.coderclaw.ai/automation/cron-jobs); [webhooks](https://docs.coderclaw.ai/automation/webhook); [Gmail Pub/Sub](https://docs.coderclaw.ai/automation/gmail-pubsub).
- [Skills platform](https://docs.coderclaw.ai/tools/skills): bundled, managed, and workspace skills with install gating + UI.

### Runtime + safety

- [Channel routing](https://docs.coderclaw.ai/concepts/channel-routing), [retry policy](https://docs.coderclaw.ai/concepts/retry), and [streaming/chunking](https://docs.coderclaw.ai/concepts/streaming).
- [Presence](https://docs.coderclaw.ai/concepts/presence), [typing indicators](https://docs.coderclaw.ai/concepts/typing-indicators), and [usage tracking](https://docs.coderclaw.ai/concepts/usage-tracking).
- [Models](https://docs.coderclaw.ai/concepts/models), [model failover](https://docs.coderclaw.ai/concepts/model-failover), and [session pruning](https://docs.coderclaw.ai/concepts/session-pruning).
- [Security](https://docs.coderclaw.ai/gateway/security) and [troubleshooting](https://docs.coderclaw.ai/channels/troubleshooting).

### Ops + packaging

- [Control UI](https://docs.coderclaw.ai/web) + [WebChat](https://docs.coderclaw.ai/web/webchat) served directly from the Gateway.
- [Tailscale Serve/Funnel](https://docs.coderclaw.ai/gateway/tailscale) or [SSH tunnels](https://docs.coderclaw.ai/gateway/remote) with token/password auth.
- [Nix mode](https://docs.coderclaw.ai/install/nix) for declarative config; [Docker](https://docs.coderclaw.ai/install/docker)-based installs.
- [Doctor](https://docs.coderclaw.ai/gateway/doctor) migrations, [logging](https://docs.coderclaw.ai/logging).

## How it works (short)

```
WhatsApp / Telegram / Slack / Discord / Google Chat / Signal / iMessage / BlueBubbles / Microsoft Teams / Matrix / Zalo / Zalo Personal / WebChat
               │
               ▼
┌───────────────────────────────┐
│            Gateway            │
│       (control plane)         │
│     ws://127.0.0.1:18789      │
└──────────────┬────────────────┘
               │
               ├─ Pi agent (RPC)
               ├─ CLI (coderclaw …)
               ├─ WebChat UI
               ├─ macOS app
               └─ iOS / Android nodes
```

## Key subsystems

- **[Gateway WebSocket network](https://docs.coderclaw.ai/concepts/architecture)** — single WS control plane for clients, tools, and events (plus ops: [Gateway runbook](https://docs.coderclaw.ai/gateway)).
- **[Tailscale exposure](https://docs.coderclaw.ai/gateway/tailscale)** — Serve/Funnel for the Gateway dashboard + WS (remote access: [Remote](https://docs.coderclaw.ai/gateway/remote)).
- **[Browser control](https://docs.coderclaw.ai/tools/browser)** — coderclaw‑managed Chrome/Chromium with CDP control.
- **[Canvas + A2UI](https://docs.coderclaw.ai/platforms/mac/canvas)** — agent‑driven visual workspace (A2UI host: [Canvas/A2UI](https://docs.coderclaw.ai/platforms/mac/canvas#canvas-a2ui)).
- **[Voice Wake](https://docs.coderclaw.ai/nodes/voicewake) + [Talk Mode](https://docs.coderclaw.ai/nodes/talk)** — always‑on speech and continuous conversation.
- **[Nodes](https://docs.coderclaw.ai/nodes)** — Canvas, camera snap/clip, screen record, `location.get`, notifications, plus macOS‑only `system.run`/`system.notify`.

## Tailscale access (Gateway dashboard)

CoderClaw can auto-configure Tailscale **Serve** (tailnet-only) or **Funnel** (public) while the Gateway stays bound to loopback. Configure `gateway.tailscale.mode`:

- `off`: no Tailscale automation (default).
- `serve`: tailnet-only HTTPS via `tailscale serve` (uses Tailscale identity headers by default).
- `funnel`: public HTTPS via `tailscale funnel` (requires shared password auth).

Notes:

- `gateway.bind` must stay `loopback` when Serve/Funnel is enabled (CoderClaw enforces this).
- Serve can be forced to require a password by setting `gateway.auth.mode: "password"` or `gateway.auth.allowTailscale: false`.
- Funnel refuses to start unless `gateway.auth.mode: "password"` is set.
- Optional: `gateway.tailscale.resetOnExit` to undo Serve/Funnel on shutdown.

Details: [Tailscale guide](https://docs.coderclaw.ai/gateway/tailscale) · [Web surfaces](https://docs.coderclaw.ai/web)

## Remote Gateway (Linux is great)

It’s perfectly fine to run the Gateway on a small Linux instance. Clients (macOS app, CLI, WebChat) can connect over **Tailscale Serve/Funnel** or **SSH tunnels**, and you can still pair device nodes (macOS/iOS/Android) to execute device‑local actions when needed.

- **Gateway host** runs the exec tool and channel connections by default.
- **Device nodes** run device‑local actions (`system.run`, camera, screen recording, notifications) via `node.invoke`.
  In short: exec runs where the Gateway lives; device actions run where the device lives.

Details: [Remote access](https://docs.coderclaw.ai/gateway/remote) · [Nodes](https://docs.coderclaw.ai/nodes) · [Security](https://docs.coderclaw.ai/gateway/security)

## macOS permissions via the Gateway protocol

The macOS app can run in **node mode** and advertises its capabilities + permission map over the Gateway WebSocket (`node.list` / `node.describe`). Clients can then execute local actions via `node.invoke`:

- `system.run` runs a local command and returns stdout/stderr/exit code; set `needsScreenRecording: true` to require screen-recording permission (otherwise you’ll get `PERMISSION_MISSING`).
- `system.notify` posts a user notification and fails if notifications are denied.
- `canvas.*`, `camera.*`, `screen.record`, and `location.get` are also routed via `node.invoke` and follow TCC permission status.

Elevated bash (host permissions) is separate from macOS TCC:

- Use `/elevated on|off` to toggle per‑session elevated access when enabled + allowlisted.
- Gateway persists the per‑session toggle via `sessions.patch` (WS method) alongside `thinkingLevel`, `verboseLevel`, `model`, `sendPolicy`, and `groupActivation`.

Details: [Nodes](https://docs.coderclaw.ai/nodes) · [macOS app](https://docs.coderclaw.ai/platforms/macos) · [Gateway protocol](https://docs.coderclaw.ai/concepts/architecture)

## Agent to Agent (sessions\_\* tools)

- Use these to coordinate work across sessions without jumping between chat surfaces.
- `sessions_list` — discover active sessions (agents) and their metadata.
- `sessions_history` — fetch transcript logs for a session.
- `sessions_send` — message another session; optional reply‑back ping‑pong + announce step (`REPLY_SKIP`, `ANNOUNCE_SKIP`).

Details: [Session tools](https://docs.coderclaw.ai/concepts/session-tool)

## Skills registry (ClawHub)

ClawHub is a minimal skill registry. With ClawHub enabled, the agent can search for skills automatically and pull in new ones as needed.

By default CoderClaw points at the public ClawHub service, but the registry endpoint and even the CLI hint are configurable via `skills.registry` in your config – this makes it easy to support self‑hosted OpenClaw registries or forks.

[ClawHub](https://clawhub.com)

## Chat commands

Send these in WhatsApp/Telegram/Slack/Google Chat/Microsoft Teams/WebChat (group commands are owner-only):

- `/status` — compact session status (model + tokens, cost when available)
- `/new` or `/reset` — reset the session
- `/compact` — compact session context (summary)
- `/think <level>` — off|minimal|low|medium|high|xhigh (GPT-5.2 + Codex models only)
- `/verbose on|off`
- `/usage off|tokens|full` — per-response usage footer
- `/restart` — restart the gateway (owner-only in groups)
- `/activation mention|always` — group activation toggle (groups only)

## Apps (optional)

The Gateway alone delivers a great experience. All apps are optional and add extra features.

If you plan to build/run companion apps, follow the platform runbooks below.

### macOS (CoderClaw.app) (optional)

- Menu bar control for the Gateway and health.
- Voice Wake + push-to-talk overlay.
- WebChat + debug tools.
- Remote gateway control over SSH.

Note: signed builds required for macOS permissions to stick across rebuilds (see `docs/mac/permissions.md`).

### iOS node (optional)

- Pairs as a node via the Bridge.
- Voice trigger forwarding + Canvas surface.
- Controlled via `coderclaw nodes …`.

Runbook: [iOS connect](https://docs.coderclaw.ai/platforms/ios).

### Android node (optional)

- Pairs via the same Bridge + pairing flow as iOS.
- Exposes Canvas, Camera, and Screen capture commands.
- Runbook: [Android connect](https://docs.coderclaw.ai/platforms/android).

## Agent workspace + skills

- Workspace root: `~/.coderclaw/workspace` (configurable via `agents.defaults.workspace`).
- Injected prompt files: `AGENTS.md`, `SOUL.md`, `TOOLS.md`.
- Skills: `~/.coderclaw/workspace/skills/<skill>/SKILL.md`.

## Configuration

Minimal `~/.coderclaw/coderclaw.json` (model + defaults):

```json5
{
  agent: {
    model: "coderclawllm/auto",
  },
}
```

[Full configuration reference (all keys + examples).](https://docs.coderclaw.ai/gateway/configuration)

## Security model (important)

- **Default:** tools run on the host for the **main** session, so the agent has full access when it’s just you.
- **Group/channel safety:** set `agents.defaults.sandbox.mode: "non-main"` to run **non‑main sessions** (groups/channels) inside per‑session Docker sandboxes; bash then runs in Docker for those sessions.
- **Sandbox defaults:** allowlist `bash`, `process`, `read`, `write`, `edit`, `sessions_list`, `sessions_history`, `sessions_send`, `sessions_spawn`; denylist `browser`, `canvas`, `nodes`, `cron`, `discord`, `gateway`.

Details: [Security guide](https://docs.coderclaw.ai/gateway/security) · [Docker + sandboxing](https://docs.coderclaw.ai/install/docker) · [Sandbox config](https://docs.coderclaw.ai/gateway/configuration)

### [WhatsApp](https://docs.coderclaw.ai/channels/whatsapp)

- Link the device: `pnpm coderclaw channels login` (stores creds in `~/.coderclaw/credentials`).
- Allowlist who can talk to the assistant via `channels.whatsapp.allowFrom`.
- If `channels.whatsapp.groups` is set, it becomes a group allowlist; include `"*"` to allow all.

### [Telegram](https://docs.coderclaw.ai/channels/telegram)

- Set `TELEGRAM_BOT_TOKEN` or `channels.telegram.botToken` (env wins).
- Optional: set `channels.telegram.groups` (with `channels.telegram.groups."*".requireMention`); when set, it is a group allowlist (include `"*"` to allow all). Also `channels.telegram.allowFrom` or `channels.telegram.webhookUrl` + `channels.telegram.webhookSecret` as needed.

```json5
{
  channels: {
    telegram: {
      botToken: "123456:ABCDEF",
    },
  },
}
```

### [Slack](https://docs.coderclaw.ai/channels/slack)

- Set `SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN` (or `channels.slack.botToken` + `channels.slack.appToken`).

### [Discord](https://docs.coderclaw.ai/channels/discord)

- Set `DISCORD_BOT_TOKEN` or `channels.discord.token` (env wins).
- Optional: set `commands.native`, `commands.text`, or `commands.useAccessGroups`, plus `channels.discord.allowFrom`, `channels.discord.guilds`, or `channels.discord.mediaMaxMb` as needed.

```json5
{
  channels: {
    discord: {
      token: "1234abcd",
    },
  },
}
```

### [Signal](https://docs.coderclaw.ai/channels/signal)

- Requires `signal-cli` and a `channels.signal` config section.

### [BlueBubbles (iMessage)](https://docs.coderclaw.ai/channels/bluebubbles)

- **Recommended** iMessage integration.
- Configure `channels.bluebubbles.serverUrl` + `channels.bluebubbles.password` and a webhook (`channels.bluebubbles.webhookPath`).
- The BlueBubbles server runs on macOS; the Gateway can run on macOS or elsewhere.

### [iMessage (legacy)](https://docs.coderclaw.ai/channels/imessage)

- Legacy macOS-only integration via `imsg` (Messages must be signed in).
- If `channels.imessage.groups` is set, it becomes a group allowlist; include `"*"` to allow all.

### [Microsoft Teams](https://docs.coderclaw.ai/channels/msteams)

- Configure a Teams app + Bot Framework, then add a `msteams` config section.
- Allowlist who can talk via `msteams.allowFrom`; group access via `msteams.groupAllowFrom` or `msteams.groupPolicy: "open"`.

### [WebChat](https://docs.coderclaw.ai/web/webchat)

- Uses the Gateway WebSocket; no separate WebChat port/config.

Browser control (optional):

```json5
{
  browser: {
    enabled: true,
    color: "#FF4500",
  },
}
```

## Docs

Use these when you’re past the onboarding flow and want the deeper reference.

- [Start with the docs index for navigation and “what’s where.”](https://docs.coderclaw.ai)
- [Read the architecture overview for the gateway + protocol model.](https://docs.coderclaw.ai/concepts/architecture)
- [Use the full configuration reference when you need every key and example.](https://docs.coderclaw.ai/gateway/configuration)
- [Run the Gateway by the book with the operational runbook.](https://docs.coderclaw.ai/gateway)
- [Learn how the Control UI/Web surfaces work and how to expose them safely.](https://docs.coderclaw.ai/web)
- [Understand remote access over SSH tunnels or tailnets.](https://docs.coderclaw.ai/gateway/remote)
- [Follow the onboarding wizard flow for a guided setup.](https://docs.coderclaw.ai/start/wizard)
- [Wire external triggers via the webhook surface.](https://docs.coderclaw.ai/automation/webhook)
- [Set up Gmail Pub/Sub triggers.](https://docs.coderclaw.ai/automation/gmail-pubsub)
- [Learn the macOS menu bar companion details.](https://docs.coderclaw.ai/platforms/mac/menu-bar)
- [Platform guides: Windows (WSL2)](https://docs.coderclaw.ai/platforms/windows), [Linux](https://docs.coderclaw.ai/platforms/linux), [macOS](https://docs.coderclaw.ai/platforms/macos), [iOS](https://docs.coderclaw.ai/platforms/ios), [Android](https://docs.coderclaw.ai/platforms/android)
- [Debug common failures with the troubleshooting guide.](https://docs.coderclaw.ai/channels/troubleshooting)
- [Review security guidance before exposing anything.](https://docs.coderclaw.ai/gateway/security)

## Advanced docs (discovery + control)

- [Discovery + transports](https://docs.coderclaw.ai/gateway/discovery)
- [Bonjour/mDNS](https://docs.coderclaw.ai/gateway/bonjour)
- [Gateway pairing](https://docs.coderclaw.ai/gateway/pairing)
- [Remote gateway README](https://docs.coderclaw.ai/gateway/remote-gateway-readme)
- [Control UI](https://docs.coderclaw.ai/web/control-ui)
- [Dashboard](https://docs.coderclaw.ai/web/dashboard)

## Operations & troubleshooting

- [Health checks](https://docs.coderclaw.ai/gateway/health)
- [Gateway lock](https://docs.coderclaw.ai/gateway/gateway-lock)
- [Background process](https://docs.coderclaw.ai/gateway/background-process)
- [Browser troubleshooting (Linux)](https://docs.coderclaw.ai/tools/browser-linux-troubleshooting)
- [Logging](https://docs.coderclaw.ai/logging)

## Deep dives

- [Agent loop](https://docs.coderclaw.ai/concepts/agent-loop)
- [Presence](https://docs.coderclaw.ai/concepts/presence)
- [TypeBox schemas](https://docs.coderclaw.ai/concepts/typebox)
- [RPC adapters](https://docs.coderclaw.ai/reference/rpc)
- [Queue](https://docs.coderclaw.ai/concepts/queue)

## Workspace & skills

- [Skills config](https://docs.coderclaw.ai/tools/skills-config)
- [Default AGENTS](https://docs.coderclaw.ai/reference/AGENTS.default)
- [Templates: AGENTS](https://docs.coderclaw.ai/reference/templates/AGENTS)
- [Templates: BOOTSTRAP](https://docs.coderclaw.ai/reference/templates/BOOTSTRAP)
- [Templates: IDENTITY](https://docs.coderclaw.ai/reference/templates/IDENTITY)
- [Templates: SOUL](https://docs.coderclaw.ai/reference/templates/SOUL)
- [Templates: TOOLS](https://docs.coderclaw.ai/reference/templates/TOOLS)
- [Templates: USER](https://docs.coderclaw.ai/reference/templates/USER)

## Platform internals

- [macOS dev setup](https://docs.coderclaw.ai/platforms/mac/dev-setup)
- [macOS menu bar](https://docs.coderclaw.ai/platforms/mac/menu-bar)
- [macOS voice wake](https://docs.coderclaw.ai/platforms/mac/voicewake)
- [iOS node](https://docs.coderclaw.ai/platforms/ios)
- [Android node](https://docs.coderclaw.ai/platforms/android)
- [Windows (WSL2)](https://docs.coderclaw.ai/platforms/windows)
- [Linux app](https://docs.coderclaw.ai/platforms/linux)

## Email hooks (Gmail)

- [docs.coderclaw.ai/gmail-pubsub](https://docs.coderclaw.ai/automation/gmail-pubsub)

## Community

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines, maintainers, and how to submit PRs.
AI/vibe-coded PRs welcome! 🤖
