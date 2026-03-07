/**
 * CoderClawLLM local brain — dual ONNX preprocessor + cortex execution engine.
 *
 * Anatomy:
 *
 *   **Amygdala** (SmolLM2-1.7B, 8K ctx)
 *     — fast intent routing / triage (<200 ms)
 *     — decides HANDLE or DELEGATE
 *     — runs tool loop (read_file, list_files, grep_files, run_code)
 *
 *   **Hippocampus** (Phi-4-mini, 128K ctx)
 *     — memory consolidation & synthesis
 *     — prompt compression for the cortex
 *     — plan pass in the DELEGATE multi-step chain
 *
 *   **Cortex** (user's registered LLM)
 *     — complex reasoning, multi-file implementations
 *     — called on DELEGATE via callExecutionLlm()
 *
 * Request flow:
 *   1. RAG — relevant workspace files injected into context
 *   2. Amygdala — reasons with .coderclaw memory + RAG, runs tools, decides
 *      HANDLE or DELEGATE
 *   3. If HANDLE → amygdala response returned directly
 *   4. If DELEGATE → hippocampus distils a plan → cortex implements
 *      → code-execution feedback → optional fix pass
 *
 * Graceful degradation:
 *   - If amygdala can't load → cortex handles everything
 *   - If hippocampus can't load → amygdala does the plan pass (smaller context)
 */

import type { StreamFn } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, StopReason, TextContent, Usage } from "@mariozechner/pi-ai";
import { createAssistantMessageEventStream } from "@mariozechner/pi-ai";
import type { CoderClawConfig } from "../config/config.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import {
  TRANSFORMERS_DEFAULT_CACHE_DIR,
  TRANSFORMERS_DEFAULT_DTYPE,
  TRANSFORMERS_DEFAULT_MODEL_ID,
  HIPPOCAMPUS_DEFAULT_MODEL_ID,
  HIPPOCAMPUS_DEFAULT_DTYPE,
  convertToTransformersMessages,
  getOrCreatePipeline,
  loadCoderClawMemory,
} from "./transformers-stream.js";
import {
  TOOL_USAGE_HINT,
  executeToolCall,
  extractCodeBlocks,
  formatToolResults,
  parseToolCalls,
  type ToolResult,
} from "./coderclawllm-tools.js";
import { retrieveRelevantContext } from "./coderclawllm-rag.js";
import { checkLocalBrainRequirements } from "./coderclawllm-syscheck.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const log = createSubsystemLogger("brain");
const MAX_TOOL_ROUNDS = 3;

// ── Brain system prompt ───────────────────────────────────────────────────────

const AMYGDALA_SYSTEM_PROMPT = `\
You are the CoderClaw amygdala — the fast-routing intelligence grounded in memory and context.

Your loaded memory above contains everything you know: your identity, the user's preferences, \
long-term learnings, and recent daily activity. Use it to inform every response.

${TOOL_USAGE_HINT}

Your role:
1. Reason about the request using your memory and any relevant context provided.
2. Call tools if you need more information before answering (read_file, list_files, grep_files, run_code).
3. Decide: can you answer this well directly, or does it need the cortex (a more capable model)?

HANDLE DIRECTLY — respond normally:
- Reasoning, planning, decisions, and explanations
- Memory recall, preferences, and context-based answers
- Simple or short code (a single function or small snippet)
- Anything you can answer completely and correctly

DELEGATE — output exactly "DELEGATE" on the first line, then your reasoning/plan:
- Complex multi-function or multi-file implementations
- Deep debugging requiring broad codebase understanding
- Large refactors or architectural changes

Be decisive. Default to handling directly unless the task clearly exceeds your capabilities.`;

// ── Pipeline helper ───────────────────────────────────────────────────────────

type PipeOutput = Array<{ generated_text: string | Array<{ role: string; content: string }> }>;

function extractPipeText(output: PipeOutput): string {
  const first = output[0]?.generated_text;
  if (typeof first === "string") return first.trim();
  if (Array.isArray(first)) {
    const last = first.findLast((m: { role: string; content: string }) => m.role === "assistant");
    return (last?.content ?? "").trim();
  }
  return "";
}

