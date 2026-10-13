import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  applyLocalSpeechCudaLoaderEnv,
  resolveLocalSpeechExecutionProvider,
  resolveTransducerEncoderFile,
} from "./local-speech-gpu.js";

describe("local speech GPU", () => {
  it("runs on the CPU unless a CUDA directory is configured", () => {
    expect(resolveLocalSpeechExecutionProvider({})).toBe("cpu");
    expect(resolveLocalSpeechExecutionProvider({ PASEO_LOCAL_SPEECH_CUDA_DIR: "  " })).toBe("cpu");
    expect(resolveLocalSpeechExecutionProvider({ PASEO_LOCAL_SPEECH_CUDA_DIR: "/opt/cuda" })).toBe(
      "cuda",
    );
  });

  it("puts the CUDA build ahead of the CPU package on the loader path", () => {
    const env: NodeJS.ProcessEnv = {
      PASEO_LOCAL_SPEECH_CUDA_DIR: "/opt/paseo-cuda/lib",
      LD_LIBRARY_PATH: "/app/node_modules/sherpa-onnx-linux-x64",
    };

    expect(applyLocalSpeechCudaLoaderEnv(env, "linux")).toBe(true);
    expect(env.LD_LIBRARY_PATH).toBe(
      ["/opt/paseo-cuda/lib", "/app/node_modules/sherpa-onnx-linux-x64"].join(path.delimiter),
    );
  });

  it("leaves the loader path alone without a CUDA directory or off Linux", () => {
    const unset: NodeJS.ProcessEnv = { LD_LIBRARY_PATH: "/sherpa" };
    expect(applyLocalSpeechCudaLoaderEnv(unset, "linux")).toBe(false);
    expect(unset.LD_LIBRARY_PATH).toBe("/sherpa");

    const mac: NodeJS.ProcessEnv = { PASEO_LOCAL_SPEECH_CUDA_DIR: "/opt/cuda" };
    expect(applyLocalSpeechCudaLoaderEnv(mac, "darwin")).toBe(false);
    expect(mac.DYLD_LIBRARY_PATH).toBeUndefined();
  });

  it("uses the CUDA-patched encoder only on CUDA and only when it exists", () => {
    const modelDir = "/models/parakeet";
    const patched = path.join(modelDir, "encoder.fp16-cuda.onnx");
    const original = path.join(modelDir, "encoder.fp16.onnx");
    const exists = (filePath: string) => filePath === patched;

    expect(
      resolveTransducerEncoderFile({
        modelDir,
        encoderFile: "encoder.fp16.onnx",
        provider: "cuda",
        exists,
      }),
    ).toBe(patched);
    expect(
      resolveTransducerEncoderFile({
        modelDir,
        encoderFile: "encoder.fp16.onnx",
        provider: "cpu",
        exists,
      }),
    ).toBe(original);
    expect(
      resolveTransducerEncoderFile({
        modelDir,
        encoderFile: "encoder.int8.onnx",
        provider: "cuda",
        exists,
      }),
    ).toBe(path.join(modelDir, "encoder.int8.onnx"));
  });
});
