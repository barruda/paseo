// CUSTOM(local-speech-gpu): run local speech recognition and synthesis on an NVIDIA GPU.
//
// The CUDA directory holds sherpa-onnx's CUDA build (libsherpa-onnx-c-api.so,
// libonnxruntime*.so) plus the CUDA 12 / cuDNN 9 runtime libraries;
// custom/local-speech-gpu/setup.sh prepares it. Settings picks CPU or GPU; on GPU the
// worker is forked with that directory ahead of the CPU-only npm package on
// LD_LIBRARY_PATH and asks sherpa-onnx for the CUDA execution provider. Silero VAD stays
// on the CPU: one 32 ms window per GPU launch costs ~8x more CPU than running it there.
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import {
  prependEnvPath,
  sherpaLoaderEnvKey,
  sherpaPlatformPackageName,
} from "./sherpa/sherpa-runtime-env.js";

export type LocalSpeechExecutionProvider = "cpu" | "cuda";

// Where the CUDA build lives, when not in the default location.
export const LOCAL_SPEECH_CUDA_DIR_ENV = "PASEO_LOCAL_SPEECH_CUDA_DIR";
// Set by the worker client on the forked worker only.
const WORKER_PROVIDER_ENV = "PASEO_LOCAL_SPEECH_EXECUTION_PROVIDER";

const REQUIRED_CUDA_LIBRARIES = [
  "libsherpa-onnx-c-api.so",
  "libonnxruntime.so",
  "libonnxruntime_providers_cuda.so",
  "libonnxruntime_providers_shared.so",
];

export function defaultCudaLibDir(homeDir: string = os.homedir()): string {
  return path.join(homeDir, ".local", "share", "paseo-cuda", "lib");
}

export function resolveCudaLibDir(env: NodeJS.ProcessEnv, configured?: string): string {
  const fromEnv = env[LOCAL_SPEECH_CUDA_DIR_ENV]?.trim();
  return path.resolve(fromEnv || configured?.trim() || defaultCudaLibDir());
}

export type CudaAvailability =
  | { available: true; libDir: string }
  | { available: false; libDir: string; reason: string };

function bundledSherpaVersion(): string | null {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require(`${sherpaPlatformPackageName()}/package.json`) as { version?: string };
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

export function checkCudaAvailability(
  libDir: string,
  platform: NodeJS.Platform = process.platform,
): CudaAvailability {
  if (platform !== "linux") {
    return { available: false, libDir, reason: "GPU speech is only set up for Linux." };
  }
  if (!existsSync("/proc/driver/nvidia/version")) {
    return { available: false, libDir, reason: "No NVIDIA driver found." };
  }
  const missing = REQUIRED_CUDA_LIBRARIES.filter((name) => !existsSync(path.join(libDir, name)));
  if (missing.length > 0) {
    return {
      available: false,
      libDir,
      reason: `CUDA libraries are not installed in ${libDir}. Run custom/local-speech-gpu/setup.sh.`,
    };
  }
  const bundled = bundledSherpaVersion();
  let installed: string | null = null;
  try {
    installed = readFileSync(path.join(libDir, "SHERPA_VERSION"), "utf8").trim();
  } catch {
    installed = null;
  }
  if (bundled && installed && bundled !== installed) {
    return {
      available: false,
      libDir,
      reason: `The CUDA build is for sherpa-onnx ${installed}, but Paseo bundles ${bundled}. Run custom/local-speech-gpu/setup.sh.`,
    };
  }
  return { available: true, libDir };
}

export function resolveLocalSpeechExecutionProvider(
  env: NodeJS.ProcessEnv = process.env,
): LocalSpeechExecutionProvider {
  return env[WORKER_PROVIDER_ENV] === "cuda" ? "cuda" : "cpu";
}

// Call after applySherpaLoaderEnv so the CUDA build shadows the CPU package's libraries.
export function applyLocalSpeechWorkerEnv(
  env: NodeJS.ProcessEnv,
  options: { provider: LocalSpeechExecutionProvider; cudaLibDir: string },
  platform: NodeJS.Platform = process.platform,
): void {
  env[WORKER_PROVIDER_ENV] = options.provider;
  const key = sherpaLoaderEnvKey(platform);
  if (options.provider === "cuda" && key === "LD_LIBRARY_PATH") {
    env[key] = prependEnvPath(env[key], path.resolve(options.cudaLibDir));
  }
}
