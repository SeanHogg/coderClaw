# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org).

## [Unreleased]

## [2026.3.4] - 2026-03-04

### Added

- **Capability-based claw routing**: orchestrator now supports `remote:auto` (auto-select any online peer) and `remote:auto[cap1,cap2]` (select peer satisfying all listed capabilities) workflow step roles — no manual fleet lookup required
- `selectClawByCapability()` in `src/infra/remote-subagent.ts`: queries `GET /api/claws/fleet`, filters online peers by required capabilities, returns highest-scoring match
- `claw_fleet` tool: new `requireCapabilities` parameter to filter fleet results to claws with specific capabilities; updated tip to document `remote:auto` usage
- `FleetEntry` type exported from `src/infra/remote-subagent.ts` and reused in `claw-fleet-tool.ts` to eliminate duplication

- `/spec <goal>` TUI slash command: triggers spec-driven planning workflow (PRD → architecture spec → ordered task list) via the `orchestrate` tool; outputs saved to `.coderClaw/planning/`
- `/workflow [id]` TUI slash command: queries orchestrator workflow status from TUI using the `workflow_status` tool; accepts optional workflow ID
- `/compact [instructions]` explicit TUI handler and added to `/help` output (was already functional via gateway fallthrough but undiscoverable)
- `ChatLog.hasUserMessages()`: tracks whether the current session has had user messages since the last `clearAll()`; used to show handoff hint on `/new`
- Handoff hint on `/new`/`/reset`: when the gateway is connected and the session has user messages, a tip is shown reminding users to run `/handoff` before resetting
- `deriveActivitySummary()` in `src/infra/knowledge-loop.ts`: produces a one-line semantic label per agent run based on tool-usage heuristics (no model call); appended as `**Summary**:` in `.coderClaw/memory/YYYY-MM-DD.md` entries
- `src/infra/knowledge-loop.test.ts`: 11 unit tests for `deriveActivitySummary`
- `.coderClaw/planning/CODERCLAW_LINK_GAPS.md`: comprehensive feature gap analysis for the `SeanHogg/coderClawLink` backend/portal, covering 13 features across P0–P3 priorities

### Updated

- `.coderClaw/architecture.md`: full rewrite reflecting completed TUI commands, semantic knowledge loop, updated system diagram, new data flows (spec-driven, multi-claw)
- `.coderClaw/planning/CAPABILITY_GAPS.md`: added Gaps 7–11 (all resolved) and Open Gaps I–K with acceptance criteria
- `.coderClaw/planning/ROADMAP.md`: updated with completed items and open items with canonical code paths

### Optimized

- Build output footprint: enabled whitespace and syntax minification in `tsdown.config.ts` for all dist entries, reducing bundle sizes without mangling identifier names (preserves stack traces, plugin discovery, and dynamic property access)

### Fixed

- `src/commands/health.ts`: removed local `formatDurationParts` duplicate; now uses centralized `formatDurationCompact` from `src/infra/format-time/`; session store last-active timestamps now use `formatTimeAgo` for consistent relative formatting
- `src/commands/doctor-session-locks.ts`: removed local `formatAge` duplicate; now uses centralized `formatDurationCompact` from `src/infra/format-time/`

## [2026.3.3] - 2026-03-03

### Added

- Memory indexing system: `generate-memory-index.cjs` builds `.coderClaw/memory-index.json` from daily logs
- Daily cron job `memory-suggestion-scan` for non-destructive advisory scans
- Cross-claw memory sharing support (opt-in via `.coderClaw/memory-sync/config.yaml`)
- Session diagnostics logger (`initialize-session-logger.js`) for capturing pipeline state
- Self-improvement reminder system (`self-improvement-reminder.js`) with daily cron
- `CRON.md` and `REMINDERS.md` to document scheduled algorithms under source control
- `docs/memory-architecture.md` with full architecture spec

### Updated (Skills)

- `coderclaw` skill: added memory-aware primitives: `index-memory`, `suggest-memory`, `share-memory`, `delegate-to <clawId>`

### Updated (Core)

- `SOUL.md`: added Memory Architecture boundaries (no auto-modification, read-only index, opt-in sharing, suggestion-only)
- `MEMORY.md`: documented rejection of automated semantic layer, approved read-only index approach, roadmap item

## [2026.3.2] - 2026-03-02

### Added

- (no changes recorded)

## [2026.3.1] - 2026-03-01

_Initial tracked release._
