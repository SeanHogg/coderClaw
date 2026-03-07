# Cron Jobs & Scheduled Algorithms

This section defines all automated background tasks. Each job is described as code/algorithm, not just CLI commands, for version control and review.

## memory-suggestion-scan

**Schedule:** every 24 hours (86400000 ms)  
**Trigger:** `coderclaw cron add --name "memory-suggestion-scan" --every 86400000 --payload "Run memory suggestion scan" --sessionTarget main`

**Algorithm:**

```
1. Load memory-index.json (or regenerate if missing)
2. For each entry:
   - If entry.date > 30 days ago AND lastAccessed < 7 days ago → flag as "stale"
   - Compute tag frequency across all entries → identify popular clusters
   - If any two entries share >80% content similarity → flag as "duplicate"
3. Build advisory report:
   {
     "staleEntries": [ {id, date, summary} ],
     "popularClusters": [ {tag, count} ],
     "potentialDuplicates": [ [entryId1, entryId2] ]
   }
4. Emit systemEvent to main session with report as JSON
5. Update lastAccessed timestamp for all entries in memory-index.json (refresh cache)
```

**Output:** Sent as a systemEvent to the main session for review. No automatic actions taken.

**Configuration:**

- Input: `.coderclaw/memory-index.json`
- Output: systemEvent → main session
- Side effects: none (read-only)

## Future Jobs

- `memory-index-rebuild` (weekly): regenerate index from source Markdown to ensure consistency
- `memory-sync-push` (if sharing enabled): push index to peers via `claw_fleet` webhook
- `memory-sync-pull` (if sharing enabled): pull remote indexes and merge suggestions

---

_Note: All cron jobs are defined here for auditability. The actual registration is performed by `initialize-memory.js` and `enable-memory-sharing.js` scripts located in `.coderclaw/tools/`._
