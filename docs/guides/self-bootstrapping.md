# Self-Bootstrapping Guide: Using CoderClaw to Build CoderClaw

> A step-by-step walkthrough of using coderClaw's own agent features to execute
> its platform roadmap. This is both a practical guide and a case study in
> recursive self-improvement — an AI coding agent improving its own source code.

## Overview

CoderClaw has multi-agent orchestration, 7 specialized roles, session handoff,
and a project knowledge system. The idea: instead of a human writing every line
of code on the roadmap, **coderClaw executes the roadmap items itself**, with the
human acting as manager — reviewing, approving, and steering.

There's a catch: several key features are **facades** (code exists but is never
called). This guide shows how to fix those gaps first, then progressively unlock
more sophisticated self-improvement capabilities.

## Prerequisites

- coderClaw installed and working (`coderclaw` TUI launches successfully)
- Access to an LLM provider (Anthropic, OpenAI, etc.)
- Both repos cloned: `coderClaw/` and `coderClawLink/`

## Phase Map

```
┌─────────────────────────────────────────────────┐
│  Phase -1: Fix the engine                       │
│  (single-agent, manual sequencing)              │
│                                                 │
│  -1.1 Wire executeWorkflow()                    │
│  -1.2 Wire agent roles                          │
│  -1.3 Wire session handoff         ◄── unlock   │
│  -1.4 Workflow persistence              auto-    │
│  -1.5 Knowledge loop                   resume   │
│  -1.6 Mesh plumbing                             │
├─────────────────────────────────────────────────┤
│  Phase 0-5: Build the platform                  │
│  (multi-agent orchestrated workflows)           │
│                                                 │
│  After -1.1 + -1.2: orchestrate tool works      │
│  After -1.3: sessions resume automatically      │
│  After -1.5: knowledge stays current            │
│  After -1.6: claws collaborate across machines  │
└─────────────────────────────────────────────────┘
```

## Step 1: Initialize Project Context

```bash
cd coderClaw
coderclaw init
```

This creates `.coderClaw/` with:

