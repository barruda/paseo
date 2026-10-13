// CUSTOM(local-speech-gpu): run local speech recognition and synthesis on an NVIDIA GPU.
//
// PASEO_LOCAL_SPEECH_CUDA_DIR names a directory holding sherpa-onnx's CUDA build
// (libsherpa-onnx-c-api.so, libonnxruntime*.so) plus the CUDA 12 / cuDNN 9 runtime
// libraries. custom/local-speech-gpu/setup.sh prepares it. When the variable is set,
// the worker loads those libraries ahead of the CPU-only npm package and asks
// sherpa-onnx for the CUDA execution provider. Silero VAD stays on the CPU: one
// 32 ms window per GPU launch costs ~8x more CPU than running it there.
import path from "node:path";

import { prependEnvPath, sherpaLoaderEnvKey } from "./sherpa/sherpa-runtime-env.js";

export type LocalSpeechExecutionProvider = "cpu" | "cuda";

export const LOCAL_SPEECH_CUDA_DIR_ENV = "PASEO_LOCAL_SPEECH_CUDA_DIR";

export function resolveLocalSpeechExecutionProvider(
  env: NodeJS.ProcessEnv = process.env,
): LocalSpeechExecutionProvider {
  return env[LOCAL_SPEECH_CUDA_DIR_ENV]?.trim() ? "cuda" : "cpu";
}

// Call after applySherpaLoaderEnv so the CUDA build shadows the CPU package's libraries.
export function applyLocalSpeechCudaLoaderEnv(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const cudaDir = env[LOCAL_SPEECH_CUDA_DIR_ENV]?.trim();
  const key = sherpaLoaderEnvKey(platform);
  if (!cudaDir || key !== "LD_LIBRARY_PATH") {
    return false;
  }
  env[key] = prependEnvPath(env[key], path.resolve(cudaDir));
  return true;
}

// ONNX Runtime's CUDA fusions break the fp16 Parakeet encoder (SkipLayerNorm overflow,
// fp16 length arithmetic). setup.sh writes a patched copy next to the original as
// encoder.<precision>-cuda.onnx; prefer it whenever we run on CUDA.
export interface ResolveTransducerEncoderFileParams {
  modelDir: string;
  encoderFile: string;
  provider: LocalSpeechExecutionProvider;
  exists: (filePath: string) => boolean;
}

export function resolveTransducerEncoderFile({
  modelDir,
  encoderFile,
  provider,
  exists,
}: ResolveTransducerEncoderFileParams): string {
  const original = path.join(modelDir, encoderFile);
  if (provider !== "cuda") {
    return original;
  }
  const patched = path.join(modelDir, encoderFile.replace(/\.onnx$/, "-cuda.onnx"));
  return exists(patched) ? patched : original;
}
