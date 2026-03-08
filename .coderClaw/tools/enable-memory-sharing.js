#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const rootDir = path.join(__dirname, "..", "..");
const syncDir = path.join(rootDir, ".coderClaw", "memory-sync");
const configPath = path.join(syncDir, "config.yaml");

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function enableSharing() {
  if (fs.existsSync(configPath)) {
    console.log("✓ Memory sharing already enabled");
    return;
  }

  ensureDir(syncDir);

  const config = `enabled: true
sync:
  mode: push
  intervalMs: 86400000
  peers: []
conflictResolution: merge-preference-local
privacy:
  privateEntries: true
`;
  fs.writeFileSync(configPath, config);
  console.log(`✅ Memory sharing enabled. Config written to ${configPath}`);
  console.log("   Peer discovery will populate peers list automatically.");
}

ensureDir(syncDir);
enableSharing();
