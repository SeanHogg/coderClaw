# CoderClaw Self-Improvement Bootstrap Prompt

> Paste into the coderClaw TUI. Prereq: `coderclaw init` so `.coderClaw/` exists.

---

## The Prompt (paste between the `---` markers)

---

You are working on the coderClaw platform itself — coderClaw building coderClaw.

## Read These First

1. `.coderClaw/planning/CAPABILITY_GAPS.md` — **START HERE**: 6 gaps where code exists but is never called
2. `.coderClaw/planning/ROADMAP.md` — local roadmap mirror (Phase -1 must be done before anything else)
3. `.coderClaw/context.yaml`, `.coderClaw/architecture.md` — project metadata & module structure
4. `.coderClaw/planning/CLAW_REGISTRATION_ANALYSIS.md` — local registration audit mirror (coderclawLLM API design)
5. `AGENTS.md` — conventions (TS ESM, Vitest, Oxlint, Conventional Commits, ≤500 LOC/file)

## Canonical Source Paths (avoid ENOENT)

- `src/coderclaw/tools/orchestrate-tool.ts`
- `src/coderclaw/orchestrator.ts`
- `src/agents/subagent-spawn.ts`

Do **not** use these non-existent paths:

- `src/coderclaw/agents/subagent-spawn.ts`
- `src/coderclaw/tools/common.ts`
- `src/agents/agent-manager.ts`

## Current State (facade — nothing executes)

- ✅ `orchestrate` now creates workflows and calls `executeWorkflow()`
- Agent roles defined but never applied to subagents
- Session handoff functions exist but have zero callers
- `.coderClaw/` never updated after tasks complete
- Mesh (multi-claw orchestration) has zero implementation

You **cannot** use multi-agent workflows yet. Work as a single agent.

## Per-Item Workflow

For each roadmap item in one session:

1. **Plan** — PRD + architecture spec + task breakdown
2. **Adversarial review** — critique your own spec (security, perf, compatibility with ClawGateway/OTel/Vitest), then revise
3. **Implement** — follow AGENTS.md rules
4. **Test** — vitest, ≥70% coverage, no real network calls
5. **Review** — AGENTS.md compliance check
6. **Commit** — `scripts/committer`, Conventional Commits
7. **Update knowledge** — note what changed, new gaps found, suggest next item

## Start: Phase -1.2

Bridge `agent-roles.ts` into runtime so subagents actually receive role prompts/model/tool allowlists.

Read `src/agents/agent-roles.ts`, `src/agents/subagent-spawn.ts`, and `src/coderclaw/orchestrator.ts`, then plan.

## Constraints

- You're modifying your own source — don't break the agent runtime, gateway, or TUI
- `scripts/committer` per AGENTS.md, scoped commits
- No `git stash` or branch switching — other agents may be active
- `pnpm vitest --run` before committing
- ≤500 LOC per file
- After each item, update `.coderClaw/planning/CAPABILITY_GAPS.md`

---

## Subsequent Sessions

After Phase -1.2, start next session with:

```
Resume coderClaw self-improvement. Read .coderClaw/planning/CAPABILITY_GAPS.md
for gap status. Previous session completed Phase -1.2. Next: Phase -1.3
(wire session handoff save/load). Read ROADMAP.md Phase -1.3 and plan.
```

Adjust per phase. After Phase -1.3 (session handoff), coderClaw auto-loads prior handoff — no manual preamble needed.

## Post Phase -1.2 + -1.3: Use Multi-Agent Workflows

Once orchestrator executes workflows AND applies roles, switch to:

```
Use the orchestrate tool to plan: "Phase -1.3 — Wire session handoff.
See .coderClaw/planning/CAPABILITY_GAPS.md Gap 3."
```

Then orchestrate adversarial review, then orchestrate feature workflow per sub-task. This is the transition from manual single-agent to automated multi-agent.
