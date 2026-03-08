const fs = require("fs");
const path = require("path");

const _memoryDir = path.join(__dirname, "..", "..", "memory");
const indexPath = path.join(__dirname, "..", "memory-index.json");

function parseMemoryFile(filePath, fileName) {
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split("\n");
  const entries = [];
  let currentEntry = null;

  for (let line of lines) {
    const timestampMatch = line.match(/^## \[([^\]]+)\](.*)$/);
    if (timestampMatch) {
      if (currentEntry) {
        entries.push(currentEntry);
      }
      const timestamp = timestampMatch[1];
      const remainder = timestampMatch[2].trim();
      currentEntry = {
        id: `${fileName}:${timestamp}`,
        date: timestamp,
        filePath: path.join("memory", fileName),
        session: remainder,
        content: "",
        tags: [],
      };
    } else if (currentEntry && line.trim()) {
      currentEntry.content += (currentEntry.content ? "\n" : "") + line;
    }
  }
  if (currentEntry) {
    entries.push(currentEntry);
  }

  return entries.map((entry) => {
    const cont = entry.content || "";
    const clean = cont.replace(/[#*_`]/g, "").trim();
    const summary = clean.length > 120 ? clean.substring(0, 120) + "..." : clean;

    const hashtagTags = [...cont.matchAll(/#(\w+)/g)].map((m) => m[1]);
    const wordTags = cont.match(
      /\b(protocol|suggestion|memory|conflict|error|session|cron|heartbeat|decision|rejected|approved|roadmap|lessons?)\b/gi,
    )
      ? cont
          .match(
            /\b(protocol|suggestion|memory|conflict|error|session|cron|heartbeat|decision|rejected|approved|roadmap|lessons?)\b/gi,
          )
          .map((t) => t.toLowerCase())
      : [];
    const tags = [...new Set([...hashtagTags, ...wordTags])];

    const wordCount = clean.split(/\s+/).filter((w) => w.length > 0).length;

    return {
      ...entry,
      summary,
      tags,
      wordCount,
      clusterId: null,
      lastAccessed: new Date().toISOString(),
    };
  });
}

const memoryBaseDir = path.join(__dirname, "..", "memory");
const files = fs.readdirSync(memoryBaseDir).filter((f) => f.endsWith(".md"));
let allEntries = [];
for (const file of files) {
  const filePath = path.join(memoryBaseDir, file);
  const fileEntries = parseMemoryFile(filePath, file);
  allEntries = allEntries.concat(fileEntries);
}

allEntries.sort((a, b) => new Date(b.date) - new Date(a.date));
fs.writeFileSync(indexPath, JSON.stringify(allEntries, null, 2));
console.log(`✅ Memory index built: ${allEntries.length} entries from ${files.length} files`);
console.log(`   Index saved to: ${indexPath}`);
console.log(`   Total index size: ${(fs.statSync(indexPath).size / 1024).toFixed(1)} KB`);
