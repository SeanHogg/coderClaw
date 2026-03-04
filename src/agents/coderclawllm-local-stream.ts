/**
 * CoderClawLLM local brain — two-tier reasoning + execution engine.
 *
 * Every request flows through four capabilities:
 *
 *   1. RAG  — relevant workspace files are retrieved and injected into context
 *   2. Brain (SmolLM2 ONNX) — reasons with full .coderclaw memory + RAG context,
 *      decides to handle directly or DELEGATE, and may call tools
 *   3. Tool loop — if the brain emits tool calls, execute them and loop back
 *      (up to MAX_TOOL_ROUNDS rounds)
 *   4. Multi-step chain (on DELEGATE) — plan pass → execution LLM code pass
 *      → code-execution feedback → optional fix pass
 *
 * System requirements check:
 *   On first use, the factory checks available RAM and disk space.
 *   If the local model cannot be loaded (insufficient resources), the
 *   execution LLM configured in the runtime config is used as the brain
 *   instead, giving the same interface with no degradation to the caller.
 *
 * Sub-agents: each spawn creates a new runEmbeddedAttempt which re-runs the
 * streamFn setup, giving every sub-agent its own brain instance with freshly
 * loaded memory + RAG. No shared mutable state between invocations.
 */

import type { StreamFn } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, StopReason, TextContent, Usage } from "@mariozechner/pi-ai";
import { createAssistantMessageEventStream } from "@mariozechner/pi-ai";
import type { CoderClawConfig } from "../config/config.js";
import { logInfo } from "../logger.js";
import {
  TRANSFORMERS_DEFAULT_CACHE_DIR,
  TRANSFORMERS_DEFAULT_DTYPE,
  TRANSFORMERS_DEFAULT_MODEL_ID,
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

const MAX_TOOL_ROUNDS = 3;

// ── Brain system prompt ───────────────────────────────────────────────────────

const BRAIN_SYSTEM_PROMPT = `\
You are the CoderClaw brain — a reasoning intelligence grounded in memory and context.

Your loaded memory above contains everything you know: your identity, the user's preferences, \
long-term learnings, and recent daily activity. Use it to inform every response.

${TOOL_USAGE_HINT}

Your role:
1. Reason about the request using your memory and any relevant context provided.
2. Call tools if you need more information before answering (read_file, list_files, grep_files, run_code).
3. Decide: can you answer this well directly, or does it need a more capable model?

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

// ── Non-streaming OpenAI-compatible call ──────────────────────────────────────

async function callOpenAiCompatible(opts: {
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

    // Extract shared call args once to avoid duplication (#6).
    const callArgs = { modelId, messages, maxTokens, temperature, signal };

    if (cfg.api === "ollama") {
      const r = await callOllama({ baseUrl: cfg.baseUrl, ...callArgs });
      if (r !== null) return r;
    } else if (cfg.api === "openai-completions" || cfg.api === "openai-responses") {
      const apiKey = resolveApiKey(cfg.apiKey ?? "");
      if (!apiKey) continue;
      const r = await callOpenAiCompatible({ baseUrl: cfg.baseUrl, apiKey, ...callArgs });
      if (r !== null) return r;
    }
  }
  return null;
}

// ── Multi-step chain: plan → code → execution feedback ───────────────────────

async function runMultiStepChain(opts: {
  pipe: Awaited<ReturnType<typeof getOrCreatePipeline>>;
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
  signal?: AbortSignal;
}): Promise<string> {
  const { pipe, brainPlan, memoryBlock, ragContext, maxTokens, temperature } = opts;

  // ── Step 1: Plan pass — brain distils a numbered implementation plan ───────
  const planContext = [memoryBlock, ragContext, brainPlan].filter(Boolean).join("\n\n");
  const planMessages = convertToTransformersMessages(opts.rawMessages, planContext || undefined);
  planMessages.push({
    role: "user",
    content: "Produce a concise numbered implementation plan for the task above. Be specific.",
  });
  const plan = await runPipeline(pipe, planMessages, 256, 0.4);

  // ── Step 2: Code pass — execution LLM implements the plan ─────────────────
  const codeSystemParts = [
    opts.contextSystemPrompt ?? "",
    ragContext,
    `[CoderClaw implementation plan]\n${plan}`,
  ].filter(Boolean);

  const codeMessages = convertToTransformersMessages(
    opts.rawMessages,
    codeSystemParts.join("\n\n") || undefined,
  );

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
        );
        if (result.output.startsWith("Error:") || result.output.includes("SyntaxError")) {
          errorParts.push(result);
        }
      }
      if (errorParts.length > 0) {
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

  if (codeResult !== null) return codeResult;

  // Fallback: brain handles directly with memory context only (no routing prompt).
  const directMessages = convertToTransformersMessages(
    opts.rawMessages,
    [memoryBlock, ragContext].filter(Boolean).join("\n\n") || undefined,
  );
  return runPipeline(pipe, directMessages, maxTokens, temperature);
}

// ── Main StreamFn factory ─────────────────────────────────────────────────────

export type CoderClawLlmLocalStreamOptions = {
  /** Full runtime config — used to find and call configured execution LLMs. */
  config?: CoderClawConfig;
  /** Agent workspace dir (e.g. ~/.coderclaw/workspace) — for memory + RAG. */
  workspaceDir?: string;
  /** HuggingFace model ID for the local brain. */
  modelId?: string;
  /** Quantization dtype (q4, q5, q8, fp16, fp32). */
  dtype?: string;
  /** Directory where the ONNX model is cached. */
  cacheDir?: string;
  /**
   * When true (Discord, Slack, group sessions), MEMORY.md is not loaded to
   * avoid leaking personal curated knowledge to third parties.
   */
  isSharedContext?: boolean;
};

export function createCoderClawLlmLocalStreamFn(
  opts: CoderClawLlmLocalStreamOptions = {},
): StreamFn {
  const modelId = opts.modelId ?? TRANSFORMERS_DEFAULT_MODEL_ID;
  const dtype = opts.dtype ?? TRANSFORMERS_DEFAULT_DTYPE;
  const cacheDir = opts.cacheDir ?? TRANSFORMERS_DEFAULT_CACHE_DIR;

  // Lazy system-requirements check — performed once on the first request,
  // then cached for the lifetime of this factory instance.
  // null  = not yet checked
  // true  = local brain eligible
  // false = requirements not met; route all requests to external LLM
  let localBrainEligible: boolean | null = null;

  return (model, context, options) => {
    const stream = createAssistantMessageEventStream();

    const run = async () => {
      try {
        // ── 0. One-time system requirements check ─────────────────────────────
        if (localBrainEligible === null) {
          const check = await checkLocalBrainRequirements({ cacheDir, modelId });
          localBrainEligible = check.eligible;
          if (!check.eligible) {
            logInfo(`[coderclawllm] ${check.reason ?? "System requirements not met."}`);
          }
        }

        // ── 1. Load .coderclaw memory (long-term + short-term daily notes) ────
        const memoryBlock = opts.workspaceDir
          ? await loadCoderClawMemory(opts.workspaceDir, { isSharedContext: opts.isSharedContext })
          : "";

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

        const maxTokens = typeof options?.maxTokens === "number" ? options.maxTokens : 512;
        const temperature = typeof options?.temperature === "number" ? options.temperature : 0.6;
        const rawMessages = context.messages ?? [];

        // ── External brain fallback (requirements not met) ────────────────────
        // When the local model cannot be loaded, the configured execution LLM
        // acts as the brain.  Memory and RAG context are prepended to the
        // system prompt so it is grounded in the same .coderclaw knowledge.
        if (!localBrainEligible) {
          const externalSystemParts = [
            context.systemPrompt,
            memoryBlock,
            ragContext,
            BRAIN_SYSTEM_PROMPT,
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
            "I'm unable to process this request: no local brain model and no external LLM is configured.";

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
              // Token usage is not tracked for the brain provider (local or external fallback).
              // Zero values are intentional — same convention as the local-brain path below.
              usage: {
                input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
              },
              timestamp: Date.now(),
            } satisfies AssistantMessage,
          });
          return;
        }

        const brainSystem = [
          // Role/persona identity from the spawning context — this is where the
          // "--- Agent Persona ---" block injected by subagent-spawn.ts lives.
          // Including it here means the brain knows WHO it is on BOTH the direct
          // path AND the DELEGATE path (contextSystemPrompt already carries it).
          context.systemPrompt,
          memoryBlock,
          ragContext,
          BRAIN_SYSTEM_PROMPT,
        ]
          .filter(Boolean)
          .join("\n\n---\n\n");

        const pipe = await getOrCreatePipeline(modelId, dtype, cacheDir);

        // ── 3. Brain reasoning pass (always SmolLM2) ──────────────────────────
        let brainMessages = convertToTransformersMessages(rawMessages, brainSystem);
        let brainText = await runPipeline(pipe, brainMessages, 256, 0.4);

        // ── 4. Tool loop — execute tool calls the brain emitted ───────────────

        const wsDir = opts.workspaceDir;
        let toolRounds = 0;
        while (toolRounds < MAX_TOOL_ROUNDS && wsDir) {
          const calls = parseToolCalls(brainText);
          if (calls.length === 0) break;

          const results: ToolResult[] = [];
          for (const call of calls) {
            results.push(await executeToolCall(call, wsDir));
          }
          brainMessages = [
            ...brainMessages,
            { role: "assistant", content: brainText },
            { role: "user", content: `Tool results:\n\n${formatToolResults(results)}` },
          ];
          brainText = await runPipeline(pipe, brainMessages, 256, 0.4);
          toolRounds++;
        }

        const isDelegating = brainText.toUpperCase().trimStart().startsWith("DELEGATE");
        const brainPlan = brainText.replace(/^DELEGATE[:\s]*/i, "").trim();

        const finalText = isDelegating
          ? await runMultiStepChain({
              pipe,
              config: opts.config,
              rawMessages,
              contextSystemPrompt: context.systemPrompt,
              brainPlan,
              memoryBlock,
              ragContext,
              maxTokens,
              temperature,
              workspaceDir: wsDir,
              signal: options?.signal,
            })
          : brainText;

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