- `context.yaml` — project metadata (languages, frameworks, architecture)
- `architecture.md` — module graph skeleton
- `rules.yaml` — coding conventions (TypeScript ESM, Vitest, Oxlint, etc.)
- `agents/` — custom agent role definitions (YAML)
- `skills/` — project-specific skills
- `memory/` — persistent knowledge (not yet wired — that's Gap 5)
- `sessions/` — session handoff documents (not yet wired — that's Gap 3)

**Also initialize for coderClawLink** if you'll work on both repos:

```bash
cd ../coderClawLink
coderclaw init
```

## Step 2: Add Planning Knowledge

Copy the roadmap and analysis docs into the `.coderClaw/planning/` directory:

```bash
cd coderClaw
mkdir -p .coderClaw/planning
# Planning docs should already be there if you followed the setup.
# If not, create them from the workspace-root analysis files.
```

The planning directory should contain:

- `CAPABILITY_GAPS.md` — the 6 gaps audit (what's real vs. facade)
- `BOOTSTRAP_PROMPT.md` — the seed prompt for coderClaw
- `README.md` — index with cross-references to workspace-root ROADMAP.md

## Step 3: Understand the Gaps

Before running any prompt, understand what **doesn't work**:

| #   | Gap                                                | Effect                               |
| --- | -------------------------------------------------- | ------------------------------------ |
| 1   | `orchestrate` tool never calls `executeWorkflow()` | Multi-agent workflows are inert      |
| 2   | Agent roles defined but never applied              | All agents behave identically        |
| 3   | Session handoff never saved/loaded                 | Zero cross-session continuity        |
| 4   | Workflow state is in-memory only                   | Process restart = state loss         |
| 5   | No post-task knowledge update                      | `.coderClaw/` goes stale immediately |
| 6   | Mesh is branding, not code                         | Claws can't collaborate              |

**Gaps 1-4 are blocking.** You cannot use multi-agent workflows until Gap 1 is
fixed. You cannot get role-specific behavior until Gap 2 is fixed. Sessions
won't resume until Gap 3 is fixed.

## Step 4: Run the Bootstrap Prompt

Open the coderClaw TUI and paste the bootstrap prompt from
`.coderClaw/planning/BOOTSTRAP_PROMPT.md`:

```bash
cd coderClaw
coderclaw
```

Then paste the prompt from the "The Prompt" section of BOOTSTRAP_PROMPT.md.
This gives coderClaw full awareness of:

- Its own architecture and conventions
- The 6 capability gaps
- The roadmap priority order
- The manual execution strategy for single-agent mode

## Step 5: Execute Phase -1.1 (Wire executeWorkflow)

This is the most important item. coderClaw will:

1. **Plan**: Read `orchestrate-tool.ts` and `orchestrator.ts`, produce a PRD
   and architecture spec
2. **Review**: Critique its own spec for edge cases
3. **Implement**: Add the `executeWorkflow()` call, wire `planning` and
   `adversarial` workflow types, add streaming progress
4. **Test**: Write vitest tests for the wired orchestrator
5. **Review**: Check AGENTS.md compliance
6. **Commit**: via `scripts/committer`

**Your role as manager**: Review output between each step. Provide feedback.
Approve or reject.

### What to watch for:

- Does the implementation handle the `SpawnSubagentContext` correctly?
- Are OTel spans emitted for workflow-level visibility?
- Does it handle workflow failure gracefully (one step fails → workflow fails)?
- Are the planning and adversarial workflow types properly imported from
  `orchestrator-enhanced.ts`?

## Step 6: Execute Phase -1.2 (Wire Agent Roles)

Start a new session:

```
Resume the coderClaw self-improvement initiative. The previous session
completed Phase -1.1 (wire executeWorkflow into the orchestrate tool).
Read .coderClaw/planning/CAPABILITY_GAPS.md to see current gap status.
The next item is Phase -1.2: Bridge agent-roles.ts into the agent runtime.
Read the ROADMAP.md Phase -1.2 section and begin planning.
```

After this is done, the orchestrate tool should spawn subagents that actually
behave differently based on their role (code-reviewer can't create files,
architecture-advisor has high thinking, etc.).

**Verification**: Run `orchestrate feature "add a hello world function"` and
observe that each spawned agent uses its role-specific system prompt and tools.

## Step 7: Transition to Multi-Agent Mode

Once Phase -1.1 and -1.2 are complete, you can switch from manual sequencing
to the orchestrate tool:

```
Use the orchestrate tool to create a planning workflow for:
"Phase -1.3 — Wire session handoff save/load. See CAPABILITY_GAPS.md Gap 3."
```

Review the planning output, then:

```
Use the orchestrate tool to create an adversarial review for:
"The architecture spec for Phase -1.3 session handoff wiring"
```

Review and approve, then:

```
Use the orchestrate tool to create a feature workflow for:
"[specific sub-task from the planning output]"
```

**This is the inflection point**: coderClaw is now using the features it just
built to build more features.

## Step 8: Continue Through the Roadmap

Each subsequent phase follows the same pattern:

1. Start session (manual prompt or auto-resume via handoff after Phase -1.3)
2. Plan (planning workflow or manual)
3. Adversarial review (for complex items)
4. Implement (feature/bugfix/refactor workflow)
5. Test and review
6. Commit
7. Update knowledge (manual until Phase -1.5 automates it)

### Phase progression and what each unlocks:

| After completing... | You unlock...                                                              |
| ------------------- | -------------------------------------------------------------------------- |
| Phase -1.1          | Multi-agent workflows actually execute                                     |
| Phase -1.2          | Agents have role-specific behavior                                         |
| Phase -1.1 + -1.2   | Full orchestrate tool (planning, adversarial, feature, refactor workflows) |
| Phase -1.3          | Sessions resume automatically — no more re-explaining context              |
| Phase -1.4          | Workflows survive process restarts                                         |
| Phase -1.5          | Knowledge stays current — agents always have fresh context                 |
| Phase -1.6          | Claws can delegate to other claws (mesh)                                   |
| Phase 0             | Claw ↔ ClawLink connection works end-to-end                                |
| Phase 1             | Full observability — you see cost/duration/success per task                |
| Phase 2             | LLM proxy with budget gating + approval workflows                          |
| Phase 3             | Local model execution for cheap drafts                                     |
| Phase 4             | Multi-claw parallel orchestration                                          |
| Phase 5             | Production-scale fleet with audit trail                                    |

## The Feedback Loop

Every completed roadmap item improves coderClaw's ability to do the next one:

```
Fix orchestrator  →  Workflows actually run
      ↓
Fix roles        →  Agents behave correctly per workflow step
      ↓
Fix handoff      →  Sessions resume — multi-session roadmap work
      ↓
Fix knowledge    →  Agents see updated codebase after changes
      ↓
Fix mesh         →  Multiple claws collaborate on complex tasks
      ↓
Build platform   →  CoderClaw is a production AI coding mesh
```

## Tips for Human Managers

1. **Review every plan before approving implementation.** The adversarial
   review catches most issues, but you know the product vision.

2. **Scope sessions tightly.** One roadmap item per session until session
   handoff works (Phase -1.3). After that, multi-session work flows naturally.

3. **Check test output.** Run `pnpm vitest --run` on affected files before
   approving commits.

4. **Track cost.** Use the `model-usage` skill to see token spend. Once
   Phase 1 (observability) is done, the dashboard shows this automatically.

5. **Don't fix coderClaw with something other than coderClaw.** The whole
   point is to validate the platform by using it. If you find yourself
   reaching for a separate tool, that's a signal coderClaw needs another
   feature — add it to the roadmap.

6. **Update the gap checklist.** After each Phase -1 item, update
   `.coderClaw/planning/CAPABILITY_GAPS.md` to mark the gap as resolved
   and verify against the checklist.

## Cross-Repo Work

Some roadmap items touch both `coderClaw/` and `coderClawLink/`. Run separate
sessions in each repo:

```bash
# Session 1: coderClaw side
cd coderClaw
coderclaw
> [implement the claw-side changes]

# Session 2: coderClawLink side
cd coderClawLink
coderclaw
> [implement the Link-side changes]
```

Each session uses its repo's `.coderClaw/context.yaml` — the agent understands
the local codebase automatically.

## Troubleshooting

### "Workflow created" but nothing happens

Phase -1.1 isn't complete. The orchestrate tool creates workflows but doesn't
execute them. Use the manual single-agent sequence instead.

### Agents all behave the same regardless of role

Phase -1.2 isn't complete. Role definitions exist but aren't applied. Manually
prompt "You are acting as code-reviewer" etc.

### Session starts with no context from previous work

Phase -1.3 isn't complete. Session handoff is dead code. Manually include
prior session context in your prompt.

### `.coderClaw/architecture.md` is outdated

Phase -1.5 isn't complete. Manually run `/knowledge update` (once implemented)
or regenerate by re-running `coderclaw init`.

### Can't delegate work to another claw

Phase -1.6 isn't complete. Mesh is not implemented. All work happens on the
local claw.
