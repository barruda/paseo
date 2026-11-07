import { describe, expect, it } from "vitest";
import type { DictationTuningStatus, SpeechLocalStatus } from "@getpaseo/protocol/speech-settings";

import {
  dictationModelLabel,
  dictationTuningRowState,
  tuningOptionValues,
} from "./dictation-tuning-model";

const localTuning: DictationTuningStatus = {
  provider: "local",
  model: "parakeet-tdt-0.6b-v3-int8",
  supported: {
    autoCommitSeconds: true,
    silencePeakThreshold: true,
    decodeIntervalMs: true,
    prompt: false,
  },
  defaults: {
    autoCommitSeconds: 15,
    silencePeakThreshold: 300,
    decodeIntervalMs: 350,
    prompt: "P",
  },
};

function statusWith(envControlled: string[]): SpeechLocalStatus {
  return {
    envControlled,
    models: [{ id: "parakeet-tdt-0.6b-v3-int8", label: "Parakeet TDT v3" }],
  } as unknown as SpeechLocalStatus;
}

describe("dictationTuningRowState", () => {
  it("locks a field the model doesn't read before checking env vars", () => {
    const status = statusWith(["dictationPrompt"]);
    expect(dictationTuningRowState(status, localTuning, "prompt")).toEqual({ kind: "unsupported" });
  });

  it("locks a field an env var sets and leaves the rest editable", () => {
    const status = statusWith(["dictationAutoCommitSeconds"]);
    expect(dictationTuningRowState(status, localTuning, "autoCommitSeconds")).toEqual({
      kind: "envControlled",
    });
    expect(dictationTuningRowState(status, localTuning, "decodeIntervalMs")).toEqual({
      kind: "editable",
    });
  });
});

describe("tuningOptionValues", () => {
  it("adds a current value that isn't a preset, in order", () => {
    expect(tuningOptionValues("decodeIntervalMs", 420)).toEqual([
      200, 350, 420, 500, 750, 1000, 1500, 2000,
    ]);
    expect(tuningOptionValues("autoCommitSeconds", 15)).toEqual([0, 5, 8, 10, 15, 20, 30, 60]);
  });
});

describe("dictationModelLabel", () => {
  it("names the local model from the catalog and OpenAI by provider", () => {
    expect(dictationModelLabel(statusWith([]), localTuning)).toBe("Parakeet TDT v3");
    expect(dictationModelLabel(statusWith([]), { ...localTuning, provider: "openai" })).toBe(
      "OpenAI",
    );
  });
});
