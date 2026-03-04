import os from "node:os";
import path from "node:path";
import type { CoderClawConfig } from "../config/config.js";
import { downloadCoderClawLlmModel } from "../agents/transformers-stream.js";
import type { ApplyAuthChoiceParams, ApplyAuthChoiceResult } from "./auth-choice.apply.js";
import { applyPrimaryModel } from "./model-picker.js";

/** Provider ID written into the config for the local-brain entry. */
export const CODERCLAWLLM_LOCAL_PROVIDER_ID = "coderclawllm-local";
/** @deprecated Use CODERCLAWLLM_LOCAL_PROVIDER_ID */
export const TRANSFORMERS_PROVIDER_ID = CODERCLAWLLM_LOCAL_PROVIDER_ID;
// onnx-community/SmolLM2-1.7B-Instruct ships ONNX-quantized weights that are
// natively supported by @huggingface/transformers without any extra tooling.
export const TRANSFORMERS_DEFAULT_MODEL_ID = "onnx-community/SmolLM2-1.7B-Instruct";
export const TRANSFORMERS_DEFAULT_DTYPE = "q4";

const DTYPE_OPTIONS = ["q4", "q5", "q8", "fp16", "fp32"] as const;
type TransformersDtype = (typeof DTYPE_OPTIONS)[number];

function defaultCacheDir(): string {
  return path.join(os.homedir(), ".cache", "huggingface", "transformers");
}

function toModelKey(modelId: string): string {
  return `${TRANSFORMERS_PROVIDER_ID}/${modelId}`;
}

function applyTransformersProviderConfig(
  cfg: CoderClawConfig,
  modelId: string,
  dtype: string,
  cacheDir: string,
): CoderClawConfig {
  const next: CoderClawConfig = {
    ...cfg,
    models: {
      ...cfg.models,
      mode: cfg.models?.mode ?? "merge",
      providers: {
        ...cfg.models?.providers,
        [TRANSFORMERS_PROVIDER_ID]: {
          // baseUrl is repurposed as the model cache directory for this provider.
          baseUrl: cacheDir,
          api: "transformers",
          models: [
            {
              id: modelId,
              name: modelId,
              reasoning: false,
              input: ["text"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 8192,
              maxTokens: 2048,
              // dtype is stored as a custom header so attempt.ts can read it.
              headers: { "x-transformers-dtype": dtype },
            },
          ],
        },
      },
    },
  };

  return applyPrimaryModel(next, toModelKey(modelId));
}

export async function applyAuthChoiceTransformers(
  params: ApplyAuthChoiceParams,
): Promise<ApplyAuthChoiceResult | null> {
  if (params.authChoice !== "coderclawllm-local") {
    return null;
  }

  await params.prompter.note(
    [
      "CoderClawLLM local runs an ONNX-quantized brain (SmolLM2) directly in Node.js.",
      "It loads your .coderclaw memory on every request and routes heavy tasks to any",
      "other LLM you have configured (Ollama, OpenAI, vLLM, etc.).",
      "No server, no API key, no Python required.",
      "Requires: npm install @huggingface/transformers",
    ].join("\n"),
    "CoderClawLLM local brain",
  );

  const modelIdInput = await params.prompter.text({
    message: "HuggingFace model ID",
    initialValue: TRANSFORMERS_DEFAULT_MODEL_ID,
    placeholder: TRANSFORMERS_DEFAULT_MODEL_ID,
    validate: (value) => (String(value ?? "").trim() ? undefined : "Required"),
  });
  const modelId = String(modelIdInput ?? "").trim() || TRANSFORMERS_DEFAULT_MODEL_ID;

  const dtype = await params.prompter.select<TransformersDtype>({
    message: "Quantization dtype",
    options: DTYPE_OPTIONS.map((d) => ({
      value: d,
      label: d,
      hint:
        d === "q4"
          ? "~1 GB RAM — recommended"
          : d === "q5"
            ? "~1.2 GB RAM"
            : d === "q8"
              ? "~1.8 GB RAM — higher accuracy"
              : d === "fp16"
                ? "~3.4 GB RAM — full precision half"
                : "~6.8 GB RAM — full float32",
    })),
    initialValue: TRANSFORMERS_DEFAULT_DTYPE,
  });

  const cacheDirInput = await params.prompter.text({
    message: "Model cache directory",
    initialValue: defaultCacheDir(),
    placeholder: defaultCacheDir(),
    validate: (value) => (String(value ?? "").trim() ? undefined : "Required"),
  });
  const cacheDir = String(cacheDirInput ?? "").trim() || defaultCacheDir();

  const nextConfig = applyTransformersProviderConfig(
    params.config,
    modelId,
    String(dtype),
    cacheDir,
  );

  await params.prompter.note(
    [
      `CoderClawLLM local brain configured.`,
      `Model: ${modelId}   Dtype: ${String(dtype)}`,
      `Cache: ${cacheDir}`,
      `Model key: ${toModelKey(modelId)}`,
    ].join("\n"),
    "CoderClawLLM local — setup complete",
  );

  // ── Model download (required) ──────────────────────────────────────────────
  // The brain model must be present for CoderClawLLM to function.
  // Download it now with live progress rather than blocking silently on first use.
  let lastFile = "";
  const spinner = params.prompter.progress(
    `Downloading CoderClawLLM brain model (${modelId}, ${String(dtype)})…`,
  );
  try {
    await downloadCoderClawLlmModel({
      modelId,
      dtype: String(dtype),
      cacheDir,
      onProgress: (file, pct) => {
        if (file !== lastFile) {
          lastFile = file;
        }
        spinner.message(`Downloading ${path.basename(file)} — ${pct}%`);
      },
    });
    spinner.stop("Brain model downloaded and ready.");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    spinner.stop(
      `Download failed: ${msg}\nCheck your internet connection and re-run "coderclaw configure".`,
    );
    throw new Error(`CoderClawLLM brain model download failed: ${msg}`);
  }

  return { config: nextConfig };
}

