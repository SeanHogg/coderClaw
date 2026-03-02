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
- Claw-to-claw mesh via coderClawLink
- 37 extension plugins
- Full WebSocket gateway with channel support
