# .coderClaw Directory

This directory contains project-specific context and configuration for coderClaw.

## Structure

- `context.yaml` - Project metadata, languages, frameworks, dependencies, architecture
- `architecture.md` - Detailed architectural documentation and design patterns
- `rules.yaml` - Coding standards, testing requirements, git conventions
- `agents/` - Custom agent role definitions (YAML files)
- `skills/` - Project-specific skills (each with SKILL.md)
- `memory/` - Project knowledge base and semantic indices (daily markdown logs)
- `sessions/` - Session handoff documents (for resuming sessions)

## Usage

coderClaw agents automatically load context from this directory when working on the project.

## Key Facts

- **Agent Roles**: 7 built-in roles (code-creator, code-reviewer, test-generator, bug-analyzer, refactor-agent, documentation-agent, architecture-advisor)
- **Skills**: 53 skill definitions covering various domains
- **Gateway**: WebSocket on port 18789
- **Workflow Types**: feature, bugfix, refactor, planning, adversarial, custom
- **Node.js**: 22+
- **Package Manager**: pnpm
- **Testing**: Vitest with ≥70% coverage (lines/functions/statements) and ≥55% branches
- **Linting**: Oxlint + Oxfmt with TypeScript strict mode

## Capabilities (as of 2026.03.01)

- Multi-agent orchestration with dependency DAG scheduling
- Session handoff and workflow persistence
- Knowledge loop with automatic memory updates
- Claw-to-claw mesh via builderforce.ai
- 37 extension plugins
- Full WebSocket gateway with channel support

## 🏗️ Architecture Gaps

This section tracks known architectural anti-patterns and layer violations. Items are categorised by severity and ordered by impact on maintainability.

### Resolved (as of 2026.3.x)

