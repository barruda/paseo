import { describe, expect, it } from "vitest";

import {
  DEFAULT_VOICE_TURN_SILENCE_MS,
  VOICE_TURN_SILENCE_ENV,
  resolveVoiceTurnSilenceMs,
} from "./voice-turn-silence.js";

describe("resolveVoiceTurnSilenceMs", () => {
  it("defaults to 1000 ms", () => {
    expect(resolveVoiceTurnSilenceMs({ env: {} })).toBe(DEFAULT_VOICE_TURN_SILENCE_MS);
  });

  it("uses the saved value over the default", () => {
    expect(resolveVoiceTurnSilenceMs({ env: {}, saved: { silenceMs: 2000 } })).toBe(2000);
  });

  it("uses the env var over the saved value", () => {
    expect(
      resolveVoiceTurnSilenceMs({
        env: { [VOICE_TURN_SILENCE_ENV]: "750" },
        saved: { silenceMs: 2000 },
      }),
    ).toBe(750);
  });

  it("ignores an invalid env var", () => {
    expect(
      resolveVoiceTurnSilenceMs({
        env: { [VOICE_TURN_SILENCE_ENV]: "soon" },
        saved: { silenceMs: 2000 },
      }),
    ).toBe(2000);
  });
});
