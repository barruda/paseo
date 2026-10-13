import { describe, expect, it } from "vitest";

import {
  buildVoiceModeSystemPrompt,
  stripVoiceModeSystemPrompt,
  VOICE_AGENT_SYSTEM_INSTRUCTION,
} from "./voice-config.js";

// CUSTOM(voice-settings)
describe("voice mode instructions", () => {
  it("uses the built-in instructions unless Settings provides its own", () => {
    expect(buildVoiceModeSystemPrompt("Base.", true)).toContain(VOICE_AGENT_SYSTEM_INSTRUCTION);
    expect(buildVoiceModeSystemPrompt("Base.", true, "   ")).toContain(
      VOICE_AGENT_SYSTEM_INSTRUCTION,
    );

    const custom = buildVoiceModeSystemPrompt("Base.", true, "Reply in Portuguese, briefly.");
    expect(custom).toContain("Reply in Portuguese, briefly.");
    expect(custom).not.toContain(VOICE_AGENT_SYSTEM_INSTRUCTION);
    expect(stripVoiceModeSystemPrompt(custom)).toBe("Base.");
  });

  it("turning voice mode off ignores custom instructions", () => {
    const off = buildVoiceModeSystemPrompt(undefined, false, "Reply in Portuguese.");
    expect(off).toContain("Paseo voice mode is now off.");
    expect(off).not.toContain("Reply in Portuguese.");
  });
});
