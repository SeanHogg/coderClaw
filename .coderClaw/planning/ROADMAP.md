# Local Roadmap Mirror (for coderClaw self-improvement)

This local mirror exists to prevent relative-path read failures in tool runners.

Canonical source: workspace-root ROADMAP.md
Last synced: 2026-02-28

## Phase -1 (Must do first)

### -1.1 Wire `executeWorkflow()` into `orchestrate` ✅

- Completed: `src/coderclaw/tools/orchestrate-tool.ts` now calls `globalOrchestrator.executeWorkflow()` with `SpawnSubagentContext`.
- Keep this as a regression check item (do not re-open unless behavior regresses).

### -1.2 Bridge `agent-roles.ts` into runtime

- Apply role prompts/model/tool allowlists during subagent spawn.
- Include custom roles from `.coderClaw/agents/*.yaml`.

### -1.3 Wire session handoff save/load

- Save handoff at session end.
- Load latest handoff at session start.

### -1.4 Add workflow persistence

- Persist workflow checkpoints under `.coderClaw/sessions/`.
- Support resume after restart.

### -1.5 Add post-task knowledge loop

- Update `.coderClaw/context.yaml` / `.coderClaw/architecture.md` after completed tasks.

### -1.6 Add mesh plumbing foundation

- Discovery + remote dispatch groundwork (claw-to-claw path).

## Canonical code paths (existing)

- `src/coderclaw/tools/orchestrate-tool.ts`
- `src/coderclaw/orchestrator.ts`
- `src/agents/subagent-spawn.ts`

## Non-existent paths to avoid

- `src/coderclaw/agents/subagent-spawn.ts`
- `src/coderclaw/tools/common.ts`
- `src/agents/agent-manager.ts`
