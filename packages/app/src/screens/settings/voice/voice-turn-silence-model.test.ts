import { describe, expect, it } from "vitest";
import type { MutableSpeechConfig, SpeechLocalStatus } from "@getpaseo/protocol/speech-settings";

import {
  formatVoiceTurnSilence,
  voiceTurnSilenceOptionValues,
  voiceTurnSilenceRowState,
} from "./voice-turn-silence-model";

const status = (envControlled: string[]) => ({ envControlled }) as unknown as SpeechLocalStatus;

describe("voiceTurnSilenceRowState", () => {
  it("hides the row when the daemon reports no value", () => {
    expect(voiceTurnSilenceRowState(status([]), {} as MutableSpeechConfig)).toEqual({
      kind: "hidden",
    });
  });

  it("locks the row when an env var sets the value", () => {
    expect(
      voiceTurnSilenceRowState(status(["voiceTurnSilenceMs"]), {
        voiceTurnSilenceMs: 1200,
      } as MutableSpeechConfig),
    ).toEqual({ kind: "envControlled", value: 1200 });
  });

  it("is editable otherwise", () => {
    expect(
      voiceTurnSilenceRowState(status([]), { voiceTurnSilenceMs: 1000 } as MutableSpeechConfig),
    ).toEqual({ kind: "editable", value: 1000 });
  });
});

describe("voiceTurnSilenceOptionValues", () => {
  it("returns the presets sorted", () => {
    expect(voiceTurnSilenceOptionValues(1000)).toEqual([500, 800, 1000, 1500, 2000, 3000, 5000]);
  });

  it("adds a current value that is not a preset", () => {
    expect(voiceTurnSilenceOptionValues(1200)).toEqual([
      500, 800, 1000, 1200, 1500, 2000, 3000, 5000,
    ]);
  });
});

describe("formatVoiceTurnSilence", () => {
  it("formats milliseconds as seconds", () => {
    expect(formatVoiceTurnSilence(500)).toBe("0.5 s");
    expect(formatVoiceTurnSilence(1000)).toBe("1 s");
    expect(formatVoiceTurnSilence(1250)).toBe("1.25 s");
  });
});
