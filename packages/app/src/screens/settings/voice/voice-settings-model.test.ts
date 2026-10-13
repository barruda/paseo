import { describe, expect, it } from "vitest";
import type { SpeechLocalStatus, SpeechModelInfo } from "@getpaseo/protocol/speech-settings";

import {
  deriveEngineState,
  describeSpeaker,
  formatBytes,
  modelAvailability,
  nearestSpeed,
  pcmMimeType,
  previewTextFor,
  sortModels,
} from "./voice-settings-model";

function model(overrides: Partial<SpeechModelInfo>): SpeechModelInfo {
  return {
    id: "m",
    kind: "stt",
    label: "Model",
    source: "catalog",
    languages: null,
    installed: true,
    path: null,
    sizeBytes: null,
    downloadSizeMb: 100,
    speakers: [],
    ...overrides,
  };
}

function status(overrides: {
  running?: boolean;
  downloading?: boolean;
  available?: boolean;
  provider?: "cpu" | "cuda";
}): SpeechLocalStatus {
  const available = overrides.available ?? true;
  return {
    engine: {
      configured: true,
      requestedProvider: overrides.provider ?? "cpu",
      effectiveProvider: overrides.provider ?? "cpu",
      gpuAvailable: true,
      gpuUnavailableReason: null,
      cudaLibDir: "/cuda",
      modelsDir: "/models",
    },
    worker: {
      running: overrides.running ?? false,
      pid: overrides.running ? 42 : null,
      startedAt: null,
      rssBytes: null,
      cpuPercent: null,
      vramBytes: null,
      loadedModels: [],
      activeSessions: 0,
      inFlightRequests: 0,
    },
    gpuDevice: null,
    readiness: {
      dictation: { available, message: available ? "" : "Dictation needs models" },
      voice: { available, message: available ? "" : "Voice needs models" },
      downloadInProgress: overrides.downloading ?? false,
      downloadModelIds: overrides.downloading ? ["kokoro-multi-lang-v1_0"] : [],
      downloadError: null,
    },
    models: [],
    envControlled: [],
    defaultVoiceInstructions: "",
    logs: [],
  };
}

describe("voice settings model", () => {
  it("summarizes the engine: downloads first, then availability, then whether it runs", () => {
    expect(deriveEngineState(status({ downloading: true }))).toEqual({
      kind: "downloading",
      modelIds: ["kokoro-multi-lang-v1_0"],
    });
    expect(deriveEngineState(status({ available: false }))).toEqual({
      kind: "unavailable",
      message: "Voice needs models",
    });
    expect(deriveEngineState(status({ running: true, provider: "cuda" }))).toEqual({
      kind: "running",
      provider: "cuda",
    });
    expect(deriveEngineState(status({}))).toEqual({ kind: "idle", provider: "cpu" });
  });

  it("reads Kokoro voice names as language, gender and name", () => {
    expect(describeSpeaker("pf_dora", 42)).toEqual({
      id: 42,
      name: "Dora",
      language: "ptBR",
      gender: "female",
    });
    expect(describeSpeaker("bm_george", 9)).toMatchObject({ language: "enGB", gender: "male" });
    expect(describeSpeaker("Voice 3", 3)).toEqual({
      id: 3,
      name: "Voice 3",
      language: "unknown",
      gender: null,
    });
  });

  it("lists installed models first and the user's folders last", () => {
    const sorted = sortModels([
      model({ id: "custom", source: "custom" }),
      model({ id: "missing", installed: false }),
      model({ id: "installed" }),
    ]);
    expect(sorted.map((entry) => entry.id)).toEqual(["installed", "missing", "custom"]);
    expect(modelAvailability(model({ installed: false }))).toBe("download");
    expect(modelAvailability(model({ source: "custom", installed: false }))).toBe("folderMissing");
  });

  it("formats sizes, snaps speeds and builds playable audio types", () => {
    expect(formatBytes(3.4 * 1024 ** 3)).toBe("3.4 GB");
    expect(formatBytes(512 * 1024 ** 2)).toBe("512 MB");
    expect(formatBytes(null)).toBeNull();
    expect(nearestSpeed(undefined)).toBe(1);
    expect(nearestSpeed(1.35)).toBe(1.3);
    expect(pcmMimeType("pcm;rate=24000")).toBe("audio/pcm;rate=24000;bits=16");
    expect(previewTextFor("ptBR")).toMatch(/modo de voz/);
    expect(previewTextFor("unknown")).toBe(previewTextFor("enUS"));
  });
});
