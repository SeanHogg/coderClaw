# CoderClaw Architecture — Agent Reference

> Last updated: 2026-03-04  
> Human-readable version: [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md)

This document is loaded into agent context for self-improvement workflows.
It describes the system at the **source-code level** — modules, functions, data flows,
and current capability status. Update this file when architectural changes are made.

---

## System Overview

CoderClaw is a self-hosted AI coding agent gateway. Core capabilities:
- Multi-agent orchestration (dependency DAG, 6 workflow types)
- 7 built-in roles with personas and output contracts
- Persona plugin registry (marketplace + coderClawLink assignment)
- CoderClawLLM brain (local SmolLM2 ONNX or external LLM fallback)
- 53 skills, 30+ model providers, all major messaging channels
- coderClawLink cloud portal integration (relay, directory sync, fleet)

---

## Source Layout

```
src/
  agents/                    Agent execution, brain, skills, syscheck
  coderclaw/                 Orchestrator, roles, personas, types, project I/O
  gateway/                   WebSocket server, session management, MCP server
  tui/                       Terminal UI, slash commands
  infra/                     ClawLink relay, directory sync, knowledge loop
  transport/                 Transport abstraction (local / clawlink)
  config/                    Config loading and types
  logging/                   Subsystem loggers
extensions/                  Channel + memory plugins
skills/                      53 bundled SKILL.md definitions
.coderClaw/
  agents/       *.yaml       Custom agent role definitions
  personas/     *.yaml       Project-scoped persona plugins
  planning/                  Self-improvement operational docs
  memory/       YYYY-MM-DD.md  Daily knowledge log
  sessions/                  Workflow checkpoints + session handoffs
```

---

## Key Files and Functions

### Core Type Definitions — `src/coderclaw/types.ts`

All domain types. Key types added in this sprint:
- `AgentPersona` — voice, perspective, decisionStyle
- `AgentOutputFormat` — structure, requiredSections, outputPrefix
- `TaskHandoff` — structured inter-agent context (workflowId, keyFindings, decisions)
- `PersonaSource` — "builtin" | "user-global" | "project-local" | "clawhub" | "clawlink-assigned"
- `PersonaPluginMetadata` — clawhubId, version, author, license, requiresLicense, tags, checksum
- `PersonaPlugin` — AgentRole + source + pluginMetadata + filePath + active
- `PersonaAssignment` — name + clawhubId + assignedByClawLink + assignedAt
- `ProjectContext` — now includes `personas.assignments: PersonaAssignment[]`

### Agent Roles — `src/coderclaw/agent-roles.ts`

7 built-in roles, each with `persona` + `outputFormat`:

| Role | outputPrefix | Voice |
|------|-------------|-------|
| code-creator | CODE: | pragmatic and quality-driven |
| code-reviewer | REVIEW: | critical yet constructive |
| test-generator | TESTS: | systematic and exhaustive |
| bug-analyzer | BUG-FIX: | investigative and precise |
| refactor-agent | REFACTOR: | disciplined and incremental |
| documentation-agent | DOCS: | clear, concise, audience-aware |
| architecture-advisor | ARCH: | strategic and pragmatic |

`findAgentRole(name)` resolution order:
1. Built-ins (always available, cannot be overridden)
2. `globalCustomRoles` — `.coderClaw/agents/*.yaml`, registered via `registerCustomRoles()`
3. `globalPersonaRegistry.resolve(name)` — marketplace / coderClawLink personas

### Persona Plugin Registry — `src/coderclaw/personas.ts`

- `PersonaRegistry` class — `registerBuiltins()`, `register()`, `loadFromDir()`,
  `applyAssignments()`, `activate()`, `deactivate()`, `resolve()`, `listAll()`, `listActive()`
- `loadPersonaFromFile(filePath, source)` — parses PERSONA.yaml
- `loadPersonasFromDir(dir, source)` — bulk-loads a directory
- `buildPersonaSystemBlock(role)` — encodes role.persona + outputFormat into
  `--- Agent Persona ---` section for brain injection
- `globalPersonaRegistry` — process-wide singleton
- `USER_PERSONAS_DIR` = `~/.coderclaw/personas/`
- `PERSONAS_SUBDIR` = `"personas"` (relative to `.coderClaw/`)

Loading precedence (highest wins):
```
clawlink-assigned (5) > clawhub (4) > project-local (3) > user-global (2) > builtin (1)
```

### Orchestrator — `src/coderclaw/orchestrator.ts`

