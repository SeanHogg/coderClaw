import os from "node:os";
import path from "node:path";
import type { CoderClawConfig } from "../config/config.js";
import type { ApplyAuthChoiceParams, ApplyAuthChoiceResult } from "./auth-choice.apply.js";
import { applyPrimaryModel } from "./model-picker.js";

export const TRANSFORMERS_PROVIDER_ID = "transformers";
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
  if (params.authChoice !== "transformers-local") {
    return null;
  }

  await params.prompter.note(
    [
      "Transformers.js runs HuggingFace models directly in Node.js — no Ollama, no Python, no API key.",
      "The model is downloaded once and cached locally (~1 GB for SmolLM2-1.7B q4).",
      "Supported dtypes: q4 (default, ~1 GB), q5, q8 (higher accuracy, more RAM).",
      "Requires: npm install @huggingface/transformers",
    ].join("\n"),
    "Transformers.js local inference",
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
      `Configured Transformers.js provider with model: ${modelId}`,
      `Dtype: ${String(dtype)}   Cache: ${cacheDir}`,
      `Default model key: ${toModelKey(modelId)}`,
      "",
      "The model will be downloaded on first use (~1 GB for q4).",
    ].join("\n"),
    "Transformers.js setup complete",
  );

  return { config: nextConfig };
}
