# .coderClaw/planning/

Planning documents for the coderClaw self-improvement initiative. These files
are injected into agent context when workflows reference roadmap items.

## Contents

| File | Purpose |
|------|---------|
| [CAPABILITY_GAPS.md](CAPABILITY_GAPS.md) | Deep audit of what's implemented vs. facade. Mesh, knowledge loop, orchestrator, session handoff. |
| [BOOTSTRAP_PROMPT.md](BOOTSTRAP_PROMPT.md) | The seed prompt to paste into coderClaw TUI to begin the self-improvement initiative. |
| [ROADMAP.md](ROADMAP.md) | Local mirror of platform roadmap essentials needed by the self-improvement workflow. |
| [CLAW_REGISTRATION_ANALYSIS.md](CLAW_REGISTRATION_ANALYSIS.md) | Local mirror of claw registration audit and coderclawLLM integration notes. |

## Cross-references (workspace root)

Canonical sources may also exist at workspace root (`ROADMAP.md`, `CLAW_REGISTRATION_ANALYSIS.md`),
but tooling should read the local mirrors in this directory to avoid relative-path ENOENT issues.

## How agents should use this directory

When an agent is working on a roadmap item, it should:

1. Read `CAPABILITY_GAPS.md` to understand what's real vs. facade
2. Read `ROADMAP.md` for the specific phase/item spec
3. Check `../context.yaml` for project metadata
4. Check `../architecture.md` for module graph
5. Check `../rules.yaml` for coding conventions
6. After completing work, update this directory:
   - Note which gaps were closed
   - Add new specs/designs to this directory
   - Update `../architecture.md` if module structure changed
