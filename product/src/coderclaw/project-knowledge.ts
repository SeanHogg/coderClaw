import fs from "node:fs/promises";
import path from "node:path";
import { resolveCoderClawDir } from "./project-dir.js";

/**
 * Append a knowledge entry to .coderclaw/memory/YYYY-MM-DD.md.
 * Creates the file and directory if they do not exist.
 */
export async function appendKnowledgeMemory(projectRoot: string, entry: string): Promise<void> {
  const dir = resolveCoderClawDir(projectRoot);
  await fs.mkdir(dir.memoryDir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const filePath = path.join(dir.memoryDir, `${date}.md`);
  await fs.appendFile(filePath, entry, "utf-8");
}
