import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  applyLocalSpeechWorkerEnv,
  checkCudaAvailability,
  defaultCudaLibDir,
  resolveCudaLibDir,
  resolveLocalSpeechExecutionProvider,
} from "./local-speech-gpu.js";

const directories: string[] = [];

afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("local speech GPU", () => {
  it("runs the worker on the CPU unless the client forked it for CUDA", () => {
    expect(resolveLocalSpeechExecutionProvider({})).toBe("cpu");
    const env: NodeJS.ProcessEnv = {};
    applyLocalSpeechWorkerEnv(env, { provider: "cuda", cudaLibDir: "/opt/cuda" }, "linux");
    expect(resolveLocalSpeechExecutionProvider(env)).toBe("cuda");
  });

  it("puts the CUDA build ahead of the CPU package on the loader path only for CUDA", () => {
    const cuda: NodeJS.ProcessEnv = { LD_LIBRARY_PATH: "/app/sherpa-onnx-linux-x64" };
    applyLocalSpeechWorkerEnv(cuda, { provider: "cuda", cudaLibDir: "/opt/cuda/lib" }, "linux");
    expect(cuda.LD_LIBRARY_PATH).toBe(
      ["/opt/cuda/lib", "/app/sherpa-onnx-linux-x64"].join(path.delimiter),
    );

    const cpu: NodeJS.ProcessEnv = { LD_LIBRARY_PATH: "/app/sherpa-onnx-linux-x64" };
    applyLocalSpeechWorkerEnv(cpu, { provider: "cpu", cudaLibDir: "/opt/cuda/lib" }, "linux");
    expect(cpu.LD_LIBRARY_PATH).toBe("/app/sherpa-onnx-linux-x64");
  });

  it("takes the CUDA folder from the env, then config, then the setup script's default", () => {
    expect(resolveCudaLibDir({ PASEO_LOCAL_SPEECH_CUDA_DIR: "/env/lib" }, "/config/lib")).toBe(
      "/env/lib",
    );
    expect(resolveCudaLibDir({}, "/config/lib")).toBe("/config/lib");
    expect(resolveCudaLibDir({})).toBe(defaultCudaLibDir());
  });

  it("reports why GPU speech is unavailable", () => {
    expect(checkCudaAvailability("/opt/cuda", "darwin")).toMatchObject({ available: false });

    const libDir = mkdtempSync(path.join(tmpdir(), "paseo-cuda-"));
    directories.push(libDir);
    const result = checkCudaAvailability(libDir, "linux");
    expect(result.available).toBe(false);
  });
});
