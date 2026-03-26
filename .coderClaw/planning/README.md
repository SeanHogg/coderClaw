# .coderClaw/planning/

Planning documents for the coderClaw self-improvement initiative. These files
are injected into agent context when workflows reference roadmap items.

## Contents

| File                                                           | Purpose                                                                                           |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [BOOTSTRAP_PROMPT.md](BOOTSTRAP_PROMPT.md)                     | The seed prompt to paste into coderClaw TUI to begin the self-improvement initiative.             |
| [CLAW_REGISTRATION_ANALYSIS.md](CLAW_REGISTRATION_ANALYSIS.md) | Local mirror of claw registration audit and coderclawLLM integration notes.                       |

## Cross-references (workspace root)

Canonical sources may also exist at workspace root (`ROADMAP.md`, `CLAW_REGISTRATION_ANALYSIS.md`),
but tooling should read the local mirrors in this directory to avoid relative-path ENOENT issues.

## How agents should use this directory

When an agent is working on a roadmap item, it should:

1. Read the `### CoderClaw Orchestration Engine` section in the root `README.md` for the current feature register and open items
2. Check `../context.yaml` for project metadata
3. Check `../architecture.md` for module graph
4. Check `../rules.yaml` for coding conventions
5. After completing work, update the root `README.md` feature register and `../architecture.md` if module structure changed
