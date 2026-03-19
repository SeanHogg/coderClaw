/**
 * Type declarations for mambacode.js — WebGPU-accelerated Mamba SSM library.
 *
 * Only the exports that are safe to call in Node.js (pure JS, no WebGPU)
 * are typed in detail.  GPU-dependent classes are typed as opaque objects
 * to prevent accidental instantiation in the server-side runtime.
 *
 * The main entry point (mambacode.js) references browser globals
 * (GPUBufferUsage) that are not available in Node.js.  The pure-JS
 * quantization utilities are imported via their explicit submodule path
 * (mambacode.js/src/utils/quantization.js) which has no GPU dependencies.
 *
 * https://github.com/SeanHogg/Mamba
 */

// ── Submodule: quantization utilities (Node.js safe) ────────────────────────
declare module "mambacode.js/src/utils/quantization.js" {
  /** Convert a 32-bit float to a 16-bit float packed as a Uint16 integer. */
  export function floatToFp16(val: number): number;
  /** Convert a packed Uint16 FP16 value back to a 32-bit float. */
  export function fp16ToFloat(fp16: number): number;
  /**
   * Quantize an array of 32-bit floats to FP16 packed integers.
   * @param values - Array of float32 values.
   * @returns Array of uint16 integers representing FP16 values.
   */
  export function quantizeFp16(values: number[]): number[];
  /**
   * Dequantize an array of FP16 packed integers back to float32.
   * @param fp16Values - Array of uint16 integers.
   * @returns Array of float32 values.
   */
  export function dequantizeFp16(fp16Values: number[]): number[];
  /** Quantize to Int8 with global scale. */
  export function quantizeInt8(values: number[]): { quantized: number[]; scale: number };
  /** Dequantize from Int8. */
  export function dequantizeInt8(quantized: number[], scale: number): number[];
  /** Quantize to Int8 with per-channel scales. */
  export function quantizeInt8PerChannel(
    values: number[],
    channels: number,
  ): { quantized: number[]; scales: number[] };
  /** Dequantize from per-channel Int8. */
  export function dequantizeInt8PerChannel(
    quantized: number[],
    scales: number[],
    channels: number,
  ): number[];
  /** Estimate GPU memory requirement in bytes for a given weight configuration. */
  export function estimateMemory(params: {
    vocabSize: number;
    dModel: number;
    numLayers: number;
    dState?: number;
    dConv?: number;
    expand?: number;
  }): number;
}

declare module "mambacode.js" {
  // ── Library metadata ─────────────────────────────────────────────────────
  export const VERSION: string;
  export const DESCRIPTION: string;

  // ── FP16 quantization utilities (pure JS — Node.js safe via submodule) ────
  export {
    floatToFp16,
    fp16ToFloat,
    quantizeFp16,
    dequantizeFp16,
    quantizeInt8,
    dequantizeInt8,
    quantizeInt8PerChannel,
    dequantizeInt8PerChannel,
    estimateMemory,
  } from "mambacode.js/src/utils/quantization.js";

  // ── Autograd utilities (pure JS — Node.js safe) ────────────────────────
  export class Tensor {
    data: Float32Array;
    shape: number[];
    requiresGrad: boolean;
    grad: Float32Array | null;
    constructor(data: Float32Array | number[], shape: number[], requiresGrad?: boolean);
  }
  export function crossEntropyLoss(logits: number[] | Float32Array, target: number): number;
  export function crossEntropyGrad(logits: number[] | Float32Array, target: number): number[];
  export function enableGrad(): void;
  export function noGrad(): void;
  export function clearTape(): void;
  export function backward(loss: Tensor): void;
  export function recordOperation(op: {
    inputs: Tensor[];
    output: Tensor;
    backward: () => void;
  }): void;

  // ── BPE Tokenizer (pure JS — Node.js safe) ────────────────────────────
  export class BPETokenizer {
    vocabSize: number;
    /** Load vocabulary and merge rules from URL paths. */
    load(vocabPath: string, mergesPath: string): Promise<void>;
    /** Load from in-memory objects (for bundled/test vocabularies). */
    loadFromObjects(vocab: Record<string, number>, merges: string[]): void;
    encode(text: string): number[];
    decode(ids: number[]): string;
  }

  // ── Raw WGSL kernel sources (string constants — Node.js safe) ───────────
  export const SELECTIVE_SCAN_FORWARD_WGSL: string;
  export const SELECTIVE_SCAN_BACKWARD_WGSL: string;
  export const CONV1D_FORWARD_WGSL: string;
  export const CONV1D_BACKWARD_WGSL: string;
  export const LINEAR_FORWARD_WGSL: string;
  export const LINEAR_BACKWARD_WGSL: string;
  export const WEIGHT_UPDATE_WGSL: string;
  export const GRAD_CLIP_WGSL: string;
  export const ACTIVATIONS_WGSL: string;
  export const ACTIVATIONS_BACKWARD_WGSL: string;