async function runPipeline(
  pipe: Awaited<ReturnType<typeof getOrCreatePipeline>>,
  messages: Array<{ role: string; content: string }>,
  maxNewTokens: number,
  temperature: number,
): Promise<string> {
  const output = (await (pipe as (input: unknown, params: unknown) => Promise<unknown>)(
    messages,
    {
      max_new_tokens: maxNewTokens,
      temperature,
      do_sample: temperature > 0,
      top_p: 0.95,
      repetition_penalty: 1.1,
      return_full_text: false,
    },
  )) as PipeOutput;
  return extractPipeText(output);
}

// ── API-key resolution ────────────────────────────────────────────────────────

function resolveApiKey(configured: string): string | undefined {
  const t = configured.trim();
  if (!t) return undefined;
  // UPPER_SNAKE_CASE → env var name
  if (/^[A-Z][A-Z0-9_]{2,}$/.test(t)) return process.env[t]?.trim() || undefined;
  return t;
}

// ── Provider IDs to skip (avoids recursion / cloud-proxy confusion) ───────────

const SKIP_PROVIDERS = new Set(["coderclawllm", "coderclawllm-local", "transformers"]);

// ── Non-streaming Ollama call ─────────────────────────────────────────────────

async function callOllama(opts: {
  baseUrl: string;
  modelId: string;
  messages: Array<{ role: string; content: string }>;
  maxTokens: number;
  temperature: number;
  signal?: AbortSignal;
}): Promise<string | null> {
  const base =
    opts.baseUrl.replace(/\/v1\/?$/i, "").replace(/\/+$/, "") || "http://127.0.0.1:11434";
  try {
    const res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: opts.modelId,
        messages: opts.messages,
        stream: false,
        options: { num_predict: opts.maxTokens, temperature: opts.temperature },
      }),
      signal: opts.signal ?? AbortSignal.timeout(60_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { message?: { content?: string } };
    return data.message?.content?.trim() ?? null;
  } catch {
    return null;
  }
}

// ── Non-streaming OpenAI Chat Completions call ────────────────────────────────

