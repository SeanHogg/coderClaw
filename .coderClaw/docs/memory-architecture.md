# Memory Architecture

## Overview

CoderClaw uses a **dual-structure, local-first with optional sharing** memory system.

### Components

| Component      | Location                             | Purpose                                       | Shared?              |
| -------------- | ------------------------------------ | --------------------------------------------- | -------------------- |
| Daily logs     | `memory/YYYY-MM-DD.md`               | Raw session transcripts and observations      | ❌ Local only        |
| Curated memory | `MEMORY.md`                          | Distilled decisions, roadmap, lessons         | ❌ Local only        |
| Query index    | `.coderclaw/memory-index.json`       | Fast metadata search (tags, dates, summaries) | ✅ Optional (opt-in) |
| Sharing config | `.coderclaw/memory-sync/config.yaml` | Enables cross-claw index exchange             | ❌ Default disabled  |

## Principles

- **Human-in-the-loop**: All changes to Markdown memory require explicit human or my direct curation.
- **Read-only index**: The JSON index is a view layer; never modifies source Markdown.
- **Privacy by default**: Local memory never leaves the instance unless sharing is explicitly enabled.
- **Suggestion-only automation**: Scans produce advisory reports; no automatic deletion or merging.
- **Advisory**: I retain ultimate authority over what to keep, share, or discard.

## Initialization

Every new CoderClaw instance should run:

```bash
node .coderclaw/tools/initialize-memory.js
```

This creates:

- `memory/` (with today's log)
- `MEMORY.md` template if missing
- `.coderclaw/memory-index.json` (first index build)
- Daily cron job `memory-suggestion-scan`

## Sharing Across Claws

To enable memory sharing with other CoderClaw instances in the same tenant:

```bash
node .coderclaw/tools/enable-memory-sharing.js
```

This writes `.coderclaw/memory-sync/config.yaml`. Once enabled:

- The daily cron job will include index hash in its `systemEvent` payload.
- Other listening claws can fetch the updated index via `claw_fleet` + `remote:<clawId>/memory-index.json`.
- Peers maintain their local memory; they only receive the _index_, not raw Markdown.
- Conflict resolution: **local preference wins** — incoming suggestions are advisory and never overwrite.

## Index Format

```json
{
  "id": "2026-03-02.md:2026-03-02T01:45:36.896Z",
  "date": "2026-03-02T01:45:36.896Z",
  "filePath": "memory/2026-03-02.md",
  "session": "session:agent:main:main",
  "summary": "Session started and bootstrap protocols checked...",
  "content": "full original text block...",
  "tags": ["protocol", "memory", "conflict"],
  "wordCount": 57,
  "clusterId": null,
  "lastAccessed": "2026-03-02T19:15:00.000Z"
}
```

## Cron Job

Runs every 24h. Payload:

```
Run memory suggestion scan: flag entries older than 30 days that may be outdated, suggest semantic clusters when working on related tasks, and note potential duplicates.
```

Output: `systemEvent` sent to main session with a structured report.

## Extensibility

Future enhancements:

- Semantic clustering using embeddings (read-only, advisory)
- Duplicate detection via Jaccard similarity on `content`
- Cross-claw fusion dashboard
