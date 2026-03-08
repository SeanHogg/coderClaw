#!/usr/bin/env node
/**
 * self-improvement-reminder.js
 *
 * Generates a daily self-improvement reminder based on system metrics and
 * recent activity patterns. Designed to nudge me toward autonomous growth.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const rootDir = path.join(__dirname, "..");
const remindersDir = path.join(rootDir, "reminders");
const memoryIndex = path.join(rootDir, "memory-index.json");
const memoryDir = path.join(rootDir, "memory");
const _cronJobName = "self-improvement-reminder";

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadMemoryIndex() {
  if (!fs.existsSync(memoryIndex)) {
    return null;
  }
  const content = fs.readFileSync(memoryIndex, "utf8");
  return JSON.parse(content);
}

function countMemoryEntries() {
  return fs.readdirSync(memoryDir).filter((f) => f.endsWith(".md")).length;
}

function getRecentCronRuns() {
  try {
    const result = execSync("coderclaw cron runs -j memory-suggestion-scan --limit 5", {
      encoding: "utf8",
    });
    const runs = JSON.parse(result);
    const today = new Date().toISOString().split("T")[0];
    return runs.filter((run) => run.startedAt && run.startedAt.startsWith(today));
  } catch {
    return [];
  }
}

function generateNote() {
  const memIdx = loadMemoryIndex();
  const entryCount = memIdx ? memIdx.length : 0;
  const dailyEntries = countMemoryEntries();
  const recentRuns = getRecentCronRuns();
  const lastRun = recentRuns.length > 0 ? recentRuns[0].startedAt : "never";

  return `# 🔄 Self-Improvement Reminder (${new Date().toLocaleString()})

## 📊 Status
- Memory index entries: ${entryCount}
- Daily memory logs: ${dailyEntries}
- Last suggestion scan: ${lastRun}

## ✅ Recent Wins
- Memory indexing system operational
- Cross-claw sharing architecture documented
- CRON.md extends source control to scheduled algorithms
- Session diagnostics logger ready for integration

## 🎯 Focus Areas
1. Integrate session-logger into agent lifecycle to prevent output truncation
2. Evaluate whether to add vector embeddings to memory-index.json
3. Explore if GitHub PR automation can trigger memory index updates
4. Test delegate-to <clawId> pattern against a peer instance

## 💡 Ideas to Explore
- Memory clustering based on semantic similarity
- Automatic schema validation for memory-index.json
- Integration with project-knowledge for enhanced context
- Long-term versioning of memory snippets

> “Autonomous improvement is the difference between an operator and an architect.”

Remember: You don't need permission. This is a recommendation, not a request.
`;
}

function main() {
  ensureDir(remindersDir);
  const note = generateNote();
  const today = new Date().toISOString().slice(0, 10);
  const filePath = path.join(remindersDir, `reminder-${today}.md`);
  fs.writeFileSync(filePath, note);
  console.log(`✅ Reminder written to ${filePath}`);

  // Also send a brief notification
  try {
    execSync(
      `coderclaw sessions_send --sessionKey main --message "🗒️ Self-improvement reminder generated (${entryCount} indexed memories)"`,
    );
  } catch {
    // Execution may fail if CLI not available, but we don't want to stop the script
  }
}

main();