| Violation | Fix applied |
| --------- | ----------- |
| `orchestrator.ts` imported directly from `infra/` (domain→infra N-layer violation) | Port interfaces (`ITelemetryService`, `IAgentMemoryService`, `IRemoteAgentDispatcher`, `ILocalResultBroker`) extracted to `coderclaw/ports.ts`; concrete adapters in `infra/orchestrator-ports-adapter.ts`; injected at gateway startup |
| `orchestrator-enhanced.ts` + `orchestrator-legacy.ts` — dead parallel implementations with `@deprecated` comment | Both files deleted; planning/adversarial workflow factories merged into `orchestrator.ts` |
| `orchestrate-tool.ts` — `switch(workflow)` closed to extension (OCP violation) | Replaced with `WORKFLOW_REGISTRY` map; new workflow types added without modifying the tool |
| `IRelayService` missing — orchestrator depended directly on `BuilderforceRelayService` (DIP violation) | `IRelayService` interface added in `coderclaw/relay-service.ts`; orchestrator now depends on abstraction |
| 25+ inline `.replace(/\/+$/, "")` URL normalisation calls (DRY violation) | Extracted to `utils/normalize-base-url.ts`; all call sites updated |
| `workflow-telemetry.ts` passed API key as URL query param (security) | Moved to `Authorization: Bearer` header |
| `knowledge-loop.ts` ↔ `ssm-memory-service.ts` circular dependency | Broken via `infra/memory-bridge.ts` mediator; neither service imports the other |
| `knowledge-loop.ts` computed `deriveActivitySummary()` twice per run (DRY) | Result cached in a local variable before use |
| `server-startup.ts` called `loadProjectContext()` twice on the same path (DRY) | Reused the `ctx` value from the first call |
| `AppShell.tsx` called `setState` inside a `useEffect` body (`react-hooks/set-state-in-effect`) | Refactored to derived state pattern; `localStorage.setItem` moved to a side-effect-only effect |
| `PermissionDebuggerPanel.tsx` — `useMemo` called after early return (`rules-of-hooks`) | Moved `useMemo` before the guard clause |
| `ClawProjectsContent.tsx` — `load` not in `useEffect` deps (`exhaustive-deps`) | Wrapped in `useCallback([clawId])` |
| `content-manager/[id]/page.tsx` — bare `<img>` (Next.js `next/image` warning) | Replaced with `<Image fill>` |
| `layout.tsx` — GTM `<script>` without `next/script` strategy; Google Fonts `<link>` instead of `next/font/google` | Replaced with `<Script strategy="afterInteractive">` and `JetBrains_Mono` from `next/font/google` |
| Wrong default URL `api.coderclaw.ai` in `claw-fleet-tool.ts` and `builderforce-directory-sync.ts` | Corrected to `api.builderforce.ai` |
| `dependsOn` arrays in workflow factories used role names instead of task description strings (silent DAG failure) | Corrected to match full task description strings as used by `steps.findIndex()` |
| `layout.tsx` — Fontshare loaded via `<link>` in `<head>` (`@next/next/no-page-custom-font`) | Moved to CSS `@import` in `globals.css`; `<link>` elements removed |
| **Module-level mutable singletons** in `workflow-telemetry.ts` and `approval-gate.ts` | Converted to class-based service objects (`WorkflowTelemetryService`, `ApprovalGate`) with exported singleton instances and backward-compatible shim functions |
| **ISP violation in `CoderClawToolsOptions`** — 22-field monolithic options object | Decomposed into 4 focused sub-interfaces (`CoderClawToolsSandboxOptions`, `CoderClawToolsAgentOptions`, `CoderClawToolsSlackOptions`, `CoderClawToolsFeatureOptions`) composed via `&` |
| **`startGatewaySidecars()` — 14-responsibility function** | Decomposed into 8 single-responsibility helpers (`cleanStaleSessions`, `startOrchestrator`, `startBrowserControl`, `startHooks`, `startMessageChannels`, `startPlugins`, `startMemoryBackend`, `startBuilderforceServices`); each takes only the params it needs via `Pick<SidecarParams, …>` |
| **`project-context.ts` — 600-line God Object** | Split into 8 focused modules (`project-dir`, `project-init`, `project-context-store`, `project-personas`, `project-sessions`, `project-workflows`, `project-workspace-state`, `project-knowledge`); original file is now a barrel re-exporter for backward compatibility |
| **Module-level mutable singleton** in `ssm-memory-service.ts` | `SsmMemoryRegistry` class added; `let _instance` replaced with `ssmMemoryRegistry.get()`/`init()`; backward-compatible shims kept |
| **Two-phase `globalOrchestrator` construction** — 5 scattered setter calls | `OrchestratorConfig` type + `configure(config)` method added; server-startup now calls one `configure({...})` per phase instead of individual setters; old setters kept as `@deprecated` shims |
| **`BuilderforceRelayService` — heartbeat/log/presence concerns** | Extracted `RelayHeartbeat`, `RelayLogPoller`, `RelayPresencePoller` into `infra/builderforce-relay-helpers.ts`; relay class reduced from 11 to 8 responsibilities |
| **Anemic `Task` domain entity** — no state-transition invariant | `VALID_TASK_TRANSITIONS` map + `canTransitionTaskTo(current, next)` exported from `orchestrator.ts`; encodes valid transitions in the domain layer |

### Remaining Architectural Gaps

| Gap | Location | Severity | Notes |
| --- | -------- | -------- | ----- |
| **`BuilderforceRelayService` — remaining 8 responsibilities** | `infra/builderforce-relay.ts` | Medium | After extracting the 3 pollers, the class still handles: WS connection management, message protocol routing, local gateway bridge, remote context fetch, remote task dispatch, execution lifecycle reporting, approval gate callbacks, and peer-result callbacks. Further decomposition requires a deeper protocol layer split. |
| **True two-phase `globalOrchestrator` construction** | `coderclaw/orchestrator.ts`, `gateway/server-startup.ts` | Low | The orchestrator is still exported before it is fully configured. Proper fix (constructor injection + factory) requires all callers to receive the orchestrator as a parameter rather than importing the global. Deferred: the `configure()` consolidation makes the two phases explicit and bounded. |
| **Anemic `Workflow` entity** | `coderclaw/orchestrator.ts` | Low | `Workflow` is still a plain data struct. Its status transitions (`pending → running → completed/failed`) are managed by the orchestrator service rather than the entity itself. A proper aggregate would enforce these invariants on `Workflow` similarly to the new `canTransitionTaskTo` guard on `Task`. |
