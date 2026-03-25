/**
 * SsmMemoryService – loads/manages the SSMjs runtime and SSMAgent
 * for CoderClaw's local hippocampus memory layer.
 *
 * GPU initialisation is optional: if @webgpu/node is unavailable or the GPU
 * fails to initialise the service still starts and serves memory-only
 * operations.  SSM inference is disabled in that case.
 */

import { logDebug } from "../logger.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SsmMemoryServiceOptions {
  /**
   * Path to the model checkpoint binary.
   * Default: '.coderClaw/model.bin'
   */
  checkpointPath?: string;
  /** Anthropic API key forwarded to an optional bridge (unused in memory-only mode). */
  anthropicApiKey?: string;
  /**
   * MambaKit model size preset.
   * Default: 'small'
   */
  modelSize?: "nano" | "small" | "medium" | "large";
}

// ── Lazy module imports ───────────────────────────────────────────────────────
// We import SSMjs types dynamically so that a missing package does not prevent
// the rest of the gateway from starting.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SSMRuntime = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SSMAgent = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MemoryStore = any;

// ── SsmMemoryService ──────────────────────────────────────────────────────────

export class SsmMemoryService {
  readonly runtime: SSMRuntime;
  readonly agent: SSMAgent;
  readonly memory: MemoryStore;
  readonly gpuAvailable: boolean;

  private constructor(
    runtime: SSMRuntime,
    agent: SSMAgent,
    memory: MemoryStore,
    gpuAvailable: boolean,
  ) {
    this.runtime = runtime;
    this.agent = agent;
    this.memory = memory;
    this.gpuAvailable = gpuAvailable;
  }

  /**
   * Creates and initialises a new SsmMemoryService.
   *
   * GPU init is attempted first; if it fails (no @webgpu/node or no GPU),
   * the service falls back to memory-only operation (gpuAvailable = false).
   * Never throws — returns null if the SSMjs package itself is missing.
   */
  static async create(opts: SsmMemoryServiceOptions = {}): Promise<SsmMemoryService | null> {
    const checkpointPath = opts.checkpointPath ?? ".coderClaw/model.bin";
    const modelSize = opts.modelSize ?? "small";

    // Use indirect import to prevent TypeScript from resolving optional peer packages
    // that may not be installed. All three packages are optional runtime dependencies.
    const _import = (m: string): Promise<unknown> =>
      // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
      new Function("m", "return import(m)")(m) as Promise<unknown>;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let ssmjsMod: any;
    try {
      // Dynamic import so a missing package is a runtime no-op
      ssmjsMod = await _import("@seanhogg/ssmjs");
    } catch {
      logDebug("[ssm-memory] @seanhogg/ssmjs not available — skipping SSM memory layer");
      return null;
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
    const { SSMRuntime, MemoryStore, SSMAgent } = ssmjsMod as Record<string, any>;

    // IDBFactory — always available via fake-indexeddb
    let idbFactory: unknown;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fakeIdb = (await _import("fake-indexeddb")) as any;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      idbFactory = new fakeIdb.IDBFactory();
    } catch {
      logDebug("[ssm-memory] fake-indexeddb not available — IndexedDB will use global");
    }

    // GPU adapter — optional
    let gpuAdapter: unknown;
    let gpuAvailable = false;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const webgpuNode = (await _import("@webgpu/node")) as any;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      gpuAdapter = await webgpuNode
        .create()
        .requestAdapter({ powerPreference: "high-performance" });
      gpuAvailable = gpuAdapter != null;
    } catch {
      logDebug("[ssm-memory] @webgpu/node unavailable — SSM inference disabled");
    }

    // Build session options
    const sessionOpts: Record<string, unknown> = {
      modelSize,
      idbFactory,
    };
    if (gpuAdapter) {
      sessionOpts["gpuAdapter"] = gpuAdapter;
    } else {
      sessionOpts["allowCpuFallback"] = true;
    }
    // Load checkpoint if it exists — ignore errors (model starts with random weights)
    sessionOpts["checkpointUrl"] = checkpointPath;

    // Create runtime
    let runtime: SSMRuntime;
    try {
      runtime = await SSMRuntime.create({ session: sessionOpts });
      logDebug(`[ssm-memory] SSMRuntime created (gpu=${gpuAvailable})`);
    } catch (err) {
      logDebug(`[ssm-memory] SSMRuntime.create() failed: ${String(err)}`);
      return null;
    }

    // Memory store
    const memory = new MemoryStore({ idbFactory });

    // Try to restore checkpoint weights
    try {
      await memory.loadWeights(runtime);
      logDebug("[ssm-memory] checkpoint weights loaded");
    } catch {
      logDebug("[ssm-memory] no checkpoint weights found — using freshly initialised weights");
    }

    // Agent
    const agent = new SSMAgent({ runtime, memory, persistHistory: true });
    try {
      await agent.init();
    } catch {
      // init() failure is non-fatal (no persisted history yet)
    }