  // ── WebGPU utilities (browser only — require navigator.gpu) ─────────────
  /** @throws When called outside a browser with WebGPU support. */
  export function initWebGPU(opts?: {
    powerPreference?: "high-performance" | "low-power";
  }): Promise<{ device: unknown; adapter: unknown }>;
  export function createStorageBuffer(
    device: unknown,
    data: number[] | Float32Array,
    readable?: boolean,
  ): unknown;
  export function createEmptyStorageBuffer(
    device: unknown,
    byteSize: number,
    readable?: boolean,
  ): unknown;
  export function createUniformBuffer(device: unknown, data: ArrayBuffer): unknown;
  export function createComputePipeline(
    device: unknown,
    wgslSource: string,
    entryPoint: string,
  ): unknown;
  export function createBindGroup(
    device: unknown,
    pipeline: unknown,
    buffers: unknown[],
    groupIndex?: number,
  ): unknown;
  export function dispatchKernel(
    device: unknown,
    pipeline: unknown,
    bindGroup: unknown,
    workgroups: [number, number, number],
  ): void;
  export function readBuffer(
    device: unknown,
    srcBuffer: unknown,
    byteSize: number,
  ): Promise<Float32Array>;
  export function uploadBuffer(
    device: unknown,
    buffer: unknown,
    data: Float32Array,
    byteOffset?: number,
  ): void;
  export function cdiv(a: number, b: number): number;

  // ── Model / Trainer config ────────────────────────────────────────────────
  export interface MambaModelConfig {
    vocabSize: number;
    dModel: number;
    numLayers: number;
    dState?: number;
    dConv?: number;
    expand?: number;
  }

  export interface TrainOptions {
    learningRate?: number;
    epochs?: number;
    batchSize?: number;
    seqLen?: number;
    maxGradNorm?: number;
    weightDecay?: number;
    beta1?: number;
    beta2?: number;
    eps?: number;
    /** WSLA mode — fine-tune only B and C matrices for rapid local adaptation. */
    wsla?: boolean;
    onEpochEnd?: (epoch: number, loss: number) => void;
  }

  // ── Model and Trainer (WebGPU-dependent — browser only) ─────────────────
  export class MambaBlock {
    constructor(device: unknown, config: Omit<MambaModelConfig, "vocabSize" | "numLayers">);
  }

  export class MambaModel {
    config: Required<MambaModelConfig>;
    constructor(device: unknown, config: MambaModelConfig);
    forward(
      tokenIds: Uint32Array,
      batch: number,
      seqLen: number,
    ): Promise<{ logits: Float32Array; gpuLogits: unknown }>;
    generate(promptIds: number[], maxNewTokens: number, opts?: unknown): Promise<number[]>;
    parameters(): Array<{ buf: unknown; numel: number }>;
    setWSLAMode(enabled: boolean): void;
  }