async function callOpenAiCompletions(opts: {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  messages: Array<{ role: string; content: string }>;
  maxTokens: number;
  temperature: number;
  signal?: AbortSignal;
}): Promise<string | null> {
  try {
    const res = await fetch(`${opts.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` },
      body: JSON.stringify({
        model: opts.modelId,
        messages: opts.messages,
        max_tokens: opts.maxTokens,
        temperature: opts.temperature,
        stream: false,
      }),
      signal: opts.signal ?? AbortSignal.timeout(60_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content?.trim() ?? null;
  } catch {
    return null;
  }
}

// ── Non-streaming OpenAI Responses API call ───────────────────────────────────
// The Responses API (POST /responses) uses `input` instead of `messages`
// and returns output via `output[].content[].text`.

async function callOpenAiResponses(opts: {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  messages: Array<{ role: string; content: string }>;
  maxTokens: number;
  temperature: number;
  signal?: AbortSignal;
}): Promise<string | null> {
  type ResponsesOutput = {
    output?: Array<{
      type?: string;
      content?: Array<{ type?: string; text?: string }>;
    }>;
  };
  try {
    const res = await fetch(`${opts.baseUrl.replace(/\/+$/, "")}/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` },
      body: JSON.stringify({
        model: opts.modelId,
        input: opts.messages,
        max_output_tokens: opts.maxTokens,
        temperature: opts.temperature,
        stream: false,
        store: false,
      }),
      signal: opts.signal ?? AbortSignal.timeout(60_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as ResponsesOutput;
    for (const block of data.output ?? []) {
      if (block.type === "message") {
        for (const part of block.content ?? []) {
          if (part.type === "output_text" && part.text) return part.text.trim();
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ── Execution LLM router ──────────────────────────────────────────────────────

async function callExecutionLlm(opts: {
  config: CoderClawConfig | undefined;
  messages: Array<{ role: string; content: string }>;
  maxTokens: number;
  temperature: number;
  signal?: AbortSignal;
}): Promise<string | null> {
  const { config, messages, maxTokens, temperature, signal } = opts;

  for (const [id, cfg] of Object.entries(config?.models?.providers ?? {})) {
    if (SKIP_PROVIDERS.has(id.toLowerCase()) || !cfg?.baseUrl) continue;
    const modelId = cfg.models?.[0]?.id;
    if (!modelId) continue;

    const callArgs = { modelId, messages, maxTokens, temperature, signal };
    log.info(`cortex: calling execution LLM provider=${id} model=${modelId} api=${cfg.api ?? "unknown"}`);
    const t0 = Date.now();

    if (cfg.api === "ollama") {
      const r = await callOllama({ baseUrl: cfg.baseUrl, ...callArgs });
      if (r !== null) {
        log.info(`cortex: completed in ${Date.now() - t0}ms (${r.length} chars)`);
        return r;
      }
    } else if (cfg.api === "openai-completions") {
      const apiKey = resolveApiKey(cfg.apiKey ?? "");
      if (!apiKey) continue;
      const r = await callOpenAiCompletions({ baseUrl: cfg.baseUrl, apiKey, ...callArgs });
      if (r !== null) {
        log.info(`cortex: completed in ${Date.now() - t0}ms (${r.length} chars)`);
        return r;
      }
    } else if (cfg.api === "openai-responses") {
      const apiKey = resolveApiKey(cfg.apiKey ?? "");
      if (!apiKey) continue;
      const r = await callOpenAiResponses({ baseUrl: cfg.baseUrl, apiKey, ...callArgs });
      if (r !== null) {
        log.info(`cortex: completed in ${Date.now() - t0}ms (${r.length} chars)`);
        return r;
      }
    }
    log.info(`cortex: provider ${id} returned null — trying next provider`);
  }
  log.info("cortex: no execution LLM returned a result");
  return null;
}

// ── Multi-step chain: plan → code → execution feedback ───────────────────────

async function runMultiStepChain(opts: {
  amygdalaPipe: Awaited<ReturnType<typeof getOrCreatePipeline>>;
  hippocampusPipe: Awaited<ReturnType<typeof getOrCreatePipeline>> | null;
  config: CoderClawConfig | undefined;
  // Raw context messages (content: unknown) — converted internally as needed.
  rawMessages: Array<{ role: string; content: unknown }>;
  contextSystemPrompt: string | undefined;
  brainPlan: string;
  memoryBlock: string;
  ragContext: string;
  maxTokens: number;
  temperature: number;
  workspaceDir: string | undefined;
  /** Forwarded from factory opts — user must have explicitly opted in. */
  allowRunCode: boolean;
  signal?: AbortSignal;
}): Promise<string> {
  const { amygdalaPipe, hippocampusPipe, brainPlan, memoryBlock, ragContext, maxTokens, temperature } = opts;

  // Use hippocampus for the plan pass when available (128K ctx → better plans).
  // Fallback to amygdala if hippocampus couldn't be loaded.
  const planPipe = hippocampusPipe ?? amygdalaPipe;
  const planMaxTokens = hippocampusPipe ? 512 : 256;

  // ── Step 1: Plan pass — hippocampus distils a numbered implementation plan ─
  const planTier = hippocampusPipe ? "hippocampus" : "amygdala (fallback)";
  log.info(`${planTier}: starting plan pass...`);
  const planT0 = Date.now();
  const planContext = [memoryBlock, ragContext, brainPlan].filter(Boolean).join("\n\n");
  const planMessages = convertToTransformersMessages(opts.rawMessages, planContext || undefined);
  planMessages.push({
    role: "user",
    content: "Produce a concise numbered implementation plan for the task above. Be specific.",
  });
  const plan = await runPipeline(planPipe, planMessages, planMaxTokens, 0.4);
  log.info(`${planTier}: plan pass completed in ${Date.now() - planT0}ms`);

  // ── Step 2: Code pass — cortex (execution LLM) implements the plan ────────
  const codeSystemParts = [
    opts.contextSystemPrompt ?? "",
    ragContext,
    `[CoderClaw implementation plan]\n${plan}`,
  ].filter(Boolean);

  const codeMessages = convertToTransformersMessages(
    opts.rawMessages,
    codeSystemParts.join("\n\n") || undefined,
  );

  log.info("cortex: starting code pass...");
  let codeResult = await callExecutionLlm({
    config: opts.config,
    messages: codeMessages,
    maxTokens,
    temperature,
    signal: opts.signal,
  });

  // ── Step 3: Code execution feedback ───────────────────────────────────────
  const wsDir = opts.workspaceDir;
  if (codeResult && wsDir) {
    const blocks = extractCodeBlocks(codeResult);
    if (blocks.length > 0) {
      const errorParts: ToolResult[] = [];
      for (const block of blocks.slice(0, 2)) {
        const result = await executeToolCall(
          { tool: "run_code", code: block.code, lang: block.lang },
          wsDir,
          { allowRunCode: opts.allowRunCode },
        );
        if (result.output.startsWith("Error:") || result.output.includes("SyntaxError")) {
          errorParts.push(result);
        }
      }
      if (errorParts.length > 0) {
        log.info(`cortex: code produced ${errorParts.length} error(s) — requesting fix pass`);
        const fixMessages: Array<{ role: string; content: string }> = [
          ...codeMessages,
          { role: "assistant", content: codeResult },
          {
            role: "user",
            content: `The code above produced errors:\n\n${formatToolResults(errorParts)}\n\nPlease fix it.`,
          },
        ];
        const fixed = await callExecutionLlm({
          config: opts.config,
          messages: fixMessages,
          maxTokens,
          temperature,
          signal: opts.signal,
        });
        if (fixed !== null) codeResult = fixed;
      }
    }
  }

  if (codeResult !== null) {
    log.info("multi-step chain complete — cortex produced final answer");
    return codeResult;
  }

  // Fallback: amygdala handles directly with memory context only.
  log.info("cortex returned null — amygdala handling directly as fallback");
  const directMessages = convertToTransformersMessages(
    opts.rawMessages,
    [memoryBlock, ragContext].filter(Boolean).join("\n\n") || undefined,
  );
  return runPipeline(amygdalaPipe, directMessages, maxTokens, temperature);
}

// ── Main StreamFn factory ─────────────────────────────────────────────────────

export type CoderClawLlmLocalStreamOptions = {
  /** Full runtime config — used to find and call the cortex (execution LLM). */
  config?: CoderClawConfig;
  /** Agent workspace dir (e.g. ~/.coderclaw/workspace) — for memory + RAG. */
  workspaceDir?: string;
  /** Amygdala: HuggingFace model ID for the fast-routing brain. */
  modelId?: string;
  /** Amygdala: quantization dtype (q4, q5, q8, fp16, fp32). */
  dtype?: string;
  /** Hippocampus: HuggingFace model ID for memory/compression brain. */
  hippocampusModelId?: string;
  /** Hippocampus: quantization dtype. */
  hippocampusDtype?: string;
  /** Directory where the ONNX models are cached. */
  cacheDir?: string;
  /**
   * When true (Discord, Slack, group sessions), MEMORY.md is not loaded to
   * avoid leaking personal curated knowledge to third parties.
   */
  isSharedContext?: boolean;
  /**
   * Allow the amygdala to execute model-generated code via the `run_code` tool.
   *
   * **Security**: `run_code` spawns a Node.js child process inheriting the
   * same OS privileges as the CoderClaw process.  It is limited to a 10-second
   * timeout and the workspace directory, but it is NOT containerised.
   *
   * Only set this to `true` when the user has explicitly chosen the
   * `coderclawllm-local` provider (i.e. they already opted into local inference
   * and understand that model-generated code will run on their machine).
   * Defaults to `false` — `run_code` calls are silently blocked.
   */
  allowRunCode?: boolean;
};

export function createCoderClawLlmLocalStreamFn(
  opts: CoderClawLlmLocalStreamOptions = {},
): StreamFn {
  const modelId = opts.modelId ?? TRANSFORMERS_DEFAULT_MODEL_ID;
  const dtype = opts.dtype ?? TRANSFORMERS_DEFAULT_DTYPE;
  const hippocampusModelId = opts.hippocampusModelId ?? HIPPOCAMPUS_DEFAULT_MODEL_ID;
  const hippocampusDtype = opts.hippocampusDtype ?? HIPPOCAMPUS_DEFAULT_DTYPE;
  const cacheDir = opts.cacheDir ?? TRANSFORMERS_DEFAULT_CACHE_DIR;

  // Lazy system-requirements check — performed once on the first request,
  // then cached for the lifetime of this factory instance.
  // null  = not yet checked
  // true  = amygdala eligible
  // false = requirements not met; route all requests to cortex
  let amygdalaEligible: boolean | null = null;
  let hippocampusEligible: boolean | null = null;

  return (model, context, options) => {
    const stream = createAssistantMessageEventStream();

    const run = async () => {
      try {
        // ── 0. One-time system requirements check ─────────────────────────────
        if (amygdalaEligible === null) {
          const check = await checkLocalBrainRequirements({
            cacheDir,
            modelId,
            hippocampusModelId,
          });
          amygdalaEligible = check.eligible;
          hippocampusEligible = check.hippocampusEligible;
          if (!check.eligible) {
            log.info(`amygdala: ${check.reason ?? "system requirements not met"}`);
          }
          if (!check.hippocampusEligible) {
            log.info("hippocampus: insufficient RAM — plan pass will use amygdala");
          }
        }

        // ── 1. Load .coderclaw memory (long-term + short-term daily notes) ────
        const memoryBlock = opts.workspaceDir
          ? await loadCoderClawMemory(opts.workspaceDir, { isSharedContext: opts.isSharedContext })
          : "";
        if (memoryBlock) {
          log.info(`loaded .coderclaw memory (${memoryBlock.length} chars)`);
        }

        // ── 2. RAG — retrieve relevant workspace context ───────────────────────
        const lastUserMsg = [...(context.messages ?? [])].reverse()
          .find((m) => m.role === "user");
        const queryText =
          typeof lastUserMsg?.content === "string"
            ? lastUserMsg.content
            : (lastUserMsg?.content as Array<{ text?: string }>)?.[0]?.text ?? "";

        const ragContext =
          opts.workspaceDir && queryText
            ? await retrieveRelevantContext({ query: queryText, workspaceDir: opts.workspaceDir })
            : "";
        if (ragContext) {
          log.info(`RAG context retrieved (${ragContext.length} chars)`);
        }

        const maxTokens = typeof options?.maxTokens === "number" ? options.maxTokens : 512;
        const temperature = typeof options?.temperature === "number" ? options.temperature : 0.6;
        const rawMessages = context.messages ?? [];

        // ── Cortex fallback (amygdala requirements not met) ───────────────────
        // When the amygdala can't load, the cortex handles everything directly.
        // Memory and RAG context are prepended so it's grounded in .coderclaw.
        if (!amygdalaEligible) {
          log.info("amygdala not eligible → cortex handling entire request");
          const externalSystemParts = [
            context.systemPrompt,
            memoryBlock,
            ragContext,
            AMYGDALA_SYSTEM_PROMPT,
          ].filter(Boolean);

          const externalMessages = convertToTransformersMessages(
            rawMessages,
            externalSystemParts.join("\n\n---\n\n") || undefined,
          );

          const externalResult = await callExecutionLlm({
            config: opts.config,
            messages: externalMessages,
            maxTokens,
            temperature,
            signal: options?.signal,
          });

          const finalText =
            externalResult ??
            "I'm unable to process this request: no amygdala model and no cortex (external LLM) is configured.";

          const externalContent: TextContent[] = finalText
            ? [{ type: "text" as const, text: finalText }]
            : [];
          stream.push({
            type: "done",
            reason: "stop",
            message: {
              role: "assistant",
              content: externalContent,
              stopReason: "stop" as StopReason,
              api: model.api,
              provider: model.provider,
              model: model.id,
              usage: {
                input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
              },
              timestamp: Date.now(),
            } satisfies AssistantMessage,
          });
          return;
        }

        const amygdalaSystem = [
          context.systemPrompt,
          memoryBlock,
          ragContext,
          AMYGDALA_SYSTEM_PROMPT,
        ]
          .filter(Boolean)
          .join("\n\n---\n\n");

        const amygdalaPipe = await getOrCreatePipeline(modelId, dtype, cacheDir);

        // Lazily load hippocampus pipeline only when eligible.
        let hippocampusPipe: Awaited<ReturnType<typeof getOrCreatePipeline>> | null = null;
        if (hippocampusEligible) {
          try {
            hippocampusPipe = await getOrCreatePipeline(hippocampusModelId, hippocampusDtype, cacheDir);
          } catch {
            log.info("hippocampus: failed to load pipeline — plan pass will use amygdala");
            hippocampusEligible = false;
          }
        }

        // ── 3. Amygdala reasoning pass (fast routing) ─────────────────────────
        log.info("amygdala: starting reasoning pass...");
        const amygdalaT0 = Date.now();
        let amygdalaMessages = convertToTransformersMessages(rawMessages, amygdalaSystem);
        let amygdalaText = await runPipeline(amygdalaPipe, amygdalaMessages, 256, 0.4);
        log.info(`amygdala: reasoning pass completed in ${Date.now() - amygdalaT0}ms`);

        // ── 4. Tool loop — execute tool calls the amygdala emitted ────────────

        const wsDir = opts.workspaceDir;
        let toolRounds = 0;
        while (toolRounds < MAX_TOOL_ROUNDS && wsDir) {
          const calls = parseToolCalls(amygdalaText);
          if (calls.length === 0) break;

          toolRounds++;
          log.info(`amygdala: tool round ${toolRounds}/${MAX_TOOL_ROUNDS} — ${calls.length} call(s): ${calls.map((c) => c.tool).join(", ")}`);
          const results: ToolResult[] = [];
          for (const call of calls) {
            results.push(await executeToolCall(call, wsDir, { allowRunCode: opts.allowRunCode }));
          }
          amygdalaMessages = [
            ...amygdalaMessages,
            { role: "assistant", content: amygdalaText },
            { role: "user", content: `Tool results:\n\n${formatToolResults(results)}` },
          ];
          amygdalaText = await runPipeline(amygdalaPipe, amygdalaMessages, 256, 0.4);
        }

        const isDelegating = amygdalaText.toUpperCase().trimStart().startsWith("DELEGATE");
        const brainPlan = amygdalaText.replace(/^DELEGATE[:\s]*/i, "").trim();

        log.info(`routing: amygdala decision=${isDelegating ? "DELEGATE → hippocampus/cortex" : "HANDLE (responding directly)"}`);

        // ── 5. DELEGATE → hippocampus plans, cortex executes ──────────────────
        if (isDelegating) {
          log.info(`routing: entering multi-step chain hippocampus=${hippocampusPipe ? "loaded" : "unavailable (amygdala fallback)"} cortex=configured`);
        }
        const finalText = isDelegating
          ? await runMultiStepChain({
              amygdalaPipe,
              hippocampusPipe,
              config: opts.config,
              rawMessages,
              contextSystemPrompt: context.systemPrompt,
              brainPlan,
              memoryBlock,
              ragContext,
              maxTokens,
              temperature,
              workspaceDir: wsDir,
              allowRunCode: opts.allowRunCode ?? false,
              signal: options?.signal,
            })
          : amygdalaText;
        log.info(`response ready (${finalText.length} chars, total=${Date.now() - amygdalaT0}ms)`);

        const content: TextContent[] = finalText
          ? [{ type: "text" as const, text: finalText }]
          : [];

        const usage: Usage = {
          input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        };

        stream.push({
          type: "done",
          reason: "stop",
          message: {
            role: "assistant",
            content,
            stopReason: "stop" as StopReason,
            api: model.api,
            provider: model.provider,
            model: model.id,
            usage,
            timestamp: Date.now(),
          } satisfies AssistantMessage,
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        stream.push({
          type: "error",
          reason: "error",
          error: {
            role: "assistant" as const,
            content: [],
            stopReason: "error" as StopReason,
            errorMessage,
            api: model.api,
            provider: model.provider,
            model: model.id,
            usage: {
              input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            timestamp: Date.now(),
          },
        });
      } finally {
        stream.end();
      }
    };

    queueMicrotask(() => void run());
    return stream;
  };
}
