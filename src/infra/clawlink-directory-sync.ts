import fs from "node:fs/promises";
import path from "node:path";
import {
  loadProjectContext,
  loadWorkspaceState,
  resolveCoderClawDir,
  updateWorkspaceState,
} from "../coderclaw/project-context.js";
import { readSharedEnvVar } from "./env-file.js";

type SyncLog = { warn: (msg: string) => void };

const MAX_FILE_BYTES = 512 * 1024;
const MAX_FILE_COUNT = 200;

function shouldSyncFile(filePath: string): boolean {
  const normalized = filePath.toLowerCase();
  if (normalized.includes(`${path.sep}node_modules${path.sep}`)) {
    return false;
  }
  if (normalized.endsWith(".png") || normalized.endsWith(".jpg") || normalized.endsWith(".jpeg")) {
    return false;
  }
  if (normalized.endsWith(".zip") || normalized.endsWith(".db")) {
    return false;
  }
  return true;
}

async function digestHex(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function collectFiles(
  root: string,
): Promise<Array<{ relPath: string; contentHash: string; sizeBytes: number; content: string }>> {
  const result: Array<{
    relPath: string;
    contentHash: string;
    sizeBytes: number;
    content: string;
  }> = [];

  const walk = async (dir: string) => {
    if (result.length >= MAX_FILE_COUNT) {
      return;
    }
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (result.length >= MAX_FILE_COUNT) {
        break;
      }
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile() || !shouldSyncFile(fullPath)) {
        continue;
      }
      const stat = await fs.stat(fullPath).catch(() => null);
      if (!stat || stat.size > MAX_FILE_BYTES) {
        continue;
      }
      const content = await fs.readFile(fullPath, "utf-8").catch(() => "");
      const relPath = path.relative(root, fullPath).replace(/\\/g, "/");
      result.push({
        relPath,
        content,
        sizeBytes: Buffer.byteLength(content, "utf-8"),
        contentHash: await digestHex(content),
      });
    }
  };

  await walk(root);
  return result;
}

export type SyncCoderClawDirParams = {
  workspaceDir: string;
  apiKey: string;
  baseUrl: string;
  clawId: string;
  projectId?: number;
  triggeredBy?: "startup" | "manual" | "api";
};

/**
 * Sync the .coderClaw/ directory to the CoderClawLink API.
 * Callable at any time — not just on startup.
 * Returns the number of files synced.
 */
export async function syncCoderClawDirectory(
  params: SyncCoderClawDirParams,
): Promise<{ fileCount: number }> {
  const baseUrl = params.baseUrl.replace(/\/+$/, "");
  const coderClawDir = resolveCoderClawDir(params.workspaceDir);
  const exists = await fs
    .stat(coderClawDir.root)
    .then((s) => s.isDirectory())
    .catch(() => false);
  if (!exists) {
    return { fileCount: 0 };
  }

  const files = await collectFiles(coderClawDir.root);

  const payload = {
    projectId: params.projectId,
    absPath: coderClawDir.root,
    status: "synced",
    metadata: {
      source: "sync",
      workspaceDir: params.workspaceDir,
      fileCount: files.length,
      triggeredBy: params.triggeredBy ?? "startup",
    },
    files,
  };

  const response = await fetch(
    `${baseUrl}/api/claws/${encodeURIComponent(params.clawId)}/directories/sync?key=${encodeURIComponent(params.apiKey)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    },
  ).catch((error) => ({ ok: false, statusText: String(error) }) as Response);

  if (!response.ok) {
    throw new Error(`sync failed: ${response.status} ${response.statusText}`);
  }
  return { fileCount: files.length };
}

/**
 * Same as syncCoderClawDirectory but also stamps lastSyncedAt / syncCount
 * into .coderClaw/workspace-state.json on success.
 * Returns the number of files that were synced.
 */
export async function syncCoderClawDirectoryWithMetaUpdate(
  params: SyncCoderClawDirParams,
): Promise<{ fileCount: number }> {
  const result = await syncCoderClawDirectory(params);
  const prev = await loadWorkspaceState(params.workspaceDir);
  await updateWorkspaceState(params.workspaceDir, {
    lastSyncedAt: new Date().toISOString(),
    syncCount: (prev.syncCount ?? 0) + 1,
  });
  return result;
}

export async function syncCoderClawDirectoryOnStartup(params: {
  workspaceDir: string;
  log: SyncLog;
}): Promise<void> {
  const apiKey = readSharedEnvVar("CODERCLAW_LINK_API_KEY")?.trim();
  const baseUrl = (readSharedEnvVar("CODERCLAW_LINK_URL") ?? "https://api.coderclaw.ai").replace(
    /\/+$/,
    "",
  );
  if (!apiKey) {
    return;
  }

  const ctx = await loadProjectContext(params.workspaceDir).catch(() => null);
  const clawId = ctx?.clawLink?.instanceId?.trim();
  if (!clawId) {
    return;
  }

  const projectId = ctx?.clawLink?.projectId ? Number(ctx.clawLink.projectId) : undefined;

  try {
    await syncCoderClawDirectoryWithMetaUpdate({
      workspaceDir: params.workspaceDir,
      apiKey,
      baseUrl,
      clawId,
      projectId,
    });
  } catch (err) {
    params.log.warn(`[clawlink] startup .coderClaw sync failed: ${String(err)}`);
  }
}
