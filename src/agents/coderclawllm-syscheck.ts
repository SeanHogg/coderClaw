/**
 * System requirements checker for the CoderClawLLM local brain.
 *
 * Before the first attempt to load the SmolLM2 ONNX pipeline we verify:
 *   1. Enough free RAM to run inference in-process
 *   2. Enough free disk space to download the model (skipped if already cached)
 *
 * The check is cheap (no network calls) and is performed once per process;
 * the result is cached so it does not add latency to subsequent requests.
 *
 * Model footprint for onnx-community/SmolLM2-1.7B-Instruct (q4):
 *   Disk  ~900 MB — downloaded once and cached in cacheDir
 *   RAM   ~1.5 GB — loaded into Node.js heap during inference
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/** Free disk space needed to safely download the model (bytes). */
export const MIN_DISK_BYTES = 1.5 * 1024 ** 3; // 1.5 GB

/** Free RAM needed to load and run the model in-process (bytes). */
export const MIN_RAM_BYTES = 2 * 1024 ** 3; // 2 GB

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type LocalBrainCheckResult = {
  /** Whether the system meets all requirements to run the local brain. */
  eligible: boolean;
  /**
   * Human-readable explanation when `eligible` is false.
   * Also logged at INFO level the first time the check runs.
   */
  reason?: string;
  /** Free RAM at check time (bytes). */
  freeRamBytes: number;
  /** Free disk space at check time (bytes); undefined when disk check was skipped. */
  freeDiskBytes?: number;
  /** True when model files are already present in cacheDir. */
  modelAlreadyCached: boolean;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a byte count as a human-readable string (KB / MB / GB). */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

/**
 * Determine whether the HuggingFace cache directory already contains the
 * model files.  Uses the standard `models--<org>--<name>` slug used by
 * the transformers.js / huggingface hub cache layout.
 */
export async function isModelCached(cacheDir: string, modelId: string): Promise<boolean> {
  const slug = `models--${modelId.replace("/", "--")}`;
  try {
    const stat = await fs.stat(path.join(cacheDir, slug));
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Read free disk space for the given path using `fs.statfs`.
 * Returns `null` on platforms/Node versions that do not support `statfs`.
 */
async function getFreeDiskBytes(targetPath: string): Promise<number | null> {
  try {
    // Ensure the directory exists before calling statfs; fall back to parent.
    let checkPath = targetPath;
    try {
      await fs.mkdir(targetPath, { recursive: true });
    } catch {
      checkPath = path.dirname(targetPath);
    }
    const stats = await fs.statfs(checkPath);
    return stats.bsize * stats.bavail;
  } catch {
    // fs.statfs requires Node 18+; silently skip disk check on unsupported platforms.
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main check
// ---------------------------------------------------------------------------

/**
 * Check whether the current system meets the minimum requirements to run
 * the local CoderClawLLM brain model.
 *
 * Safe to call concurrently — I/O is minimal (a stat + optional statfs).
 */
export async function checkLocalBrainRequirements(opts: {
  cacheDir: string;
  modelId: string;
}): Promise<LocalBrainCheckResult> {
  const freeRamBytes = os.freemem();

  // ── RAM check (always required) ──────────────────────────────────────────
  if (freeRamBytes < MIN_RAM_BYTES) {
    return {
      eligible: false,
      reason:
        `Insufficient RAM for local brain: ${formatBytes(freeRamBytes)} free, ` +
        `${formatBytes(MIN_RAM_BYTES)} required. ` +
        `Routing to external LLM.`,
      freeRamBytes,
      modelAlreadyCached: false,
    };
  }

  // ── Model cache check ────────────────────────────────────────────────────
  const modelAlreadyCached = await isModelCached(opts.cacheDir, opts.modelId);

  if (modelAlreadyCached) {
    // Model is on disk — no download needed, RAM is sufficient.
    return { eligible: true, freeRamBytes, modelAlreadyCached: true };
  }

  // ── Disk space check (only when download is needed) ──────────────────────
  const freeDiskBytes = await getFreeDiskBytes(opts.cacheDir);

  if (freeDiskBytes !== null && freeDiskBytes < MIN_DISK_BYTES) {
    return {
      eligible: false,
      reason:
        `Insufficient disk space to download local brain: ${formatBytes(freeDiskBytes)} free, ` +
        `${formatBytes(MIN_DISK_BYTES)} required. ` +
        `Routing to external LLM.`,
      freeRamBytes,
      freeDiskBytes,
      modelAlreadyCached: false,
    };
  }

  return {
    eligible: true,
    freeRamBytes,
    freeDiskBytes: freeDiskBytes ?? undefined,
    modelAlreadyCached: false,
  };
}
