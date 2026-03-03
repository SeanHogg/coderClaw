# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org).

## [Unreleased]

### Optimized

- Build output footprint: enabled whitespace and syntax minification in `tsdown.config.ts` for all dist entries, reducing bundle sizes without mangling identifier names (preserves stack traces, plugin discovery, and dynamic property access)

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