- `createWorkflow(steps)` — builds dependency DAG
- `executeWorkflow(id, context)` — runs tasks in dependency order
- `buildStructuredContext(task, workflow)` — produces labelled context blocks:
  ```
  ## Your Task\n<task.input>
  ## Context from Prior Agents
  ### REVIEW: (code-reviewer)\n<result>
  ### ARCH: (architecture-advisor)\n<result>
  ```
  Uses `outputFormat.outputPrefix` from each role to label sections.
- Task lifecycle: pending → running → completed / failed
- Persistence: saves to `.coderClaw/sessions/workflow-<id>.yaml` on each transition
- `globalOrchestrator` — process-wide singleton
- Unknown role validation throws with hint to check `.coderClaw/agents/` or use a built-in

### Sub-Agent Spawn — `src/agents/subagent-spawn.ts`

`spawnSubagentDirect(params)` — executes a sub-agent in a new session:
1. Validates depth against `maxSpawnDepth`
2. Resolves model + thinking from `roleConfig`
3. Calls `buildPersonaSystemBlock(roleConfig)` — encodes persona into child system prompt
4. System prompt structure:
   ```
   [base system prompt]
   --- Role Guidance ---
   <roleConfig.systemPrompt>
   --- Agent Persona ---
   Role: <name>
   Voice: <voice>
   Perspective: <perspective>
   Decision style: <decisionStyle>
   Required output sections: ...
   Prefix your summary with: <outputPrefix>
   Constraints: ...
   ---
   ```
5. Dispatches via `callGateway({ method: "agent", extraSystemPrompt, ... })`

### CoderClawLLM Brain — `src/agents/coderclawllm-local-stream.ts`

`createCoderClawLlmLocalStreamFn(opts)` — returns a `StreamFn`:

**Step 0 — Syscheck (once per factory instance, lazy):**
```
checkLocalBrainRequirements({ cacheDir, modelId })
  → os.freemem() < 2 GB  → external fallback
  → model not cached AND fs.statfs(cacheDir).bavail < 1.5 GB → external fallback
  → eligible: true → proceed with SmolLM2
```

**Step 1 — Load memory:**  `loadCoderClawMemory(workspaceDir)` — SOUL.md, USER.md,
  MEMORY.md (omitted in shared contexts), AGENTS.md, + today's + yesterday's daily notes.

**Step 2 — RAG:** `retrieveRelevantContext({ query, workspaceDir })` — TF-IDF score
  over source files, returns top-3 excerpts.

**External brain path (when syscheck fails):**
```
brainSystem = [context.systemPrompt, memoryBlock, ragContext, BRAIN_SYSTEM_PROMPT]
callExecutionLlm({ config, messages, maxTokens, temperature })
→ first configured non-coderclawllm provider (Ollama or OpenAI-compat)
```

**Local brain path:**
```
brainSystem = [context.systemPrompt, memoryBlock, ragContext, BRAIN_SYSTEM_PROMPT]
             ↑ context.systemPrompt contains "--- Agent Persona ---" block
getOrCreatePipeline(modelId, dtype, cacheDir) → SmolLM2 ONNX
runPipeline(brainMessages, 256, 0.4)
  → tool loop (up to 3 rounds if tool calls in output)
  → DELEGATE? → runMultiStepChain (plan → code → exec feedback → fix)
  → HANDLE?   → return brainText directly
```

Key: `context.systemPrompt` is now **prepended** to `brainSystem` so the brain always
knows its role identity — on both the direct path and the DELEGATE path.

### Brain Syscheck — `src/agents/coderclawllm-syscheck.ts`

- `checkLocalBrainRequirements({ cacheDir, modelId })` → `LocalBrainCheckResult`
- `MIN_DISK_BYTES` = 1.5 GB — download headroom for SmolLM2-1.7B-Instruct q4 (~900 MB)
- `MIN_RAM_BYTES` = 2 GB — in-process inference headroom (~1.5 GB model + working memory)
- `isModelCached(cacheDir, modelId)` — checks for `models--<org>--<name>` dir in cache
- `getFreeDiskBytes(path)` — uses `fs.statfs()`; returns `null` on unsupported platforms

### Project Context I/O — `src/coderclaw/project-context.ts`

`CoderClawDirectory` now includes `personasDir: .coderClaw/personas/`

