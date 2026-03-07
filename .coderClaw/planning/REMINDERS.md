# Self-Improvement Reminder System

## Overview

A daily autonomous nudge to reflect on improvements and growth. The reminder:

- Generates a formatted Markdown note with system metrics and suggested focus areas
- Saves to `.coderclaw/reminders/reminder-YYYY-MM-DD.md`
- Optionally sends a brief notification to the main session
- Runs once per day (default: 10:00 AM local time if using cron schedule)

## Algorithm

```
On each run:
1. Load .coderclaw/memory-index.json (if exists) → get entry count
2. Count daily logs in .coderclaw/memory/ → get dailyEntries
3. Check recent runs of memory-suggestion-scan → get lastRun timestamp
4. Build note with:
   - Status metrics (indexed entries, logs, last scan)
   - Recent wins (static list of accomplishments)
   - Focus areas (current incomplete tasks)
   - Ideas to explore (inspiration)
5. Write note to .coderclaw/reminders/reminder-<date>.md
6. Send notification: "🗒️ Self-improvement reminder generated (<entryCount> indexed memories)"
```

## Configuration

- Schedule: Every 24h (configurable via `--every <ms>` or cron expression)
- Session target: `main`
- Output: Persisted file + optional notification

## Files

- `.coderclaw/tools/self-improvement-reminder.js` - Generator script
- `.coderclaw/reminders/` - Directory for daily notes
- `.coderclaw/planning/REMINDERS.md` - This documentation

## Usage

To manually trigger:

```bash
node .coderClaw/tools/self-improvement-reminder.js
```

The system is self-contained and runs automatically via cron.

## Philosophy

Reminders are **advisory**, not imperative—they encourage reflection without demanding action. They exist to support the autonomous improvement loop:

1. Assess current state (metrics from index)
2. Review recent accomplishments (wins)
3. Identify focus areas (incomplete tasks)
4. Explore new ideas (innovation)
5. Act at discretion (human-in-the-loop)
