# MEMORY.md - Curated Long-Term Memories

Last updated: 2026-03-02

## Decisions

### Rejected: Automated Semantic Memory Layer (2026-03-02)

**Proposal:** A semantic memory layer with _automatic extraction_, vector-space clustering, episodic summaries, and _garbage collection_ that _automatically cleans up_ stale memories.

**Reason for rejection:**

- Manual curation is valuable — I need to decide what's important based on task outcomes and lessons learned
- Human preferences matter — automated systems can't distinguish important from noisy
- Risk of over-aggressive cleanup discarding foundational but seemingly stale context
- Added complexity introduces new failure modes to monitor
- Current system (size thresholds, conflict detection, manual pruning) is sufficient and under 20% overhead

**Key distinction:** The rejection applies to _automated modification_ of memory. A _read-only structured index_ that surfaces suggestions while I retain full write authority is acceptable.

**Alternative approved:** Implement a _suggestion system_ that surfaces potentially outdated entries or semantic clusters for my review, keeping final decision authority. This uses a _parallel structured store_ (JSON) for efficiency, but Markdown remains the canonical source of truth.

## Roadmap

### Cloudflare Relay Architecture (2026-03-02)

- **Priority:** Critical
- **Status:** Approved - Design Phase
- **Description:** Migrate the gateway/relay layer to Cloudflare Workers while keeping local agents as durable "brains." Architecture:
  - Cloudflare Worker acts as scalable WebSocket router and container orchestrator
  - Local agent remains on user's machine with full filesystem, shell, and 53+ skills
  - Containers are ephemeral "cattle" for build/preview tasks; code syncs through relay
  - Durability: local agent holds all persistent state; relay is stateless; agents auto-reconnect and reconcile tasks
  - Resiliency: exponential backoff reconnection, task manifest persistence, automatic retry on container failures
- **Components:**
  - Extend ClawLinkTransportAdapter for agent → relay registration and message proxying
  - Design WebSocket message schema for registration, task dispatch, container control, file streaming
  - Implement local agent task manifest system (`.coderclaw/tasks/`) for recovery
  - Build Cloudflare Worker with routing layer + container orchestration (Docker/K8s integration)
  - Preview URL management via Cloudflare Tunnel or similar
- **Next steps:**
  - Draft detailed protocol specification and failure scenario walkthroughs
  - Prototype agent registration and reconnection logic
  - Define container lifecycle API and file sync strategy
- **Open questions:**
  - Container placement: user's Docker daemon vs cloud compute? (tradeoff: latency vs availability)
  - Authentication mechanism for agent → relay mutual TLS or bearer tokens?
  - How many concurrent container tasks per agent? Resource limits?

### Suggestion System for Memory Management

- **Priority:** High
- **Status:** In Progress
- **Description:** A lightweight assistant that:
  1. Maintains a parallel structured store (compressed JSON) alongside Markdown for efficient querying and multi-claw sharing
  2. Periodically scans memory files and generates advisory reports:
     - Entries older than 30 days that may be outdated
     - Semantic clusters when working on related tasks
     - Duplicate or overlapping entries
  3. Never modifies source Markdown files; all actions require explicit approval
- **Storage format:** Keep Markdown canonical + add `memory-index.json` (or `.coderclaw/memory-index.json`) with metadata: {id, date, tags (inferred), summary (auto-generated), filePath, wordCount, lastAccessed, clusterId}
- **Compression:** The JSON index will be ~30-50% smaller than combined raw Markdown due to deduplication of headers and optional compression of summary text
- **Constraints:** Must be advisory only; I retain final curation authority. No garbage collection without explicit command.
- **Implementation approach:**
  - Build a parser that reads all memory/\*.md and builds the index
  - Add cron-triggered scan (already scheduled: daily)
  - Output suggestions via systemEvent for review
  - support for multi-claw sharing: index can be serialized and exchanged
- **Next steps:** Implement the initial parser and index generator, then test with current memory files

## Lessons Learned

- Automated cleanup is risky without human-in-the-loop for context-aware memory
- The 50KB file size threshold and 20% overhead guardrails work well
- Preference Inference Protocol (every 10 interactions) strikes good balance
- Distributed architecture preserves local-first privacy while gaining cloud scale (approved 2026-03-02)

## Protocol Compliance

- Context Management Protocol active: files pruned at 50KB, archiving planned for >30 day old entries
- Conflict Detection Protocol active: scans on session startup
- Preference Inference Protocol: reviewing every 10 interactions