    return new SsmMemoryService(runtime, agent, memory, gpuAvailable);
  }

  // ── Delegates ─────────────────────────────────────────────────────────────

  /**
   * Stores a fact in memory.
   * Delegates to `agent.memory.remember()`.
   */
  async remember(
    key: string,
    content: string,
    opts?: { ttlMs?: number; tags?: string[]; importance?: number },
  ): Promise<void> {
    await this.memory.remember(key, content, opts);
  }

  /**
   * Returns the top-K semantically similar entries to `query`.
   * Falls back to an empty array if the runtime is unavailable.
   */
  async recallSimilar(query: string, topK = 5): Promise<Array<{ key: string; content: string }>> {
    try {
      const entries = await this.memory.recallSimilar(query, topK, this.runtime);
      return entries as Array<{ key: string; content: string }>;
    } catch {
      return [];
    }
  }

  /**
   * Fine-tunes the SSM on `text` (WSLA adaptation).
   * No-op when GPU is not available.
   */
  async learn(text: string): Promise<void> {
    if (!this.gpuAvailable) {
      return;
    }
    try {
      await this.agent.learn(text);
    } catch (err) {
      logDebug(`[ssm-memory] learn() failed: ${String(err)}`);
    }
  }

  /**
   * Saves current SSM weights to IndexedDB (the checkpoint).
   */
  async saveCheckpoint(): Promise<void> {
    try {
      await this.memory.saveWeights(this.runtime);
      logDebug("[ssm-memory] checkpoint saved");
    } catch (err) {
      logDebug(`[ssm-memory] saveCheckpoint() failed: ${String(err)}`);
    }
  }

  /**
   * Runs distillation on a batch of inputs (if available) and saves weights.
   */
  async distillAndSave(inputs: string[]): Promise<void> {
    if (!this.gpuAvailable || inputs.length === 0) {
      return;
    }
    try {
      for (const input of inputs) {
        await this.agent.learn(input);
      }
      await this.saveCheckpoint();
    } catch (err) {
      logDebug(`[ssm-memory] distillAndSave() failed: ${String(err)}`);
    }
  }

  /**
   * Returns the top-5 recent team memory entries formatted as a context block.
   * Delegates to the KnowledgeLoopService.pullTeamMemory() if available.
   * Returns an empty string when team memory is unavailable.
   * (P4-5)
   */
  async buildTeamMemoryContext(): Promise<string> {
    // Lazy import to avoid circular dependencies
    let knowledgeLoop:
      | {
          pullTeamMemory?: (
            limit?: number,
          ) => Promise<Array<{ summary?: string; clawId?: string; timestamp?: string }>>;
        }
      | undefined;
    try {
      const mod = await import("./knowledge-loop.js");
      // The KnowledgeLoopService singleton is managed externally; access via a
      // module-level getter if exposed.  If not exposed, return empty string.
      if (typeof mod.getKnowledgeLoopService === "function") {
        knowledgeLoop = mod.getKnowledgeLoopService() as typeof knowledgeLoop;
      }
    } catch {
      return "";
    }
    if (!knowledgeLoop?.pullTeamMemory) {
      return "";
    }
    try {
      const entries = await knowledgeLoop.pullTeamMemory(5);
      if (!entries || entries.length === 0) {
        return "";
      }
      const lines = ["[Team Memory Context]"];
      for (const entry of entries) {
        const who = entry.clawId ? `claw:${entry.clawId}` : "unknown";
        const when = entry.timestamp ? ` (${entry.timestamp.slice(0, 10)})` : "";
        lines.push(`- [${who}${when}] ${entry.summary ?? ""}`);
      }
      lines.push("[End Team Memory Context]");
      return lines.join("\n") + "\n";
    } catch {
      return "";
    }
  }

  /**
   * Destroys the SSM runtime and releases GPU resources.
   */
  async destroy(): Promise<void> {
    try {
      await this.agent.destroy();
    } catch {
      try {
        this.runtime.destroy();
      } catch {
        // ignore
      }
    }
  }
}

// ── Singleton accessor ────────────────────────────────────────────────────────

let _instance: SsmMemoryService | null = null;

/** Returns the gateway-level SSM memory service singleton, or null if not initialised. */
export function getSsmMemoryService(): SsmMemoryService | null {
  return _instance;
}

/** Called once at gateway startup to initialise the SSM memory service. */
export async function initSsmMemoryService(
  opts?: SsmMemoryServiceOptions,
): Promise<SsmMemoryService | null> {
  try {
    _instance = await SsmMemoryService.create(opts ?? {});
    if (_instance) {
      logDebug(`[ssm-memory] initialised (gpu=${_instance.gpuAvailable})`);
    }
  } catch (err) {
    logDebug(`[ssm-memory] init failed: ${String(err)}`);
    _instance = null;
  }
  return _instance;
}
