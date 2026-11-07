import { describe, expect, it } from "vitest";

import {
  DEFAULT_DICTATION_TUNING,
  dictationTuningSupport,
  resolveDictationTuning,
} from "./dictation-tuning.js";

describe("resolveDictationTuning", () => {
  it("uses the defaults when nothing is set", () => {
    expect(resolveDictationTuning({ env: {} })).toEqual(DEFAULT_DICTATION_TUNING);
  });

  it("prefers the env var over the saved value, and the saved value over the default", () => {
    const tuning = resolveDictationTuning({
      env: { PASEO_DICTATION_AUTO_COMMIT_SECONDS: "0", PASEO_DICTATION_TRANSCRIPTION_PROMPT: "E" },
      saved: { autoCommitSeconds: 8, decodeIntervalMs: 1000, prompt: "S" },
    });
    expect(tuning).toEqual({
      autoCommitSeconds: 0,
      silencePeakThreshold: DEFAULT_DICTATION_TUNING.silencePeakThreshold,
      decodeIntervalMs: 1000,
      prompt: "E",
    });
  });

  it("ignores env values that are not non-negative numbers", () => {
    const tuning = resolveDictationTuning({
      env: {
        PASEO_DICTATION_DECODE_INTERVAL_MS: "fast",
        PASEO_DICTATION_SILENCE_PEAK_THRESHOLD: "-1",
      },
      saved: { silencePeakThreshold: 120 },
    });
    expect(tuning.decodeIntervalMs).toBe(DEFAULT_DICTATION_TUNING.decodeIntervalMs);
    expect(tuning.silencePeakThreshold).toBe(120);
  });
});

describe("dictationTuningSupport", () => {
  it("lets local models re-transcribe on a timer and OpenAI take the prompt", () => {
    expect(dictationTuningSupport("local")).toEqual({
      autoCommitSeconds: true,
      silencePeakThreshold: true,
      decodeIntervalMs: true,
      prompt: false,
    });
    expect(dictationTuningSupport("openai")).toEqual({
      autoCommitSeconds: true,
      silencePeakThreshold: true,
      decodeIntervalMs: false,
      prompt: true,
    });
  });
});