New functions:
- `loadProjectPersonaPlugins(projectRoot)` — loads `.coderClaw/personas/*.yaml`
- `loadPersonaAssignments(projectRoot)` — reads `context.yaml` → `personas.assignments`
- `savePersonaAssignment(projectRoot, assignment)` — merges into `context.yaml`
- `removePersonaAssignment(projectRoot, name)` — removes from `context.yaml`
- `initializeCoderClawProject()` now creates `personasDir` on init

### Gateway Bootstrap — `src/gateway/server.impl.ts`

PersonaRegistry bootstrap (runs at startup, after custom role loading):
```
globalPersonaRegistry.registerBuiltins(getBuiltInAgentRoles())
globalPersonaRegistry.loadFromDir(USER_PERSONAS_DIR, "user-global")
globalPersonaRegistry.loadFromDir(".coderClaw/personas", "project-local")
loadPersonaAssignments(projectRoot) → globalPersonaRegistry.applyAssignments(...)
```

### MCP Server — `src/gateway/mcp-server-http.ts`

JSON-RPC 2.0 at `http://localhost:18789/mcp`. Tools exposed:
`codebase_search`, `project_knowledge`, `git_history`, `workflow_status`, `claw_fleet`

---

## Data Flows

### Sub-Agent Persona Injection

```
orchestrator.executeTask(task)
  → findAgentRole(task.agentRole)        # built-in / custom / registry
  → buildStructuredContext(task, wf)     # labelled prior-agent context
  → spawnSubagentDirect({ roleConfig, task: structuredContext })
      → buildPersonaSystemBlock(roleConfig)
      → childSystemPrompt = base + roleGuidance + personaBlock
      → callGateway({ extraSystemPrompt: childSystemPrompt, ... })
          → coderClawLLM brain receives context.systemPrompt
          → brainSystem prepends context.systemPrompt
          → brain reasons with persona identity on ALL paths
```

### Brain Mode Selection (first request)

```
factory created → localBrainEligible = null

first request arrives:
  checkLocalBrainRequirements()
  eligible=true  → localBrainEligible=true  → SmolLM2 pipeline
  eligible=false → localBrainEligible=false → external LLM for all subsequent requests
                   logInfo("[coderclawllm] <reason>")
```

### coderClawLink Persona Assignment

```
operator assigns persona in portal
  → PUT/PATCH .coderClaw/context.yaml (via directory sync or direct API)
  → personas.assignments updated
  → on next gateway startup: applyAssignments() activates matching plugins
  → plugin.active = true for assigned names
  → findAgentRole("assigned-name") → globalPersonaRegistry.resolve() → plugin
```

---

## Capability Status (2026-03-04)

### ✅ Complete

| Item | Source file(s) |
|------|---------------|
| executeWorkflow wired (all 6 types) | orchestrator.ts, orchestrate-tool.ts |
| 7 built-in roles with persona + outputFormat | agent-roles.ts |
| PersonaRegistry (plugin lifecycle) | personas.ts |
| buildPersonaSystemBlock + spawn injection | personas.ts, subagent-spawn.ts |
| Persona → brain on all paths | coderclawllm-local-stream.ts |
| CoderClawLLM syscheck + external fallback | coderclawllm-syscheck.ts, coderclawllm-local-stream.ts |
| buildStructuredContext (labelled sections) | orchestrator.ts |
| Project personas dir + context.yaml I/O | project-context.ts |
| Gateway bootstrap (registry init) | server.impl.ts |
| Session handoff save/load | save-session-handoff-tool.ts, tui-session-actions.ts |
| Workflow persistence + resume | orchestrator.ts |
| Knowledge loop + coderClawLink sync | knowledge-loop.ts |
| Claw mesh + capability routing | remote-subagent.ts, orchestrator.ts |
| /spec, /workflow, /compact, /handoff | tui-command-handlers.ts |
| Staged edits (/diff, /accept, /reject) | staged-edits.ts |
| codebase_search + MCP server | codebase-search-tool.ts, mcp-server-http.ts |

### 🔲 Open Items

| Item | Notes |
|------|-------|
| ClawHub persona download/install flow | Client types ready; clawhub CLI + backend pending |
| coderClawLink Persona Assignment API | Backend endpoint to push assignments to claws |
| Remote task result streaming | Claw-to-claw result channel (requires coderClawLink relay frame) |
| Semantic architecture.md auto-update | Trigger doc-agent after ≥3 structural edits in a run |
| VS Code extension | Sidebar + inline diff decoration |
| Tab autocomplete / FIM proxy | `/fim` endpoint |
| Session auto-checkpoint on exit | Write handoff on SIGTERM/exit |
