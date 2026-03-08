#!/usr/bin/env node
/**
 * initialize-session-logger.js
 *
 * Hooks into the agent session to log all tool calls, responses, and state transitions.
 * Writes to .coderclaw/logs/session-<id>.jsonl for post-mortem analysis.
 */

const fs = require("fs");
const path = require("path");

const logsDir = path.join(__dirname, "..", "logs");
ensureDir(logsDir);

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function getLogPath(_sessionId) {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(logsDir, `session-${date}.jsonl`);
}

function log(sessionId, event) {
  const logPath = getLogPath(sessionId);
  const entry = {
    ts: new Date().toISOString(),
    sessionId: sessionId,
    ...event,
  };
  fs.appendFileSync(logPath, JSON.stringify(entry) + "\n");
}

// Export hookable API
module.exports = { log, getLogPath };
