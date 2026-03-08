#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const rootDir = path.join(__dirname, "..", "..");
const memoryDir = path.join(rootDir, ".coderClaw", "memory");
const _memIndexPath = path.join(rootDir, ".coderClaw", "memory-index.json");
const memFilePath = path.join(rootDir, "MEMORY.md");

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`📁 Created directory: ${dir}`);
  }
}

function createMemoryDir() {
  ensureDir(memoryDir);
  const today = new Date().toISOString().slice(0, 10);
  const todayFile = path.join(memoryDir, `${today}.md`);
  if (!fs.existsSync(todayFile)) {
    fs.writeFileSync(todayFile, `## [${new Date().toISOString()}] session:agent:main:default\n\n`);
    console.log(`📝 Created initial daily log: ${todayFile}`);
  }
}

function createMEMORYmd() {
  if (!fs.existsSync(memFilePath)) {
    const template = `# MEMORY.md - Curated Long-Term Memories

Last updated: ${new Date().toISOString().slice(0, 10)}

## Decisions

*(Record key decisions here)*

## Roadmap

*(Track planned improvements)*

## Lessons Learned

*(Document failures and insights)*

## Protocol Compliance

- Context Management Protocol: active
- Conflict Detection Protocol: active
- Preference Inference Protocol: reviewing every 10 interactions
`;
    fs.writeFileSync(memFilePath, template);
    console.log(`📝 Created MEMORY.md at ${memFilePath}`);
  } else {
    console.log(`✓ MEMORY.md already exists`);
  }
}

function generateIndex() {
  try {
    const scriptPath = path.join(__dirname, "generate-memory-index.cjs");
    execSync(`node "${scriptPath}"`, { cwd: rootDir, stdio: "inherit" });
  } catch (err) {
    console.error("❌ Failed to generate memory index:", err.message);
    process.exit(1);
  }
}

function scheduleCron() {
  const cronJobName = "memory-suggestion-scan";
  try {
    const listResult = execSync("coderclaw cron list --includeDisabled", { encoding: "utf8" });
    if (listResult.includes(cronJobName)) {
      console.log(`✓ Cron job "${cronJobName}" already exists`);
      return;
    }
  } catch {
    // continue to add
  }

  try {
    execSync(
      `coderclaw cron add --name "${cronJobName}" --every 86400000 --payload "Run memory suggestion scan" --sessionTarget main`,
      { cwd: rootDir, stdio: "inherit" },
    );
    console.log(`✅ Scheduled cron job: ${cronJobName} (daily)`);
  } catch (err) {
    console.error("❌ Failed to schedule cron job:", err.message);
  }
}

function main() {
  console.log("🔧 Initializing CoderClaw memory infrastructure...\n");
  createMemoryDir();
  createMEMORYmd();
  generateIndex();
  scheduleCron();
  console.log("\n✅ Memory initialization complete.");
}

main();