  export class MambaTrainer {
    constructor(model: MambaModel, tokenizer?: BPETokenizer | null);
    train(input: string | number[], opts?: TrainOptions): Promise<number[]>;
    evaluate(input: string | number[]): Promise<number>;
  }
}
  // ── Library metadata ─────────────────────────────────────────────────────
  export const VERSION: string;
  export const DESCRIPTION: string;

  // ── FP16 quantization utilities (pure JS — Node.js safe) ─────────────────
  /** Convert a 32-bit float to a 16-bit float packed as a Uint16 integer. */
  export function floatToFp16(val: number): number;
  /** Convert a packed Uint16 FP16 value back to a 32-bit float. */
  export function fp16ToFloat(fp16: number): number;
  /**
   * Quantize an array of 32-bit floats to FP16 packed integers.
   * @param values - Array of float32 values.
   * @returns Array of uint16 integers representing FP16 values.
   */
  export function quantizeFp16(values: number[]): number[];
  /**
   * Dequantize an array of FP16 packed integers back to float32.
   * @param fp16Values - Array of uint16 integers.
   * @returns Array of float32 values.
   */
  export function dequantizeFp16(fp16Values: number[]): number[];

  /** Quantize to Int8 with global scale. */
  export function quantizeInt8(values: number[]): { quantized: number[]; scale: number };
  /** Dequantize from Int8. */
  export function dequantizeInt8(quantized: number[], scale: number): number[];
  /** Quantize to Int8 with per-channel scales. */
  export function quantizeInt8PerChannel(
    values: number[],
    channels: number,
  ): { quantized: number[]; scales: number[] };
  /** Dequantize from per-channel Int8. */
  export function dequantizeInt8PerChannel(
    quantized: number[],
    scales: number[],
    channels: number,
  ): number[];
  /** Estimate GPU memory requirement in bytes for a given weight configuration. */
  export function estimateMemory(params: {
    vocabSize: number;
    dModel: number;
    numLayers: number;
    dState?: number;
    dConv?: number;
    expand?: number;
  }): number;

  // ── Autograd utilities (pure JS — Node.js safe) ────────────────────────
  export class Tensor {
    data: Float32Array;
    shape: number[];
    requiresGrad: boolean;
    grad: Float32Array | null;
    constructor(data: Float32Array | number[], shape: number[], requiresGrad?: boolean);
  }
  export function crossEntropyLoss(logits: number[] | Float32Array, target: number): number;
  export function crossEntropyGrad(logits: number[] | Float32Array, target: number): number[];
  export function enableGrad(): void;
  export function noGrad(): void;
  export function clearTape(): void;
  export function backward(loss: Tensor): void;
  export function recordOperation(op: {
    inputs: Tensor[];
    output: Tensor;
    backward: () => void;
  }): void;

  // ── BPE Tokenizer (pure JS — Node.js safe) ────────────────────────────
  export class BPETokenizer {
    vocabSize: number;
    /** Load vocabulary and merge rules from URL paths. */
    load(vocabPath: string, mergesPath: string): Promise<void>;
    /** Load from in-memory objects (for bundled/test vocabularies). */
    loadFromObjects(vocab: Record<string, number>, merges: string[]): void;
    encode(text: string): number[];
    decode(ids: number[]): string;
  }

  // ── Raw WGSL kernel sources (string constants — Node.js safe) ───────────
  export const SELECTIVE_SCAN_FORWARD_WGSL: string;
  export const SELECTIVE_SCAN_BACKWARD_WGSL: string;
  export const CONV1D_FORWARD_WGSL: string;
  export const CONV1D_BACKWARD_WGSL: string;
  export const LINEAR_FORWARD_WGSL: string;
  export const LINEAR_BACKWARD_WGSL: string;
  export const WEIGHT_UPDATE_WGSL: string;
  export const GRAD_CLIP_WGSL: string;
  export const ACTIVATIONS_WGSL: string;
  export const ACTIVATIONS_BACKWARD_WGSL: string;

  // ── WebGPU utilities (browser only — require navigator.gpu) ─────────────
  /** @throws When called outside a browser with WebGPU support. */
  export function initWebGPU(opts?: {
    powerPreference?: "high-performance" | "low-power";
  }): Promise<{ device: unknown; adapter: unknown }>;
  export function createStorageBuffer(
    device: unknown,
    data: number[] | Float32Array,
    readable?: boolean,
  ): unknown;
  export function createEmptyStorageBuffer(
    device: unknown,
    byteSize: number,
    readable?: boolean,
  ): unknown;
  export function createUniformBuffer(device: unknown, data: ArrayBuffer): unknown;
  export function createComputePipeline(
    device: unknown,
    wgslSource: string,
    entryPoint: string,
  ): unknown;
  export function createBindGroup(
    device: unknown,
    pipeline: unknown,
    buffers: unknown[],
    groupIndex?: number,
  ): unknown;
  export function dispatchKernel(
    device: unknown,
    pipeline: unknown,
    bindGroup: unknown,
    workgroups: [number, number, number],
  ): void;
  export function readBuffer(
    device: unknown,
    srcBuffer: unknown,
    byteSize: number,
  ): Promise<Float32Array>;
  export function uploadBuffer(
    device: unknown,
    buffer: unknown,
    data: Float32Array,
    byteOffset?: number,
  ): void;
  export function cdiv(a: number, b: number): number;

  // ── Model / Trainer config ────────────────────────────────────────────────
  export interface MambaModelConfig {
    vocabSize: number;
    dModel: number;
    numLayers: number;
    dState?: number;
    dConv?: number;
    expand?: number;
  }

  export interface TrainOptions {
    learningRate?: number;
    epochs?: number;
    batchSize?: number;
    seqLen?: number;
    maxGradNorm?: number;
    weightDecay?: number;
    beta1?: number;
    beta2?: number;
    eps?: number;
    /** WSLA mode — fine-tune only B and C matrices for rapid local adaptation. */
    wsla?: boolean;
    onEpochEnd?: (epoch: number, loss: number) => void;
  }

  // ── Model and Trainer (WebGPU-dependent — browser only) ─────────────────
  export class MambaBlock {
    constructor(device: unknown, config: Omit<MambaModelConfig, "vocabSize" | "numLayers">);
  }

  export class MambaModel {
    config: Required<MambaModelConfig>;
    constructor(device: unknown, config: MambaModelConfig);
    forward(
      tokenIds: Uint32Array,
      batch: number,
      seqLen: number,
    ): Promise<{ logits: Float32Array; gpuLogits: unknown }>;
    generate(promptIds: number[], maxNewTokens: number, opts?: unknown): Promise<number[]>;
    parameters(): Array<{ buf: unknown; numel: number }>;
    setWSLAMode(enabled: boolean): void;
  }

  export class MambaTrainer {
    constructor(model: MambaModel, tokenizer?: BPETokenizer | null);
    train(input: string | number[], opts?: TrainOptions): Promise<number[]>;
    evaluate(input: string | number[]): Promise<number>;
  }
}
